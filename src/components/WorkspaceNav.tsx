import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from './Button';
import { theme } from '../lib/theme';

export function WorkspaceNav({ listingId }: { listingId?: string }) {
  const router = useRouter();
  return (
    <View style={styles.bar} testID="workspace-nav">
      <Button
        title="My listings"
        size="small"
        variant="outline"
        onPress={() => router.replace('/operator/listings')}
        testID="nav-listings"
      />
      {listingId ? (
        <Button
          title="Listing"
          size="small"
          variant="outline"
          onPress={() => router.push({ pathname: '/operator/hub/[id]', params: { id: listingId } })}
          testID="nav-hub"
        />
      ) : null}
      <Button
        title="Home"
        size="small"
        variant="outline"
        onPress={() => router.replace('/search')}
        testID="nav-home"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.background,
  },
});
