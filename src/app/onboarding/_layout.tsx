import { Stack } from 'expo-router';
import { RequireSignedIn } from '@/features/auth/guards';
import { colors } from '@/theme';

export default function OnboardingLayout() {
  return (
    <RequireSignedIn>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </RequireSignedIn>
  );
}
