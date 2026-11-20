import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { BadgeCheck, CalendarRange, Flag, LogOut, Scale, ScrollText, Settings2, Star, Users } from 'lucide-react-native';
import { Button, ListRow, Screen, ScreenHeader, StatusPill, Text } from '@/components/design-system';
import { useSession } from '@/features/auth/session';
import { countPendingVerifications } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/** Admin/moderator hub. Sections arrive phase by phase; unbuilt ones are disabled with an explanation. */
export default function AdminHome() {
  const { context, signOut } = useSession();
  const [pending, setPending] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      countPendingVerifications().then((n) => active && setPending(n));
      return () => {
        active = false;
      };
    }, []),
  );

  const isAdmin = context?.roles.includes('admin') ?? false;

  return (
    <Screen>
      <ScreenHeader title="Moderation" eyebrow="TigRent staff" subtitle={context?.fullName} />
      <View style={styles.section}>
        <Text variant="overline" tone="muted" uppercase>Reviews</Text>
        <View style={styles.card}>
          <ListRow
            title="Student verification queue"
            subtitle="Approve, reject or request resubmission"
            icon={BadgeCheck}
            iconTint={colors.primarySoft}
            trailing={pending ? <StatusPill label={`${pending} pending`} tone="warning" /> : null}
            onPress={() => router.push('/admin/verifications')}
            testID="admin-verifications"
          />
          <ListRow title="Disputes" subtitle="Damage, missing items and refunds: review, decide, appeals" icon={Scale} iconTint={colors.primarySoft} onPress={() => router.push('/admin/disputes')} testID="admin-disputes" />
          <ListRow title="Listing reports" subtitle="Dismiss, hide or restore reported listings" icon={Flag} iconTint={colors.primarySoft} onPress={() => router.push('/admin/reports')} testID="admin-reports" />
          <ListRow title="Users and restrictions" subtitle="Paused accounts, appeals, low-rating rule" icon={Users} iconTint={colors.primarySoft} onPress={() => router.push('/admin/accounts')} testID="admin-accounts" />
          <ListRow title="Reported reviews" subtitle="Keep or hide reported ratings" icon={Star} iconTint={colors.primarySoft} onPress={() => router.push('/admin/reviews')} testID="admin-reviews" />
        </View>
      </View>
      <View style={styles.section}>
        <Text variant="overline" tone="muted" uppercase>Configuration</Text>
        <View style={styles.card}>
          <ListRow
            title="Academic years"
            subtitle={isAdmin ? 'Current year and verification expiry' : 'Administrators only'}
            icon={CalendarRange}
            iconTint={colors.primarySoft}
            onPress={isAdmin ? () => router.push('/admin/academic-years') : undefined}
            disabled={!isAdmin}
          />
          <ListRow title="Policies, fees and thresholds" subtitle="Versioned sample configuration" icon={Settings2} onPress={isAdmin ? () => router.push('/admin/configuration') : undefined} disabled={!isAdmin} />
          <ListRow title="Audit log" subtitle="Protected configuration and moderation history" icon={ScrollText} onPress={() => router.push('/admin/audit')} />
        </View>
      </View>
      <Button label="Sign out" variant="secondary" icon={LogOut} onPress={() => void signOut()} style={styles.signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  signOut: { marginTop: spacing.xxl },
});
