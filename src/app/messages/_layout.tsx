import { Stack } from 'expo-router';
import { RequireSignedIn } from '@/features/auth/guards';
import { colors } from '@/theme';

/** Booking conversations. Participants only (server-enforced); restricted members keep access (plan §2.9). */
export default function MessagesLayout() {
  return (
    <RequireSignedIn>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </RequireSignedIn>
  );
}
