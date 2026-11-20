import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Scale } from 'lucide-react-native';
import { EmptyState, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, SegmentedControl, StatusPill, Text } from '@/components/design-system';
import { Group } from '@/components/shared/Layout';
import { DISPUTE_CATEGORY_LABEL, DISPUTE_STATUS_LABEL } from '@/domain/exceptions';
import { formatDateTimeManila } from '@/lib/format';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { disputesRepository } from '@/repositories';
import { spacing } from '@/theme';

/** Moderator queue (plan Phase 10): appeals and cases ready for review first, then by severity and age. */
export default function DisputeQueue() {
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const list = useAsync(() => disputesRepository.list(scope === 'open'), [scope]);
  const { reload } = list;
  useFocusEffect(useCallback(() => void reload(), [reload]));

  return (
    <Screen refreshing={list.loading && Boolean(list.data)} onRefresh={reload}>
      <ScreenHeader title="Disputes" eyebrow="Moderation" size="compact" back />
      <SegmentedControl segments={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }] as const} value={scope} onChange={setScope} accessibilityLabel="Which disputes" />
      <View style={styles.body}>
        {list.error ? (
          <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={reload} />
        ) : !list.data ? (
          <LoadingRows rows={3} label="Loading disputes" />
        ) : list.data.length === 0 ? (
          <EmptyState icon={Scale} title="No disputes" message={scope === 'open' ? 'Nothing waiting for a decision.' : 'No disputes have been opened yet.'} />
        ) : (
          <Group>
            {list.data.map((d) => (
              <ListRow
                key={d.id}
                icon={Scale}
                title={`${DISPUTE_CATEGORY_LABEL[d.category]} · ${d.listingTitle}`}
                subtitle={`${d.borrowerName} (borrower) · ${d.lenderName} (lender)\n${d.severity} · requested ${formatPeso(d.requestedAmount)} · ${formatDateTimeManila(d.createdAt)}`}
                trailing={<StatusPill label={DISPUTE_STATUS_LABEL[d.status].label} tone={DISPUTE_STATUS_LABEL[d.status].tone} />}
                onPress={() => router.push({ pathname: '/dispute/[id]', params: { id: d.id } })}
                testID={`dispute-${d.id}`}
              />
            ))}
          </Group>
        )}
        <Text variant="footnote" tone="muted">Decisions move simulated money (refunds, deposit withholding) and are recorded in the audit log.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, marginTop: spacing.md },
});
