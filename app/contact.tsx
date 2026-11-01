import React from 'react';
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '../src/components/Button';
import { supabase } from '../src/lib/supabase';
import { theme } from '../src/lib/theme';
import { useAuthStore } from '../src/stores/authStore';
import { useBottomInset } from '../src/hooks/useBottomInset';
import { uploadContactImage } from '../src/lib/storageUpload';
import { pickProcessedImage, processWebFile } from '../src/utils/processImage';
import {
  CONTACT_CATEGORIES,
  CONTACT_CONTACT_MAX,
  CONTACT_IMAGE_MAX,
  CONTACT_MESSAGE_MAX,
  contactErrorMessage,
  contactFormError,
  contactImagePath,
  isDeviceId,
  newDeviceId,
  type ContactCategory,
} from '../src/lib/contact';

const DEVICE_KEY = 'wtp-device-id';

async function deviceId(): Promise<string> {
  const stored = await AsyncStorage.getItem(DEVICE_KEY);
  if (isDeviceId(stored)) return stored;
  const id = newDeviceId();
  await AsyncStorage.setItem(DEVICE_KEY, id);
  return id;
}

type Staged = { key: string; uri: string; base64: string; contentType: string };

/** Contact Us: Issue / Feedback / Suggestion with up to 5 images; guests can send too. */
export default function ContactScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const user = useAuthStore((s) => s.user);
  const initialize = useAuthStore((s) => s.initialize);
  const [category, setCategory] = React.useState<ContactCategory | null>(null);
  const [message, setMessage] = React.useState('');
  const [contact, setContact] = React.useState('');
  const [images, setImages] = React.useState<Staged[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<{ imageError: boolean } | null>(null);

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  const room = CONTACT_IMAGE_MAX - images.length;
  const stage = (p: { uri: string; base64: string; contentType: string }) =>
    setImages((prev) =>
      prev.length >= CONTACT_IMAGE_MAX
        ? prev
        : [...prev, { ...p, key: `c-${Date.now()}-${prev.length}-${Math.random()}` }]
    );

  const addImage = async () => {
    setError(null);
    try {
      if (Platform.OS === 'web') {
        (
          document.querySelector('[data-testid="contact-photo-file"]') as HTMLInputElement | null
        )?.click();
        return;
      }
      const processed = await pickProcessedImage();
      if (processed) stage(processed);
    } catch (err: any) {
      setError(err?.message || 'Could not add the image');
    }
  };

  const onFiles = async (files: File[]) => {
    for (const file of files.slice(0, room)) {
      try {
        stage(await processWebFile(file));
      } catch (err: any) {
        setError(err?.message || 'Could not read the image. Try another one.');
      }
    }
    if (files.length > room) setError(`Up to ${CONTACT_IMAGE_MAX} images`);
  };

  const submit = async () => {
    const formError = contactFormError({
      category,
      message,
      contact: user ? '' : contact,
      images: images.length,
    });
    setError(formError);
    if (formError) return;
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('submit_contact', {
        p_category: category,
        p_message: message.trim(),
        p_contact: user ? null : contact.trim() || null,
        p_device_id: await deviceId(),
        p_image_count: images.length,
      });
      if (rpcError || !data?.success) {
        setError(contactErrorMessage(data?.error));
        return;
      }
      let imageError = false;
      for (let i = 0; i < images.length; i++) {
        const res = await uploadContactImage({
          path: contactImagePath(data.id, i, Math.random().toString(36).slice(2)),
          base64: images[i].base64,
          contentType: images[i].contentType,
        });
        if (res.error) imageError = true;
      }
      setSent({ imageError });
      setCategory(null);
      setMessage('');
      setContact('');
      setImages([]);
    } catch {
      setError(contactErrorMessage(null));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <View style={[styles.container, bottomInset]} testID="contact-success">
        <Text style={styles.successTitle}>Thanks, your message was sent</Text>
        <Text style={styles.meta}>
          {sent.imageError
            ? 'Some images could not be uploaded, but your message was received.'
            : 'Our team will look at it soon.'}
          {user ? '' : ' If you left an email or phone number, we may reply there.'}
        </Text>
        <Button
          title="Send another"
          variant="outline"
          onPress={() => setSent(null)}
          testID="contact-again"
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.container, bottomInset]}
      testID="contact-ready"
    >
      <Text style={styles.intro}>Report an issue, share feedback or suggest something.</Text>

      <Text style={styles.label}>Category *</Text>
      <View style={styles.chips}>
        {CONTACT_CATEGORIES.map((c) => {
          const on = category === c.value;
          return (
            <TouchableOpacity
              key={c.value}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => setCategory(c.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              testID={`contact-cat-${c.value}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.label}>Message *</Text>
      <TextInput
        style={[styles.input, styles.message]}
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={CONTACT_MESSAGE_MAX}
        placeholder="What happened, or what would you like to see?"
        placeholderTextColor={theme.colors.text.tertiary}
        testID="contact-message"
      />
      <Text style={styles.counter} testID="contact-counter">
        {message.trim().length}/{CONTACT_MESSAGE_MAX}
      </Text>

      {user ? (
        <Text style={styles.meta} testID="contact-account">
          Sent from your account
          {[user.display_name, user.phone].filter(Boolean).length
            ? ` (${[user.display_name, user.phone].filter(Boolean).join(' · ')})`
            : ''}
          , so we can reply there.
        </Text>
      ) : (
        <>
          <Text style={styles.label}>Email or phone for a reply (optional)</Text>
          <TextInput
            style={styles.input}
            value={contact}
            onChangeText={setContact}
            maxLength={CONTACT_CONTACT_MAX}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com or +63 917 123 4567"
            placeholderTextColor={theme.colors.text.tertiary}
            testID="contact-reply"
          />
        </>
      )}

      <Text style={styles.label}>Images (optional, up to {CONTACT_IMAGE_MAX})</Text>
      {images.length ? (
        <View style={styles.thumbs}>
          {images.map((p, i) => (
            <View key={p.key}>
              <Image source={{ uri: p.uri }} style={styles.thumb} resizeMode="cover" />
              <TouchableOpacity
                style={styles.thumbRemove}
                onPress={() => setImages((prev) => prev.filter((x) => x.key !== p.key))}
                accessibilityLabel="Remove image"
                testID={`contact-photo-remove-${i}`}
              >
                <Text style={styles.thumbRemoveText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      {Platform.OS === 'web' ? (
        <input
          type="file"
          accept="image/*"
          multiple
          data-testid="contact-photo-file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            onFiles(files);
          }}
        />
      ) : null}
      <Button
        title={`Add images (${images.length}/${CONTACT_IMAGE_MAX})`}
        size="small"
        variant="outline"
        onPress={addImage}
        disabled={room <= 0 || busy}
        testID="contact-add-photo"
      />

      {error ? (
        <Text style={styles.error} testID="contact-error">
          {error}
        </Text>
      ) : null}
      <View style={styles.submit}>
        <Button
          title={busy ? 'Sending…' : 'Send'}
          onPress={submit}
          disabled={busy}
          testID="contact-submit"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: theme.colors.background },
  container: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
    gap: theme.spacing.xs,
  },
  intro: {
    ...theme.typography.body,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing.sm,
  },
  label: { ...theme.typography.bodySmall, fontWeight: '600', marginTop: theme.spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { ...theme.typography.bodySmall, color: theme.colors.text.primary },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.sm,
    ...theme.typography.body,
    color: theme.colors.text.primary,
  },
  message: { minHeight: 120, textAlignVertical: 'top' },
  counter: {
    ...theme.typography.caption,
    color: theme.colors.text.tertiary,
    alignSelf: 'flex-end',
  },
  meta: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.sm,
  },
  thumbs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface,
  },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  error: { ...theme.typography.bodySmall, color: theme.colors.danger, marginTop: theme.spacing.sm },
  submit: { marginTop: theme.spacing.lg },
  successTitle: { ...theme.typography.h3, marginBottom: theme.spacing.sm },
});
