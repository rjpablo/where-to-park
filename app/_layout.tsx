import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ title: 'Sign in' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="vehicles" options={{ title: 'Vehicles' }} />
      <Stack.Screen name="chat/[locationId]" options={{ title: 'Messages' }} />
      <Stack.Screen name="search" options={{ title: 'Find Parking' }} />
      <Stack.Screen name="location/[id]" options={{ title: 'Location Details' }} />
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
  );
}
