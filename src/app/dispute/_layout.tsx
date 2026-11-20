import { Stack } from 'expo-router';
import { RequireSignedIn } from '@/features/auth/guards';
import { colors } from '@/theme';

/** Dispute cases: the two parties and TigRent staff (server-enforced). Restricted members keep access (plan §2.9). */
export default function DisputeLayout() {
  return (
    <RequireSignedIn>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </RequireSignedIn>
  );
}
