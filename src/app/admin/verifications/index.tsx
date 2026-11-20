import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Inbox } from 'lucide-react-native';
import { Chip, EmptyState, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader } from '@/components/design-system';
import type { VerificationStatus } from '@/domain/entities';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { verificationRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const FILTERS: { status: VerificationStatus; label: string }[] = [
  { status: 'pending_review', label: 'Pending' },
  { status: 'needs_resubmission', label: 'Sent back' },
  { status: 'rejected', label: 'Rejected' },
  { status: 'verified', label: 'Verified' },
];

/** Staff verification queue (plan §4.4). Oldest pending first. */
export default function VerificationQueue() {
  const [status, setStatus] = useState<VerificationStatus>('pending_review');
  const list = useAsync(() => verificationRepository.listByStatus(status), [status]);
  const { reload } = list;

  // Refresh when returning from a decision.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return (
    <Screen>
      <ScreenHeader title="Verification queue" size="compact" back />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => (
          <Chip key={f.status} label={f.label} selected={status === f.status} onPress={() => setStatus(f.status)} />
        ))}
      </ScrollView>
      {list.error ? (
        <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={list.reload} />
      ) : list.loading && !list.data ? (
        <LoadingRows rows={3} label="Loading queue" />
      ) : list.data && list.data.length === 0 ? (
        <EmptyState icon={Inbox} title="Nothing here" message={status === 'pending_review' ? 'No submissions are waiting for review.' : 'No submissions in this state.'} />
      ) : (
        <View style={styles.card}>
          {list.data?.map((v) => (
            <ListRow
              key={v.id}
              title={v.fullName}
              subtitle={`${v.studentEmail}\n${v.academicYearLabel} · submitted ${formatDateTimeManila(v.submittedAt)}`}
              onPress={() => router.push(`/admin/verifications/${v.id}`)}
              testID={`queue-${v.id}`}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: spacing.sm, paddingVertical: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, marginTop: spacing.sm },
});
