import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Banner, Button, Dialog, ErrorState, LoadingRows, Screen, ScreenHeader, SegmentedControl, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import { Section } from '@/components/shared/Layout';
import { ACCOUNT_STATUS_LABEL, APPEAL_STATUS_LABEL, ruleSentence } from '@/domain/trust';
import { useSession } from '@/features/auth/session';
import { StarRating } from '@/features/reviews/StarRating';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { trustRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

type Decision = 'lift' | 'restrict' | 'suspend' | 'request_info';
const DECISION_LABEL: Record<Decision, string> = { lift: 'Lift', restrict: 'Restrict', suspend: 'Suspend', request_info: 'Ask for info' };

/** One member's account health for moderators: metrics, appeal, history, reviews, and the decision. */
export default function AccountReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { context } = useSession();
  const toast = useToast();
  const data = useAsync(() => trustRepository.accountReview(id), [id]);
  const a = data.data;
  const isAdmin = context?.roles.includes('admin') ?? false;
  const [decision, setDecision] = useState<Decision>('lift');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moderating, setModerating] = useState<string | null>(null);

  const decide = async () => {
    setBusy(true);
    setError(null);
    const r = await trustRepository.moderateAccount(id, chosen, note);
    setBusy(false);
    setConfirm(false);
    if (!r.ok) return setError(r.error.message);
    setNote('');
    toast.show({ title: 'Decision recorded', message: 'The member has been notified.', tone: 'success' });
    void data.reload();
  };
  const moderate = async (reviewId: string, action: 'keep' | 'hide' | 'restore') => {
    setModerating(reviewId);
    const r = await trustRepository.moderateReview(reviewId, action, action === 'hide' ? 'Hidden during account review' : action === 'restore' ? 'Restored during account review' : 'Kept after account review');
    setModerating(null);
    if (!r.ok) return setError(r.error.message);
    void data.reload();
  };

  const decisions: Decision[] = ['lift', 'restrict', ...(isAdmin ? (['suspend'] as const) : []), ...(a?.appeal && ['open', 'under_review', 'needs_info'].includes(a.appeal.status) ? (['request_info'] as const) : [])];
  const segments = decisions.map((d) => ({ value: d, label: DECISION_LABEL[d] }));
  // The shown choice is what gets recorded (a choice that is no longer offered falls back to Lift).
  const chosen: Decision = decisions.includes(decision) ? decision : 'lift';

  return (
    <Screen refreshing={data.loading && Boolean(a)} onRefresh={data.reload}>
      <ScreenHeader title={a?.fullName || 'Member'} eyebrow="Account review" size="compact" back />
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={data.reload} />
      ) : !a ? (
        <LoadingRows rows={4} label="Loading account" />
      ) : (
        <View style={styles.body}>
          <View style={styles.card}>
            <StatusPill label={ACCOUNT_STATUS_LABEL[a.accountStatus].label} tone={ACCOUNT_STATUS_LABEL[a.accountStatus].tone} />
            {a.statusReason ? <Text variant="callout">{a.statusReason}</Text> : null}
            <Text variant="bodyStrong">{a.metrics.reviewCount} ratings{a.metrics.avgRating !== null ? ` · average ${a.metrics.avgRating.toFixed(2)}` : ''} · rule {a.metrics.ruleMet ? 'met' : 'not met'}</Text>
            <Text variant="footnote" tone="muted">{ruleSentence(a.metrics.rule, a.metrics.ruleIsSample)}</Text>
            <Text variant="footnote" tone="muted">{a.openObligations} open rental{a.openObligations === 1 ? '' : 's'} (never cancelled by a restriction).</Text>
          </View>

          {a.appeal ? (
            <Section title="Appeal">
              <View style={styles.card} testID="account-appeal">
                <StatusPill label={APPEAL_STATUS_LABEL[a.appeal.status].label} tone={APPEAL_STATUS_LABEL[a.appeal.status].tone} />
                <Text variant="callout">“{a.appeal.reason}”</Text>
                <Text variant="caption" tone="muted">{formatDateTimeManila(a.appeal.createdAt)}</Text>
                {a.appeal.moderatorNote ? <Text variant="footnote" tone="muted">Moderator note: {a.appeal.moderatorNote}</Text> : null}
              </View>
            </Section>
          ) : null}

          <Section title="Decision">
            <View style={styles.card} testID="account-decision">
              <SegmentedControl segments={segments} value={chosen} onChange={setDecision} accessibilityLabel="Decision" testID="account-decision-choice" />
              {!isAdmin ? <Text variant="caption" tone="muted">Suspension is for administrators.</Text> : null}
              <TextField label="Reason (shown to the member)" value={note} onChangeText={setNote} multiline maxLength={1000} testID="account-note" />
              {error ? <Banner tone="danger" title="Not recorded" message={error} /> : null}
              <Button label="Record decision" fullWidth disabled={note.trim().length < 10} disabledReason="Explain the decision (at least 10 characters)." onPress={() => setConfirm(true)} testID="account-decide" />
            </View>
          </Section>

          <Section title="Ratings received">
            {a.reviews.length === 0 ? <Text variant="callout" tone="muted">No ratings yet.</Text> : null}
            {a.reviews.map((r) => (
              <View key={r.id} style={styles.card}>
                <View style={styles.row}>
                  <StarRating value={r.rating} size={16} />
                  <Text variant="caption" tone="muted" style={styles.flex}>{r.direction === 'borrower_to_lender' ? 'as lender' : 'as borrower'} · {formatDateTimeManila(r.createdAt)}</Text>
                  {r.moderationStatus === 'hidden' ? <StatusPill label="Hidden" tone="neutral" /> : r.isReported ? <StatusPill label="Reported" tone="warning" /> : null}
                </View>
                {r.comment ? <Text variant="callout">“{r.comment}”</Text> : null}
                {r.reportReason ? <Text variant="footnote" tone="muted">Report: {r.reportReason}</Text> : null}
                <View style={styles.row}>
                  {r.moderationStatus === 'hidden' ? (
                    <Button label="Restore" variant="secondary" size="sm" loading={moderating === r.id} onPress={() => void moderate(r.id, 'restore')} />
                  ) : (
                    <Button label="Hide" variant="secondary" size="sm" loading={moderating === r.id} onPress={() => void moderate(r.id, 'hide')} testID={`hide-${r.id}`} />
                  )}
                </View>
              </View>
            ))}
          </Section>

          {a.history.length > 0 ? (
            <Section title="History">
              <View style={styles.card}>
                {a.history.map((e, i) => (
                  <View key={`${e.at}-${i}`} style={styles.event}>
                    <Text variant="bodyStrong">{ACCOUNT_STATUS_LABEL[e.from].label} → {ACCOUNT_STATUS_LABEL[e.to].label}{e.automatic ? ' (automatic)' : ''}</Text>
                    <Text variant="footnote" tone="muted">{e.reason}</Text>
                    <Text variant="caption" tone="muted">{formatDateTimeManila(e.at)}</Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}
        </View>
      )}
      <Dialog
        visible={confirm}
        title={`${DECISION_LABEL[chosen]}?`}
        message={
          chosen === 'lift'
            ? 'The member can rent and list again. Their appeal (if any) is marked lifted.'
            : chosen === 'request_info'
              ? 'The member is asked to add information to their appeal.'
              : `New rentals and listings stay blocked; existing rentals continue. The member sees your reason.`
        }
        confirmLabel="Record decision"
        destructive={chosen === 'suspend' || chosen === 'restrict'}
        loading={busy}
        onConfirm={() => void decide()}
        onCancel={() => setConfirm(false)}
        testID="account-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  event: { gap: 2, paddingVertical: spacing.xs },
  flex: { flex: 1 },
});
