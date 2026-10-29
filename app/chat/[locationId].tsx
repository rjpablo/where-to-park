import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Image,
  Modal,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '../../src/components/Button';
import { supabase } from '../../src/lib/supabase';
import { useAuthStore } from '../../src/stores/authStore';
import { formatRelativeTime } from '../../src/utils/formatters';
import { theme } from '../../src/lib/theme';

type ChatMessage = {
  id: string;
  kind: 'text' | 'image' | 'system';
  body: string | null;
  image_path: string | null;
  sender_id: string | null;
  created_at: string;
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
  const [imageUrls, setImageUrls] = React.useState<Record<string, string>>({});
  const [fullImage, setFullImage] = React.useState<string | null>(null);

  const loadMessages = React.useCallback(async (id: string) => {
    const { data, error: fetchError } = await supabase
      .from('chat_messages')
      .select('id, kind, body, image_path, sender_id, created_at')
      .eq('thread_id', id)
      .eq('hidden', false)
      .order('created_at', { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    const rows = (data as ChatMessage[]) || [];
    setMessages(rows);
    const images = rows.filter((m) => m.kind === 'image' && m.image_path);
    await Promise.all(
      images.map(async (m) => {
        const path = m.image_path as string;
        const { data: signed, error: signError } = await supabase.storage
          .from('chat-images')
          .createSignedUrl(path, 3600);
        if (!signError && signed?.signedUrl) {
          setImageUrls((prev) => ({ ...prev, [path]: signed.signedUrl }));
          return;
        }
        const { data: blob } = await supabase.rpc('get_chat_image', { p_path: path });
        if (blob?.base64) {
          setImageUrls((prev) => ({
            ...prev,
            [path]: `data:${blob.content_type || 'image/png'};base64,${blob.base64}`,
          }));
        }
      })
    );
  }, []);

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

  const sendPhoto = async () => {
    if (!threadId) return;
    const { data, error: rpcError } = await supabase.rpc('put_chat_image', {
      p_thread_id: threadId,
      p_filename: 'photo.jpg',
    });
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    await loadMessages(threadId);
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
          <View
            key={m.id}
            style={[
              styles.bubble,
              m.kind === 'system' && styles.systemBubble,
              m.sender_id === user.id && styles.mine,
            ]}
            testID={`chat-msg-${m.kind}`}
          >
            {m.kind === 'system' ? (
              <Text style={styles.systemText}>{m.body}</Text>
            ) : m.kind === 'image' ? (
              <Pressable
                onPress={() => m.image_path && setFullImage(imageUrls[m.image_path] || null)}
              >
                {imageUrls[m.image_path || ''] ? (
                  <Image
                    source={{ uri: imageUrls[m.image_path as string] }}
                    style={styles.thumb}
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
            <Text style={styles.meta}>{formatRelativeTime(m.created_at)}</Text>
          </View>
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
        <Button title="Send photo" variant="outline" onPress={sendPhoto} testID="chat-photo" />
        <Button title="Send" onPress={send} testID="chat-send" />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Modal
        visible={!!fullImage}
        transparent
        animationType="fade"
        onRequestClose={() => setFullImage(null)}
      >
        <Pressable
          style={styles.lightbox}
          onPress={() => setFullImage(null)}
          testID="chat-photo-full"
        >
          {fullImage ? (
            <Image source={{ uri: fullImage }} style={styles.fullImage} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

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
