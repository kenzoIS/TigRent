import { Stack } from 'expo-router';
import { AreaGuard } from '@/features/auth/guards';
import { colors } from '@/theme';

/** Borrower discovery stack (search, listing detail, lender profile, request review). */
export default function ExploreLayout() {
  return (
    <AreaGuard area="borrower">
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </AreaGuard>
  );
}
