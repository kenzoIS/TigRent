import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Button, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import { ratingProblem } from '@/domain/trust';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { ok } from '@/lib/errors';
import { trustRepository, type BookingDetail, type BookingReviews } from '@/repositories';
import { colors, radii, spacing } from '@/theme';
import { ReportReviewSheet } from './ReportReviewSheet';
import { StarRating } from './StarRating';

/** After completion (plan §2.9): rate the other party once, see their rating of you, report it if needed. */
export function BookingReviewCard({ d }: { d: BookingDetail }) {
  const toast = useToast();
  // Reviews exist only after completion; other bookings don't query them.
  const data = useAsync(() => (d.status === 'completed' ? trustRepository.bookingReviews(d.id) : Promise.resolve(ok<BookingReviews | null>(null))), [d.id, d.status]);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const r = data.data;
  if (d.status !== 'completed' || d.myRole === 'staff' || !r) return null;
  const other = d.counterpart.fullName.split(' ')[0];

  const submit = async () => {
    const problem = ratingProblem(rating, comment);
    setError(problem);
    if (problem || busy) return;
    setBusy(true);
    const res = await trustRepository.submitReview(d.id, rating!, comment);
    setBusy(false);
    if (!res.ok) return setError(res.error.message);
    toast.show({ title: 'Review posted', message: `Thanks for rating ${other}.`, tone: 'success' });
    void data.reload();
  };

  return (
    <View style={styles.card} testID="booking-reviews">
      {r.canReview ? (
        <>
          <Text variant="headline">Rate {other} as a {d.myRole === 'borrower' ? 'lender' : 'borrower'}</Text>
          <StarRating value={rating} onChange={setRating} testID="rate" />
          <TextField label="Comment (optional)" value={comment} onChangeText={setComment} multiline maxLength={1000} placeholder="What went well? What could be better?" testID="review-comment" />
          {error ? <Banner tone="danger" title="Not posted" message={error} /> : null}
          <Button label="Post review" fullWidth loading={busy} onPress={submit} testID="submit-review" />
          {r.reviewUntil ? <Text variant="caption" tone="muted">Open until {formatDateTimeManila(r.reviewUntil)}. Reviews are public to verified students and can’t be edited.</Text> : null}
        </>
      ) : r.mine ? (
        <>
          <Text variant="headline">Your review of {other}</Text>
          <StarRating value={r.mine.rating} size={20} />
          {r.mine.comment ? <Text variant="callout">“{r.mine.comment}”</Text> : null}
          {r.mine.moderationStatus === 'hidden' ? <StatusPill label="Hidden by a moderator" tone="neutral" /> : null}
        </>
      ) : (
        <Text variant="callout" tone="muted">The review window for this rental has closed.</Text>
      )}
      {r.theirs ? (
        <View style={styles.theirs} testID="their-review">
          <Text variant="headline">{other}’s review of you</Text>
          <StarRating value={r.theirs.rating} size={20} />
          {r.theirs.comment ? <Text variant="callout">“{r.theirs.comment}”</Text> : null}
          {r.theirs.isReported ? (
            <StatusPill label="Reported: with a moderator" tone="info" />
          ) : (
            <Button label="Report this review" variant="ghost" size="sm" onPress={() => setReporting(r.theirs!.id)} testID="report-their-review" />
          )}
        </View>
      ) : null}
      <ReportReviewSheet
        reviewId={reporting}
        onClose={() => setReporting(null)}
        onReported={() => {
          setReporting(null);
          toast.show({ title: 'Report sent', message: 'A moderator will check it.', tone: 'success' });
          void data.reload();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  theirs: { gap: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.xs },
});
