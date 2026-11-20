import { Stack } from 'expo-router';
import { GuestOnly } from '@/features/auth/guards';
import { colors } from '@/theme';

export default function AuthLayout() {
  return (
    <GuestOnly>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </GuestOnly>
  );
}
