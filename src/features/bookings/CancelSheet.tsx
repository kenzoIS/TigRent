import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Banner, Button, LoadingRows, Sheet, StatusPill, Text, TextField } from '@/components/design-system';
import { formatPeso } from '@/lib/money';
import { bookingFlowRepository, type BookingDetail, type CancellationQuote } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/**
 * Cancel with a refund preview (plan §2.6): the server computes the refund from the policy version stored
 * on the booking; the user confirms exactly that amount (the server refuses if it changed meanwhile).
 */
export function CancelSheet({ d, visible, onClose, onDone }: { d: BookingDetail; visible: boolean; onClose: () => void; onDone: (q: CancellationQuote) => void }) {
  const [quote, setQuote] = useState<CancellationQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const needsReason = d.myRole !== 'borrower';
  const other = d.counterpart.fullName.split(' ')[0];

  useEffect(() => {
    if (!visible) return;
    let active = true;
    bookingFlowRepository.previewCancellation(d.id).then((r) => {
      if (!active) return;
      if (r.ok) setQuote(r.data);
      else setError(r.error.message);
    });
    return () => {
      active = false;
    };
  }, [visible, d.id]);

  const confirm = async () => {
    if (!quote || busy) return;
    if (needsReason && reason.trim().length < 3) return setError(`Tell ${other} why you’re cancelling.`);
    setBusy(true);
    setError(null);
    const r = await bookingFlowRepository.cancel(d.id, reason, quote.refundTotal);
    setBusy(false);
    if (r.ok) return onDone(r.data);
    setError(r.error.message);
    if (r.error.code === 'refund_changed') {
      const again = await bookingFlowRepository.previewCancellation(d.id);
      if (again.ok) setQuote(again.data);
    }
  };

  const borrower = d.myRole === 'borrower';
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={d.status === 'pending_lender_approval' ? 'Cancel request' : 'Cancel booking'}
      description="Check what happens to the money before you confirm. All payments and refunds are simulated."
      footer={<Button label="Confirm cancellation" variant="danger" fullWidth loading={busy} disabled={!quote?.allowed} disabledReason={quote && !quote.allowed ? quote.reason ?? undefined : undefined} onPress={confirm} testID="confirm-cancel" />}
      testID="cancel-sheet"
    >
      <View style={styles.body}>
        {!quote && !error ? <LoadingRows rows={2} label="Calculating refund" /> : null}
        {quote && !quote.allowed ? <Banner tone="warning" title="Can’t cancel" message={quote.reason ?? ''} /> : null}
        {quote?.allowed ? (
          <View style={styles.card} testID="cancel-preview">
            <View style={styles.head}>
              <Text variant="headline" style={styles.flex}>{quote.paid > 0 ? 'Refund' : 'Nothing to refund'}</Text>
              {quote.policyIsSample ? <StatusPill label="Sample policy" tone="info" /> : null}
            </View>
            {quote.paid > 0 ? (
              <>
                <Row label={`Rent back to ${borrower ? 'you' : other}${quote.rentRefundPct !== null ? ` (${quote.rentRefundPct}%)` : ''}`} value={formatPeso(quote.rentRefund)} />
                <Row label={`Deposit back${quote.depositRefundPct !== null ? ` (${quote.depositRefundPct}%)` : ''}`} value={formatPeso(quote.depositRefund)} />
                <View style={styles.divider} />
                <Row label="Total refund (simulated)" value={formatPeso(quote.refundTotal, { showCentavos: 'always' })} strong />
                {quote.rentKept > 0 ? (
                  <Text variant="footnote" tone="muted">
                    {borrower ? 'The lender' : 'You'} keep{borrower ? 's' : ''} {formatPeso(quote.lenderNetAfter)} of the rent after the platform commission, as compensation for the late cancellation.
                  </Text>
                ) : null}
              </>
            ) : null}
            <Text variant="footnote" tone="muted">{quote.explanation}</Text>
            {quote.policyLabel ? <Text variant="caption" tone="muted">{quote.policyLabel}: the version accepted with this booking.</Text> : null}
          </View>
        ) : null}
        {quote?.allowed ? (
          <TextField
            label={needsReason ? 'Reason (shown to the borrower)' : 'Reason (optional)'}
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={300}
            placeholder={needsReason ? 'e.g. The item broke and can’t be rented' : 'e.g. My class was moved'}
            testID="cancel-reason"
          />
        ) : null}
        {error ? <Banner tone="danger" title="Not cancelled" message={error} /> : null}
      </View>
    </Sheet>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant={strong ? 'bodyStrong' : 'body'} style={styles.flex}>{label}</Text>
      <Text variant={strong ? 'headline' : 'body'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { backgroundColor: colors.surfaceSunken, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  flex: { flex: 1 },
});
