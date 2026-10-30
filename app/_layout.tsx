import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '../src/stores/authStore';
import { registerPushToken } from '../src/lib/push';
import { useBackToExit } from '../src/hooks/useBackToExit';
import { SidebarToggle } from '../src/components/Sidebar';

export default function RootLayout() {
  const user = useAuthStore((s) => s.user);
  const initialize = useAuthStore((s) => s.initialize);
  const initialized = useAuthStore((s) => s.initialized);
  useBackToExit();

  React.useEffect(() => {
    initialize();
  }, [initialize]);

  React.useEffect(() => {
    if (user) registerPushToken();
  }, [user]);

  // Restore the saved session before any screen decides the user is signed out.
  if (!initialized) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        testID="auth-restoring"
      >
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ title: 'Sign in' }} />
        <Stack.Screen name="profile" options={{ title: 'Profile' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="vehicles" options={{ title: 'Vehicles' }} />
        <Stack.Screen name="chat/[locationId]" options={{ title: 'Messages' }} />
        <Stack.Screen
          name="search"
          options={{ title: 'Find Parking', headerLeft: () => <SidebarToggle /> }}
        />
        <Stack.Screen name="location/[id]" options={{ title: 'Location Details' }} />
        <Stack.Screen name="operator/listings" options={{ title: 'My listings' }} />
        <Stack.Screen name="operator/hub/[id]" options={{ title: 'Listing' }} />
        <Stack.Screen name="operator/onboarding" options={{ title: 'List Your Space' }} />
        <Stack.Screen name="operator/edit/[id]" options={{ title: 'Edit Location' }} />
        <Stack.Screen name="operator/rates" options={{ title: 'Areas and Rates' }} />
        <Stack.Screen name="operator/staff" options={{ title: 'Staff' }} />
        <Stack.Screen name="operator/fees" options={{ title: 'Fee Presets' }} />
        <Stack.Screen name="operator/inbox" options={{ title: 'Messages' }} />
        <Stack.Screen name="operator/availability" options={{ title: 'Availability' }} />
        <Stack.Screen name="staff/checkin" options={{ title: 'Check In' }} />
        <Stack.Screen name="staff/sessions" options={{ title: 'Active Sessions' }} />
        <Stack.Screen name="admin/verify" options={{ title: 'Verification Queue' }} />
        <Stack.Screen name="admin/reports" options={{ title: 'Moderation' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
