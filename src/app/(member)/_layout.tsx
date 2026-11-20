import { Stack } from 'expo-router';
import { RequireSignedIn } from '@/features/auth/guards';
import { colors } from '@/theme';

/** Shared member screens. Reachable in every account state, including restricted (plan §2.9). */
export default function MemberLayout() {
  return (
    <RequireSignedIn>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </RequireSignedIn>
  );
}
