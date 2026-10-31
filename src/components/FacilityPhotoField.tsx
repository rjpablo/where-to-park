import React from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { theme } from '../lib/theme';
import { pickProcessedImage, processWebFile, type ProcessedImage } from '../utils/processImage';
import { Button } from './Button';

export function FacilityPhotoField({
  photo,
  onChange,
  error,
  testID = 'facility-photo',
}: {
  photo: ProcessedImage | null;
  onChange: (photo: ProcessedImage | null) => void;
  error?: string | null;
  testID?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const pickNative = async () => {
    setLocalError(null);
    setBusy(true);
    try {
      const next = await pickProcessedImage();
      if (next) onChange(next);
    } catch (err: any) {
      setLocalError(err.message || 'Could not open the photo library');
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (event: any) => {
    const file = event?.target?.files?.[0] as File | undefined;
    if (!file) return;
    setLocalError(null);
    setBusy(true);
    try {
      onChange(await processWebFile(file));
    } catch (err: any) {
      setLocalError(err.message || 'Could not process photo');
    } finally {
      setBusy(false);
    }
  };

  const message = error || localError;

  return (
    <View>
      {photo?.uri ? (
        <Image source={{ uri: photo.uri }} style={styles.preview} testID={`${testID}-preview`} />
      ) : (
        <View style={styles.placeholder} testID={`${testID}-empty`}>
          <Text style={styles.placeholderText}>No photo selected</Text>
        </View>
      )}

      {Platform.OS === 'web' ? (
        <input
          type="file"
          accept="image/*"
          data-testid={testID}
          onChange={onPickFile}
          style={{ marginTop: 8 }}
        />
      ) : (
        <Button
          title={photo ? 'Replace photo' : 'Choose photo'}
          variant="outline"
          onPress={pickNative}
          loading={busy}
          testID={testID}
        />
      )}

      {photo ? (
        <Button
          title="Remove photo"
          variant="outline"
          size="small"
          onPress={() => onChange(null)}
          testID={`${testID}-remove`}
        />
      ) : (
        <Text style={styles.help}>Public can view; only operator members can upload.</Text>
      )}

      {message ? (
        <Text style={styles.error} testID={`${testID}-error`}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    width: '100%',
    height: 180,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceDark,
    marginBottom: theme.spacing.sm,
  },
  placeholder: {
    width: '100%',
    height: 120,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surfaceDark,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
  },
  placeholderText: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
  },
  help: {
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.sm,
  },
  error: {
    ...theme.typography.bodySmall,
    color: theme.colors.danger,
    marginTop: theme.spacing.sm,
  },
});
