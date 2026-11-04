import { StyleSheet } from 'react-native';
import { theme } from '../lib/theme';

export const dateTimeFieldStyles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
    minHeight: 48,
  },
  main: {
    flex: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  value: {
    ...theme.typography.body,
    color: theme.colors.text.primary,
  },
  placeholder: {
    ...theme.typography.body,
    color: theme.colors.text.tertiary,
  },
  clearHit: {
    paddingHorizontal: theme.spacing.md,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  clear: { color: theme.colors.text.secondary, fontSize: 16, fontWeight: '700' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  dialog: {
    backgroundColor: theme.colors.background,
    borderRadius: 16,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  dialogTitle: { ...theme.typography.h3 },
  cancel: { alignSelf: 'center', paddingVertical: theme.spacing.sm },
  cancelText: {
    ...theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text.secondary,
  },
});
