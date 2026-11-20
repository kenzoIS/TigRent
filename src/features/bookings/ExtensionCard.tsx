import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Button, Chip, Dialog, Sheet, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import { checkRejectReason } from '@/domain/bookings';
import { EXTENSION_LABEL, OPEN_EXTENSION } from '@/domain/rental';
import { formatDateOnly } from '@/lib/dates';
import { formatPeso } from '@/lib/money';
import { bookingFlowRepository, type BookingDetail, type ExtensionItem } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const REASONS = ['I need it back on the original date.', 'Someone else needs it right after.'] as const;

/**
 * Extension requests on a booking (plan §2.8). The lender sees the new dates, the extra amount and any
 * conflict, and approves or declines; the borrower sees the status and pays from the extend screen.
 */
export function ExtensionCards({ d, onChanged }: { d: BookingDetail; onChanged: () => void }) {
  const shown = d.extensions.filter((e) => OPEN_EXTENSION.includes(e.status) || e === d.extensions[0]);
  if (shown.length === 0) return null;
  return (
    <View style={styles.list}>
      {shown.map((e) => <ExtensionCard key={e.id} e={e} d={d} onChanged={onChanged} />)}
    </View>
  );
}

function ExtensionCard({ e, d, onChanged }: { e: ExtensionItem; d: BookingDetail; onChanged: () => void }) {
  const toast = useToast();
  const [approve, setApprove] = useState(false);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lender = d.myRole === 'lender';
  const label = EXTENSION_LABEL[e.status];
  const pct = d.commissionBps / 100;

  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject') {
      const problem = checkRejectReason(reason);
      setError(problem);
      if (problem) return;
    }
    setBusy(true);
    const r = await bookingFlowRepository.decideExtension(e.id, decision, decision === 'reject' ? reason : undefined);
    setBusy(false);
    if (!r.ok) {
      setApprove(false);
      setError(r.error.message);
      return;
    }
    setApprove(false);
    setReject(false);
    toast.show({ title: decision === 'approve' ? 'Extension approved' : 'Extension declined', message: decision === 'approve' ? 'The extra days are held while the borrower pays.' : undefined, tone: decision === 'approve' ? 'success' : 'neutral' });
    onChanged();
  };

  return (
    <View style={styles.card} testID={`extension-${e.id}`}>
      <View style={styles.head}>
        <Text variant="headline" style={styles.flex}>More days requested</Text>
        <StatusPill label={label.label} tone={label.tone} />
      </View>
      <Text variant="callout">
        Return {formatDateOnly(e.oldReturnDate)} → <Text variant="bodyStrong">{formatDateOnly(e.newReturnDate)}</Text> (+{e.extraDays} day{e.extraDays === 1 ? '' : 's'})
      </Text>
      <Text variant="callout">
        Extra rent {formatPeso(e.extraAmount)}
        {lender ? ` · your share ${formatPeso(e.extraAmount - e.extraCommission)} after ${pct}% commission (simulated)` : ' (demo payment)'}
      </Text>
      {e.decisionReason && e.status === 'rejected' ? <Text variant="footnote" tone="muted">Reason: “{e.decisionReason}”</Text> : null}
      {e.status === 'pending' || e.status === 'approved_awaiting_payment' ? (
        <Text variant="footnote" tone="muted">The return date changes only after the extra payment succeeds.</Text>
      ) : null}
      {lender && e.conflict ? (
        <Banner tone="warning" title="Can’t approve: dates unavailable" message={e.conflict === 'dates_taken' ? 'Another booking now holds some of the extra days. Decline this request.' : 'You blocked some of the extra days. Remove the block first, or decline.'} testID="extension-conflict" />
      ) : null}
      {error ? <Banner tone="danger" title="That didn’t work" message={error} /> : null}

      {lender && e.status === 'pending' ? (
        <View style={styles.row}>
          <Button label="Decline" variant="secondary" onPress={() => { setError(null); setReject(true); }} style={styles.flex} testID="reject-extension" />
          <Button label="Approve" onPress={() => setApprove(true)} style={styles.flex} disabled={Boolean(e.conflict)} disabledReason={e.conflict ? 'See the note above.' : undefined} testID="approve-extension" />
        </View>
      ) : null}
      {!lender && (e.status === 'pending' || e.status === 'approved_awaiting_payment') ? (
        <Button
          label={e.status === 'approved_awaiting_payment' ? `Pay ${formatPeso(e.extraAmount)} (demo)` : 'View request'}
          variant={e.status === 'approved_awaiting_payment' ? 'primary' : 'secondary'}
          fullWidth
          onPress={() => router.push({ pathname: '/booking/[id]/extend', params: { id: d.id } })}
          testID="open-extension"
        />
      ) : null}

      <Dialog
        visible={approve}
        title="Approve more days?"
        message={`The extra days (to ${formatDateOnly(e.newReturnDate)}) are held while ${d.counterpart.fullName.split(' ')[0]} pays ${formatPeso(e.extraAmount)} (demo). The return date changes only after that payment.`}
        confirmLabel="Approve"
        loading={busy}
        onConfirm={() => void decide('approve')}
        onCancel={() => setApprove(false)}
        testID="approve-extension-dialog"
      />
      <Sheet
        visible={reject}
        onClose={() => setReject(false)}
        title="Decline extension"
        description="The original return date stays. The borrower sees your reason."
        footer={<Button label="Decline extension" variant="danger" fullWidth loading={busy} onPress={() => void decide('reject')} testID="confirm-reject-extension" />}
      >
        <View style={styles.sheet}>
          <View style={styles.wrap}>{REASONS.map((r) => <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}</View>
          <TextField label="Reason" value={reason} onChangeText={setReason} multiline maxLength={300} error={error} placeholder="Or write your own" />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  sheet: { gap: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1 },
});
