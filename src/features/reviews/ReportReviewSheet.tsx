import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Button, Chip, Sheet, TextField } from '@/components/design-system';
import { trustRepository } from '@/repositories';
import { spacing } from '@/theme';

const REASONS = ['Not about this rental', 'Abusive or personal', 'Shares private information', 'Inaccurate'] as const;

/** Report a review to moderators. It stays visible and counted until a moderator decides (no self-hiding). */
export function ReportReviewSheet({ reviewId, onClose, onReported }: { reviewId: string | null; onClose: () => void; onReported: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reviewId) return;
    if (reason.trim().length < 3) return setError('Tell moderators what’s wrong.');
    setBusy(true);
    const r = await trustRepository.reportReview(reviewId, reason);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setReason('');
    onReported();
  };
  return (
    <Sheet
      visible={Boolean(reviewId)}
      onClose={onClose}
      title="Report review"
      description="A TigRent moderator checks it. Reporting doesn’t hide the review by itself."
      footer={<Button label="Send report" fullWidth loading={busy} onPress={submit} testID="confirm-report-review" />}
    >
      <View style={styles.body}>
        <View style={styles.chips}>{REASONS.map((r) => <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}</View>
        <TextField label="Reason" value={reason} onChangeText={setReason} maxLength={300} testID="report-review-reason" />
        {error ? <Banner tone="danger" title="Not sent" message={error} /> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
