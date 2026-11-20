import { Stack } from 'expo-router';
import { AreaGuard } from '@/features/auth/guards';
import { colors } from '@/theme';

/** Lender management screens (full-screen stack above the lender tabs). */
export default function ManageLayout() {
  return (
    <AreaGuard area="lender">
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </AreaGuard>
  );
}
