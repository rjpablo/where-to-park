import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '../src/lib/theme';
import { useBottomInset } from '../src/hooks/useBottomInset';
import { PRIVACY_POLICY, type PolicyBlock } from '../src/lib/privacyPolicy';

// Privacy Policy (rj t167u): public page, no sign-in needed (web /privacy and the app).
function Segments({ block }: { block: PolicyBlock }) {
  return (
    <>
      {block.segments.map((s, i) => (
        <Text
          key={i}
          style={[s.bold ? styles.bold : null, s.href ? styles.link : null]}
          onPress={s.href ? () => Linking.openURL(s.href as string) : undefined}
          accessibilityRole={s.href ? 'link' : undefined}
        >
          {s.text}
        </Text>
      ))}
    </>
  );
}

export default function PrivacyScreen() {
  const bottomInset = useBottomInset(theme.spacing.lg);
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, bottomInset]}
      testID="privacy-policy"
    >
      <View style={styles.inner}>
        {PRIVACY_POLICY.map((b, i) => {
          if (b.type === 'li' || b.type === 'lic') {
            const indent = { marginLeft: ((b.depth ?? 1) - 1) * theme.spacing.lg };
            return (
              <View key={i} style={[styles.liRow, indent]}>
                <Text style={styles.bullet}>{b.type === 'li' ? '•' : ' '}</Text>
                <Text style={styles.p}>
                  <Segments block={b} />
                </Text>
              </View>
            );
          }
          const style =
            b.type === 'h1'
              ? styles.h1
              : b.type === 'h2'
                ? styles.h2
                : b.type === 'h3'
                  ? styles.h3
                  : b.type === 'h4'
                    ? styles.h4
                    : b.type === 'credit'
                      ? styles.credit
                      : styles.p;
          return (
            <Text
              key={i}
              style={style}
              accessibilityRole={b.type.startsWith('h') ? 'header' : undefined}
            >
              <Segments block={b} />
            </Text>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg },
  inner: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  h1: { ...theme.typography.h1, color: theme.colors.text.primary, marginBottom: theme.spacing.sm },
  h2: {
    ...theme.typography.h2,
    color: theme.colors.text.primary,
    marginTop: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
  },
  h3: {
    ...theme.typography.h3,
    color: theme.colors.text.primary,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  h4: {
    ...theme.typography.body,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  p: {
    ...theme.typography.body,
    color: theme.colors.text.primary,
    lineHeight: 22,
    marginBottom: theme.spacing.sm,
    flexShrink: 1,
  },
  liRow: { flexDirection: 'row', paddingLeft: theme.spacing.xs },
  bullet: {
    ...theme.typography.body,
    width: 18,
    lineHeight: 22,
    color: theme.colors.text.secondary,
  },
  bold: { fontWeight: '700' },
  link: { color: theme.colors.primary, textDecorationLine: 'underline' },
  credit: {
    ...theme.typography.caption,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing.xl,
  },
});
