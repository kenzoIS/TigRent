import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Users } from 'lucide-react-native';
import { EmptyState, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, StatusPill, Text } from '@/components/design-system';
import { Group } from '@/components/shared/Layout';
import { ACCOUNT_STATUS_LABEL, APPEAL_STATUS_LABEL } from '@/domain/trust';
import { useAsync } from '@/lib/use-async';
import { trustRepository } from '@/repositories';
import { spacing } from '@/theme';

/** Account-health queue (plan Phase 11): paused/restricted accounts, open appeals, accounts the rule flags. */
export default function AccountQueue() {
  const list = useAsync(() => trustRepository.accountQueue(), []);
  const { reload } = list;
  useFocusEffect(useCallback(() => void reload(), [reload]));
  return (
    <Screen refreshing={list.loading && Boolean(list.data)} onRefresh={reload}>
      <ScreenHeader title="Users and restrictions" eyebrow="Moderation" size="compact" back />
      <View style={styles.body}>
        {list.error ? (
          <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={reload} />
        ) : !list.data ? (
          <LoadingRows rows={3} label="Loading accounts" />
        ) : list.data.length === 0 ? (
          <EmptyState icon={Users} title="Nothing to review" message="No paused or restricted accounts and no open appeals." />
        ) : (
          <Group>
            {list.data.map((a) => (
              <ListRow
                key={a.userId}
                icon={Users}
                title={a.fullName || 'Member'}
                subtitle={`${a.reviewCount} ratings${a.avgRating !== null ? ` · avg ${a.avgRating.toFixed(2)}` : ''}${a.ruleMet ? ' · rule met' : ''}${a.openObligations ? ` · ${a.openObligations} open rental${a.openObligations === 1 ? '' : 's'}` : ''}${a.appealStatus ? `\n${APPEAL_STATUS_LABEL[a.appealStatus].label}` : ''}`}
                trailing={<StatusPill label={ACCOUNT_STATUS_LABEL[a.accountStatus].label} tone={ACCOUNT_STATUS_LABEL[a.accountStatus].tone} />}
                onPress={() => router.push({ pathname: '/admin/accounts/[id]', params: { id: a.userId } })}
                testID={`account-${a.userId}`}
              />
            ))}
          </Group>
        )}
        <Text variant="footnote" tone="muted">Every decision is recorded with its reason, notified to the member and kept in their account history.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
});
