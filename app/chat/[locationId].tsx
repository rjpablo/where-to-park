import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Modal,
  Pressable,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/stores/authStore';
import { formatLocalDateTime, formatRelativeTime } from '../../src/utils/formatters';
import { processChatImageFile } from '../../src/utils/chatImage';
import { uploadChatImage } from '../../src/lib/storageUpload';
import { pickProcessedImage } from '../../src/utils/processImage';
import { theme } from '../../src/lib/theme';
import { refreshSidebarCounts } from '../../src/stores/sidebarStore';
import { pathsNeedingUrl, sameMessages, type SignedUrlEntry } from '../../src/lib/signedUrls';

/** Signed chat-image URLs last an hour and are renewed 5 minutes before they expire. */
const SIGNED_URL_TTL_S = 3600;
const SIGNED_URL_REFRESH_BEFORE_MS = 5 * 60 * 1000;

type ChatMessage = {
  id: string;
  kind: 'text' | 'image' | 'system';
  body: string | null;
  image_path: string | null;
  sender_id: string | null;
  created_at: string;
  read_at: string | null;
};

export default function ChatScreen() {
  const router = useRouter();
  const { locationId, driverId } = useLocalSearchParams<{
    locationId: string;
    driverId?: string;
  }>();
  const { user, initialize } = useAuthStore();
  const [locationName, setLocationName] = React.useState('Messages');
  const [threadId, setThreadId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  // One URL per image path, kept across the 2 s polls and realtime refetches: a new
  // signed URL is a new URI string, which made every thumbnail reload (flicker).
  const [imageUrls, setImageUrls] = React.useState<Record<string, SignedUrlEntry>>({});
  const imageUrlsRef = React.useRef<Record<string, SignedUrlEntry>>({});
  const signingRef = React.useRef<Set<string>>(new Set());
  const [fullImagePath, setFullImagePath] = React.useState<string | null>(null);
  // Rows are memoised; this minute tick keeps their '5 min ago' text current.
  const [minuteTick, setMinuteTick] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setMinuteTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const ensureImageUrls = React.useCallback(async (paths: string[]) => {
    const todo = pathsNeedingUrl(
      paths,
      imageUrlsRef.current,
      signingRef.current,
      Date.now(),
      SIGNED_URL_REFRESH_BEFORE_MS
    );
    if (!todo.length) return;
    todo.forEach((path) => signingRef.current.add(path));
    const found: Record<string, SignedUrlEntry> = {};
    await Promise.all(
      todo.map(async (path) => {
        try {
          const { data: signed, error: signError } = await supabase.storage
            .from('chat-images')
            .createSignedUrl(path, SIGNED_URL_TTL_S);
          if (!signError && signed?.signedUrl) {
            found[path] = {
              url: signed.signedUrl,
              expiresAt: Date.now() + SIGNED_URL_TTL_S * 1000,
            };
            return;
          }
          const { data: blob } = await supabase.rpc('get_chat_image', { p_path: path });
          if (blob?.base64) {
            found[path] = {
              url: `data:${blob.content_type || 'image/png'};base64,${blob.base64}`,
              expiresAt: Number.POSITIVE_INFINITY,
            };
          }
        } finally {
          signingRef.current.delete(path);
        }
      })
    );
    if (!Object.keys(found).length) return;
    imageUrlsRef.current = { ...imageUrlsRef.current, ...found };
    setImageUrls(imageUrlsRef.current);
  }, []);

  const loadMessages = React.useCallback(
    async (id: string) => {
      const { data, error: fetchError } = await supabase
        .from('chat_messages')
        .select('id, kind, body, image_path, sender_id, created_at, read_at')
        .eq('thread_id', id)
        .eq('hidden', false)
        .order('created_at', { ascending: true });
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      const rows = (data as ChatMessage[]) || [];
      // Polls usually return the same thread: keep the old array so rows don't re-render.
      setMessages((prev) => (sameMessages(prev, rows) ? prev : rows));
      // Opening the thread reads it: clear my unread count (and the sidebar badge).
      const me = useAuthStore.getState().user?.id;
      if (
        rows.some((m) => !m.read_at && m.sender_id && m.sender_id !== me && m.kind !== 'system')
      ) {
        supabase.rpc('mark_thread_read', { p_thread_id: id }).then(() => refreshSidebarCounts());
      }
      await ensureImageUrls(
        rows.filter((m) => m.kind === 'image' && m.image_path).map((m) => m.image_path as string)
      );
    },
    [ensureImageUrls]
  );

  const openThread = React.useCallback(async () => {
    if (!locationId) {
      setError('No location');
      setLoading(false);
      return;
    }
    setError(null);
    const { data: loc } = await supabase
      .from('locations')
      .select('name')
      .eq('id', locationId)
      .maybeSingle();
    if (loc?.name) setLocationName(loc.name);

    let id: string | null = null;
    if (driverId) {
      const { data: thread, error: threadError } = await supabase
        .from('chat_threads')
        .select('id')
        .eq('location_id', locationId)
        .eq('driver_id', driverId)
        .maybeSingle();
      if (threadError) {
        setError(threadError.message);
        setLoading(false);
        return;
      }
      id = thread?.id || null;
    } else {
      const { data, error: rpcError } = await supabase.rpc('start_thread', {
        p_location_id: locationId,
      });
      if (rpcError || data?.error) {
        setError(rpcError?.message || String(data?.error));
        setLoading(false);
        return;
      }
      id = data.thread_id;
    }
    setThreadId(id);
    if (id) await loadMessages(id);
    setLoading(false);
  }, [driverId, loadMessages, locationId]);

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    openThread();
  }, [openThread, user]);

  React.useEffect(() => {
    if (!threadId) return undefined;
    const timer = setInterval(() => {
      loadMessages(threadId);
    }, 2000);
    const channel = supabase
      .channel(`chat-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        () => {
          loadMessages(threadId);
        }
      )
      .subscribe();
    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [loadMessages, threadId]);

  const send = async () => {
    if (!threadId || !draft.trim()) return;
    const { data, error: rpcError } = await supabase.rpc('send_chat_message', {
      p_thread_id: threadId,
      p_body: draft.trim(),
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    setDraft('');
    await loadMessages(threadId);
  };

  const uploadProcessed = async (processed: {
    base64: string;
    contentType: string;
    filename: string;
  }) => {
    if (!threadId) return;
    const result = await uploadChatImage({
      threadId,
      filename: processed.filename,
      base64: processed.base64,
      contentType: processed.contentType,
    });
    if (result.error) {
      setError(result.error);
      return;
    }
    await loadMessages(threadId);
  };

  const sendPhoto = async () => {
    if (!threadId) return;
    setError(null);
    try {
      if (Platform.OS === 'web') {
        const input = document.querySelector(
          '[data-testid="chat-photo-file"]'
        ) as HTMLInputElement | null;
        input?.click();
        return;
      }
      const processed = await pickProcessedImage();
      if (!processed) return;
      await uploadProcessed(processed);
    } catch (err: any) {
      setError(err.message || 'Could not send photo');
    }
  };

  const onWebFile = async (file: File | null) => {
    if (!file) return;
    try {
      const processed = await processChatImageFile(file);
      await uploadProcessed(processed);
    } catch (err: any) {
      setError(err.message || 'Could not process photo');
    }
  };

  if (!user) {
    return (
      <View style={styles.container} testID="chat-guest">
        <Text style={styles.title}>Sign in to message</Text>
        <Button title="Sign in" onPress={() => router.push('/auth')} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container} testID="chat-loading">
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="chat-ready">
      <Text style={styles.title}>{locationName}</Text>
      <ScrollView style={styles.thread} testID="chat-thread">
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            mine={m.sender_id === user.id}
            imageUri={m.image_path ? imageUrls[m.image_path]?.url : undefined}
            onOpenImage={setFullImagePath}
            minuteTick={minuteTick}
          />
        ))}
      </ScrollView>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        placeholder="Message"
        testID="chat-draft"
      />
      <View style={styles.row}>
        {Platform.OS === 'web' ? (
          <input
            type="file"
            accept="image/*"
            data-testid="chat-photo-file"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              e.target.value = '';
              onWebFile(file);
            }}
          />
        ) : null}
        <Button title="Send photo" variant="outline" onPress={sendPhoto} testID="chat-photo" />
        <Button title="Send" onPress={send} testID="chat-send" />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal
        visible={!!fullImagePath && !!imageUrls[fullImagePath]}
        transparent
        animationType="fade"
        onRequestClose={() => setFullImagePath(null)}
      >
        <Pressable
          style={styles.lightbox}
          onPress={() => setFullImagePath(null)}
          testID="chat-photo-full"
        >
          {fullImagePath && imageUrls[fullImagePath] ? (
            <Image
              source={{ uri: imageUrls[fullImagePath].url, cacheKey: fullImagePath }}
              style={styles.fullImage}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

/** One message bubble. Memoised: polls that bring no change don't re-render it, and an
 *  image keeps the same URI (and cache key = storage path) for as long as its URL is valid. */
const MessageRow = React.memo(function MessageRow({
  message: m,
  mine,
  imageUri,
  onOpenImage,
}: {
  /** Changes once a minute so the relative time re-renders. */
  minuteTick: number;
  message: ChatMessage;
  mine: boolean;
  imageUri?: string;
  onOpenImage: (path: string) => void;
}) {
  return (
    <View
      style={[styles.bubble, m.kind === 'system' && styles.systemBubble, mine && styles.mine]}
      testID={`chat-msg-${m.kind}`}
    >
      {m.kind === 'system' ? (
        <Text style={styles.systemText}>{m.body}</Text>
      ) : m.kind === 'image' ? (
        <Pressable onPress={() => m.image_path && onOpenImage(m.image_path)}>
          {imageUri && m.image_path ? (
            <Image
              source={{ uri: imageUri, cacheKey: m.image_path }}
              recyclingKey={m.image_path}
              style={styles.thumb}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={0}
              testID="chat-photo-thumb"
              accessibilityLabel="Chat photo"
            />
          ) : (
            <View style={styles.thumb} testID="chat-photo-loading" />
          )}
        </Pressable>
      ) : (
        <Text style={styles.body}>{m.body}</Text>
      )}
      <Text style={styles.meta}>
        {formatLocalDateTime(m.created_at)} · {formatRelativeTime(m.created_at)}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, padding: theme.spacing.lg },
  title: { ...theme.typography.h2, marginBottom: theme.spacing.md },
  thread: { flex: 1, marginBottom: theme.spacing.md },
  bubble: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
    alignSelf: 'flex-start',
    maxWidth: '90%',
  },
  mine: { alignSelf: 'flex-end', backgroundColor: '#dbeafe' },
  systemBubble: { alignSelf: 'center', backgroundColor: theme.colors.surfaceDark },
  body: { ...theme.typography.body },
  systemText: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    textAlign: 'center',
  },
  meta: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
    marginTop: theme.spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  row: { flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'flex-end' },
  error: { color: theme.colors.danger, marginTop: theme.spacing.md },
  thumb: {
    width: 160,
    height: 112,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: '#2563eb',
  },
  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  fullImage: { width: '100%', height: '80%' },
});
