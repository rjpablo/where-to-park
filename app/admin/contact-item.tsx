import React from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button } from '../../src/components/Button';
import { ImageCarousel } from '../../src/components/ImageCarousel';
import { supabase } from '../../src/lib/supabase';
import { theme } from '../../src/lib/theme';
import { useBottomInset } from '../../src/hooks/useBottomInset';
import { refreshSidebarCounts } from '../../src/stores/sidebarStore';
import { formatLocalDateTime } from '../../src/utils/formatters';
import {
  CONTACT_BUCKET,
  categoryLabel,
  contactDeleteErrorMessage,
  contactSender,
} from '../../src/lib/contact';

const SIGNED_URL_TTL_S = 3600;

/** Admin: one Contact Us message with its full images; mark resolved / open. */
export default function AdminContactItemScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  const raw = useLocalSearchParams<{ id?: string | string[] }>().id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  const [item, setItem] = React.useState<any | null>(null);
  const [urls, setUrls] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [viewer, setViewer] = React.useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!id) return;
    const { data, error: rpcError } = await supabase.rpc('admin_contact_submission', { p_id: id });
    if (rpcError || data?.error) {
      setError(
        data?.error === 'not_found' ? 'Message not found' : rpcError?.message || String(data?.error)
      );
      return;
    }
    setItem(data.item);
    const paths: string[] = data.item.images || [];
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from(CONTACT_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_S);
      setUrls((signed || []).map((s: any) => s.signedUrl).filter(Boolean));
    } else {
      setUrls([]);
    }
  }, [id]);

  React.useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (status: 'open' | 'resolved') => {
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc('admin_set_contact_status', {
      p_id: id,
      p_status: status,
    });
    setBusy(false);
    if (rpcError || data?.error) {
      setError(rpcError?.message || String(data?.error));
      return;
    }
    await load();
    refreshSidebarCounts();
  };

  // Admin delete: remove the images through Storage (admin DELETE policy), then the message and
  // its notifications server-side; the RPC refuses while any image is still stored.
  const remove = async () => {
    setBusy(true);
    setError(null);
    const paths: string[] = item?.images || [];
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from(CONTACT_BUCKET).remove(paths);
      if (storageError) {
        setBusy(false);
        setConfirmDelete(false);
        setError(contactDeleteErrorMessage('images_remaining'));
        return;
      }
    }
    const { data, error: rpcError } = await supabase.rpc('admin_delete_contact_submission', {
      p_id: id,
    });
    setBusy(false);
    setConfirmDelete(false);
    if (rpcError || data?.error) {
      setError(contactDeleteErrorMessage(rpcError?.message || data?.error));
      if (data?.error === 'images_remaining') load();
      return;
    }
    refreshSidebarCounts();
    router.replace('/admin/contact');
  };

  if (error && !item) {
    return (
      <View style={styles.container} testID="contact-item-error">
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!item) {
    return (
      <View style={styles.container} testID="contact-item-loading">
        <Text style={styles.meta}>Loading…</Text>
      </View>
    );
  }
  const resolved = item.status === 'resolved';
  return (
    <ScrollView contentContainerStyle={[styles.container, bottomInset]} testID="contact-item-ready">
      <View style={styles.top}>
        <Text style={styles.category} testID="contact-item-category">
          {categoryLabel(item.category)}
        </Text>
        <Text
          style={[styles.status, resolved ? styles.resolved : styles.open]}
          testID="contact-item-status"
        >
          {resolved ? 'Resolved' : 'Open'}
        </Text>
      </View>
      <Text style={styles.meta} testID="contact-item-sender">
        {contactSender(item)}
      </Text>
      <Text style={styles.meta}>{formatLocalDateTime(item.created_at)}</Text>
      {resolved && item.resolved_at ? (
        <Text style={styles.meta}>
          Resolved {formatLocalDateTime(item.resolved_at)}
          {item.resolved_by_name ? ` by ${item.resolved_by_name}` : ''}
        </Text>
      ) : null}
      <Text style={styles.message} testID="contact-item-message" selectable>
        {item.message}
      </Text>
      {urls.map((u, i) => (
        <TouchableOpacity key={u} onPress={() => setViewer(i)} testID={`contact-item-image-${i}`}>
          <Image source={{ uri: u }} style={styles.image} resizeMode="contain" />
        </TouchableOpacity>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <Button
          title={resolved ? 'Mark as open' : 'Mark as resolved'}
          variant={resolved ? 'outline' : undefined}
          onPress={() => setStatus(resolved ? 'open' : 'resolved')}
          disabled={busy}
          testID="contact-item-toggle"
        />
        {confirmDelete ? (
          <View style={styles.confirm} testID="contact-item-delete-confirm">
            <Text style={styles.confirmText}>
              Delete this message
              {urls.length ? ` and its ${urls.length} image${urls.length === 1 ? '' : 's'}` : ''}?
              This can't be undone.
            </Text>
            <View style={styles.confirmRow}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => setConfirmDelete(false)}
                disabled={busy}
                style={styles.confirmBtn}
                testID="contact-item-delete-no"
              />
              <Button
                title={busy ? 'Deleting…' : 'Delete'}
                variant="danger"
                onPress={remove}
                disabled={busy}
                style={styles.confirmBtn}
                testID="contact-item-delete-yes"
              />
            </View>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setConfirmDelete(true)}
            disabled={busy}
            style={styles.deleteLink}
            accessibilityRole="button"
            testID="contact-item-delete"
          >
            <Text style={styles.deleteText}>Delete message</Text>
          </TouchableOpacity>
        )}
      </View>
      <ImageCarousel
        images={urls.map((u, i) => ({ key: `${i}`, uri: u }))}
        startIndex={viewer}
        onClose={() => setViewer(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.lg, backgroundColor: theme.colors.background, flexGrow: 1 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  category: { ...theme.typography.h3 },
  status: {
    ...theme.typography.caption,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  open: { backgroundColor: '#fef3c7', color: '#92400e' },
  resolved: { backgroundColor: '#dcfce7', color: '#166534' },
  meta: { ...theme.typography.bodySmall, color: theme.colors.text.secondary, marginTop: 4 },
  message: { ...theme.typography.body, marginVertical: theme.spacing.md },
  image: {
    width: '100%',
    height: 320,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.md,
    marginBottom: theme.spacing.sm,
  },
  actions: { marginTop: theme.spacing.md },
  deleteLink: { alignSelf: 'center', paddingVertical: theme.spacing.md },
  deleteText: { ...theme.typography.body, color: theme.colors.danger, fontWeight: '600' },
  confirm: {
    marginTop: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.danger,
  },
  confirmText: { ...theme.typography.body, marginBottom: theme.spacing.sm },
  confirmRow: { flexDirection: 'row', gap: theme.spacing.sm },
  confirmBtn: { flex: 1 },
  error: { ...theme.typography.bodySmall, color: theme.colors.danger },
});
