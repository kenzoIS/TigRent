import { Stack } from 'expo-router';
import { RequireSignedIn } from '@/features/auth/guards';
import { colors } from '@/theme';

/**
 * Booking screens shared by both parties (detail, demo checkout, receipt). Reachable in every account
 * state so restricted members keep access to existing bookings (plan §2.9); the server decides who
 * may see or change each booking.
 */
export default function BookingLayout() {
  return (
    <RequireSignedIn>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </RequireSignedIn>
  );
}
