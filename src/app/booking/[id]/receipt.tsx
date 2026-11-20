import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ErrorState, LoadingRows, Screen, ScreenHeader, StatusPill, Text, type Tone } from '@/components/design-system';
import { Section } from '@/components/shared/Layout';
import { formatDateOnly } from '@/lib/dates';
import { formatDateTimeManila } from '@/lib/format';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { bookingFlowRepository, type BookingPayment } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const PAYMENT_LABEL: Record<BookingPayment['status'], { label: string; tone: Tone }> = {
  succeeded: { label: 'Paid (demo)', tone: 'success' },
  failed: { label: 'Declined (demo)', tone: 'danger' },
  expired: { label: 'Window closed', tone: 'neutral' },
  pending: { label: 'Processing', tone: 'info' },
};

/** Payment receipt and attempt history for one booking (plan Phase 8 "payment receipt/detail"). */
export default function BookingReceipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useAsync(() => bookingFlowRepository.detail(id), [id]);
  const d = data.data;
  const paid = d?.payments.find((p) => p.purpose === 'booking' && p.status === 'succeeded') ?? null;
  const extensionsPaid = d?.payments.filter((p) => p.purpose === 'extension' && p.status === 'succeeded') ?? [];
  const attempts = d?.payments.filter((p) => p !== paid && !extensionsPaid.includes(p)) ?? [];
  // The original payment covered the original days; paid extensions are listed separately.
  const originalRent = paid && d ? paid.amount - d.deposit : 0;
  const originalDays = d && d.dailyRate > 0 ? Math.round(originalRent / d.dailyRate) : 0;
  const refunds = d?.refunds.filter((f) => f.status === 'succeeded') ?? [];
  const pct = d ? (d.commissionBps / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 }) : '';

  return (
    <Screen>
      <ScreenHeader title="Payment record" size="compact" back />
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={data.reload} />
      ) : !d ? (
        <LoadingRows rows={3} label="Loading receipt" />
      ) : (
        <View style={styles.body}>
          {paid ? (
            <View style={styles.receipt} testID="receipt">
              <View style={styles.head}>
                <Text variant="title2" style={styles.flex}>Demo receipt</Text>
                <StatusPill label="Simulated" tone="info" />
              </View>
              <Text variant="footnote" tone="muted">Not a real transaction. No money was collected, held or paid out.</Text>
              <View style={styles.divider} />
              <Line label="Reference" value={paid.providerRef ?? '—'} />
              <Line label="Paid" value={paid.processedAt ? formatDateTimeManila(paid.processedAt) : '—'} />
              <Line label="Method" value="Demo payment (mock provider)" />
              <Line label="Item" value={d.snapshot.listingTitle} />
              <Line label="Dates" value={`${formatDateOnly(d.pickupDate)} → ${formatDateOnly(d.returnDate)} (${d.rentalDays} day${d.rentalDays === 1 ? '' : 's'})`} />
              <View style={styles.divider} />
              <Line label={`Rent (${formatPeso(d.dailyRate)} × ${originalDays})`} value={formatPeso(originalRent)} />
              <Line label="Refundable deposit" value={formatPeso(d.deposit)} />
              <Line label="Total paid" value={formatPeso(paid.amount, { showCentavos: 'always' })} strong />
              {d.myRole !== 'borrower' ? (
                <>
                  <View style={styles.divider} />
                  <Line label={`Platform commission (${pct}% of all rent${extensionsPaid.length ? ', incl. extensions' : ''})`} value={formatPeso(d.commission)} />
                  <Line label="Lender’s estimated share" value={formatPeso(d.lenderNet)} />
                  <Line label="Deposit held for the borrower" value={formatPeso(d.deposit)} />
                </>
              ) : (
                <Text variant="footnote" tone="muted">The deposit is returned after a clean return (simulated refund).</Text>
              )}
            </View>
          ) : (
            <View style={styles.receipt}>
              <Text variant="headline">No successful payment</Text>
              <Text variant="callout" tone="muted">Nothing was charged for this booking.</Text>
            </View>
          )}

          {extensionsPaid.length > 0 ? (
            <Section title="Extension payments">
              <View style={styles.receipt} testID="extension-receipts">
                {extensionsPaid.map((p) => (
                  <View key={p.id} style={styles.attempt}>
                    <Line label={`Extra days · ${p.providerRef ?? ''}`} value={formatPeso(p.amount)} />
                    <Text variant="caption" tone="muted">{p.processedAt ? formatDateTimeManila(p.processedAt) : ''} · demo payment</Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {refunds.length > 0 ? (
            <Section title="Refunds (simulated)">
              <View style={styles.receipt} testID="refunds">
                {refunds.map((f) => (
                  <View key={f.id} style={styles.attempt}>
                    <Line label={f.reason} value={formatPeso(f.amount)} strong />
                    <Text variant="caption" tone="muted">{f.processedAt ? formatDateTimeManila(f.processedAt) : ''} · returned to the borrower</Text>
                  </View>
                ))}
              </View>
            </Section>
          ) : null}

          {attempts.length > 0 ? (
            <Section title="Other payment attempts">
              <View style={styles.receipt}>
                {attempts.map((p) => (
                  <View key={p.id} style={styles.attempt} testID={`attempt-${p.status}`}>
                    <View style={styles.head}>
                      <StatusPill label={PAYMENT_LABEL[p.status].label} tone={PAYMENT_LABEL[p.status].tone} />
                      <Text variant="footnote" tone="muted" style={styles.flex}>{formatDateTimeManila(p.processedAt ?? p.createdAt)}</Text>
                      <Text variant="body">{formatPeso(p.amount)}</Text>
                    </View>
                    {p.failureReason ? <Text variant="footnote" tone="muted">{p.failureReason}</Text> : null}
                  </View>
                ))}
              </View>
            </Section>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text variant={strong ? 'bodyStrong' : 'callout'} tone={strong ? undefined : 'muted'} style={styles.flex}>{label}</Text>
      <Text variant={strong ? 'headline' : 'callout'} style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  receipt: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  value: { textAlign: 'right', maxWidth: '60%' },
  attempt: { gap: spacing.xs },
  flex: { flex: 1 },
});
