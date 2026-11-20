import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, StatusPill, Text, useToast } from '@/components/design-system';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { trustRepository, type ReviewItem } from '@/repositories';
import { colors, radii, spacing } from '@/theme';
import { ReportReviewSheet } from './ReportReviewSheet';
import { StarRating } from './StarRating';

/** Reviews a member received (visible ones; the member themself also sees hidden/reported states). */
export function ReviewList({ userId, direction, emptyText }: { userId: string; direction?: ReviewItem['direction']; emptyText: string }) {
  const toast = useToast();
  const list = useAsync(() => trustRepository.listReviews(userId, direction), [userId, direction]);
  const [reporting, setReporting] = useState<string | null>(null);
  if (list.error) return <Text variant="callout" tone="muted">{list.error.message}</Text>;
  if (!list.data) return null;
  if (list.data.length === 0) return <Text variant="callout" tone="muted">{emptyText}</Text>;
  return (
    <View style={styles.list} testID="review-list">
      {list.data.map((r) => (
        <View key={r.id} style={styles.item} testID={`review-${r.id}`}>
          <View style={styles.head}>
            <StarRating value={r.rating} size={16} />
            <Text variant="caption" tone="muted" style={styles.flex}>{r.reviewerFirstName} · {r.direction === 'borrower_to_lender' ? 'as lender' : 'as borrower'}</Text>
            {r.moderationStatus === 'hidden' ? <StatusPill label="Hidden" tone="neutral" /> : r.isReported ? <StatusPill label="Reported" tone="info" /> : null}
          </View>
          {r.comment ? <Text variant="callout">“{r.comment}”</Text> : null}
          <Text variant="caption" tone="muted">{r.listingTitle} · {formatDateTimeManila(r.createdAt)}</Text>
          {r.canReport ? <Button label="Report" variant="ghost" size="sm" onPress={() => setReporting(r.id)} testID={`report-review-${r.id}`} /> : null}
        </View>
      ))}
      <ReportReviewSheet
        reviewId={reporting}
        onClose={() => setReporting(null)}
        onReported={() => {
          setReporting(null);
          toast.show({ title: 'Report sent', message: 'A moderator will check it.', tone: 'success' });
          void list.reload();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  item: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
