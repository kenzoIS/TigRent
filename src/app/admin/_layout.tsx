import { Stack } from 'expo-router';
import { AreaGuard } from '@/features/auth/guards';
import { colors } from '@/theme';

/** Admin/moderator area. Gate uses server-loaded roles; admin RPCs re-check the role server-side. */
export default function AdminLayout() {
  return (
    <AreaGuard area="admin">
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </AreaGuard>
  );
}
