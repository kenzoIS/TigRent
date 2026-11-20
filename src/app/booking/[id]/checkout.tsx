import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, CircleX, Clock, ShieldCheck, TimerOff } from 'lucide-react-native';
import { Banner, Button, EmptyState, ErrorState, Icon, LoadingRows, Screen, ScreenHeader, SegmentedControl, StatusPill, Text } from '@/components/design-system';
import { formatCountdown } from '@/domain/bookings';
import { useHoldCountdown } from '@/features/bookings/useHoldCountdown';
import { formatDateOnly } from '@/lib/dates';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { newIdempotencyKey, paymentProvider } from '@/providers/payments/mock';
import type { DemoScenario, PaymentResult } from '@/providers/payments/types';
import { bookingFlowRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const SCENARIOS = [
  { value: 'success', label: 'Simulate success' },
  { value: 'failure', label: 'Simulate failure' },
] as const;

/**
 * Demo checkout (plan §2.5, Phase 8): visibly simulated, no payment details collected. One idempotency
 * key per visit, so a double tap or a retry can never pay twice; the server confirms the outcome.
 */
export default function DemoCheckout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useAsync(() => bookingFlowRepository.detail(id), [id]);
  const d = data.data;
  const [scenario, setScenario] = useState<DemoScenario>('success');
  const [key] = useState(() => newIdempotencyKey(id));
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seconds = useHoldCountdown(d, d?.status === 'awaiting_payment' && !result, () => void data.reload());

  const pay = async () => {
    if (paying || result) return;
    setPaying(true);
    setError(null);
    const r = await paymentProvider.payBooking({ bookingId: id, idempotencyKey: key, scenario });
    setPaying(false);
    if (r.ok) setResult(r.data);
    else setError(r.error.message);
  };

  const done = (outcome: PaymentResult['outcome']) => (
    <ResultView
      outcome={outcome}
      amount={result?.amount ?? d?.total ?? 0}
      reference={result?.providerRef ?? null}
      title={d?.snapshot.listingTitle ?? ''}
      onBooking={() => router.dismissTo({ pathname: '/booking/[id]', params: { id } })}
      onReceipt={() => router.replace({ pathname: '/booking/[id]/receipt', params: { id } })}
      onFindOther={() => d && router.replace({ pathname: '/explore/listing/[id]', params: { id: d.listingId } })}
    />
  );

  return (
    <Screen
      footer={
        d && !result && d.myRole === 'borrower' && d.status === 'awaiting_payment' && seconds > 0 ? (
          <Button
            label={`Pay ${formatPeso(d.total, { showCentavos: 'always' })} (demo)`}
            fullWidth
            loading={paying}
            onPress={pay}
            icon={ShieldCheck}
            testID="pay-demo"
          />
        ) : undefined
      }
    >
      <ScreenHeader title="Demo checkout" size="compact" back />
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={data.reload} />
      ) : !d ? (
        <LoadingRows rows={4} label="Loading checkout" />
      ) : result ? (
        done(result.outcome)
      ) : d.myRole !== 'borrower' ? (
        <EmptyState title="Only the borrower pays" message="The borrower completes this demo checkout from their own account." />
      ) : d.status === 'confirmed' ? (
        done('success')
      ) : d.status === 'payment_expired' || (d.status === 'awaiting_payment' && seconds <= 0) ? (
        done('expired')
      ) : d.status !== 'awaiting_payment' ? (
        <EmptyState title="Nothing to pay" message="This booking isn’t waiting for payment." action={{ label: 'View booking', onPress: () => router.back() }} />
      ) : (
        <View style={styles.body}>
          <View style={styles.badgeRow}>
            <StatusPill label="Demo payment" tone="info" />
            <View style={styles.timer} accessibilityLiveRegion="polite" testID="checkout-timer">
              <Icon as={Clock} size="sm" color={seconds > 120 ? colors.link : colors.danger} />
              <Text variant="bodyStrong">{formatCountdown(seconds)} left</Text>
            </View>
          </View>
          <Banner
            tone="info"
            title="Simulated checkout"
            message="TigRent is a prototype. No card, GCash, Maya or bank details are asked for, and no real money moves. Pick the outcome you want to try."
          />

          <View style={styles.card}>
            <Text variant="headline">{d.snapshot.listingTitle}</Text>
            <Text variant="footnote" tone="muted">{formatDateOnly(d.pickupDate)} → {formatDateOnly(d.returnDate)} · {d.rentalDays} day{d.rentalDays === 1 ? '' : 's'}</Text>
            <View style={styles.divider} />
            <Row label={`Rent (${formatPeso(d.dailyRate)} × ${d.rentalDays})`} value={formatPeso(d.subtotal)} />
            <Row label="Refundable deposit" value={formatPeso(d.deposit)} />
            <View style={styles.divider} />
            <Row label="Total" value={formatPeso(d.total, { showCentavos: 'always' })} strong />
          </View>

          <View style={styles.scenario}>
            <Text variant="headline">Demo outcome</Text>
            <SegmentedControl segments={SCENARIOS} value={scenario} onChange={setScenario} accessibilityLabel="Demo payment outcome" testID="scenario" />
            <Text variant="footnote" tone="muted">
              {scenario === 'success'
                ? 'The booking is confirmed and the dates stay reserved for you.'
                : 'The payment is declined, the hold is released and nothing is charged.'}
            </Text>
          </View>
          {error ? <Banner tone="danger" title="Payment didn’t go through" message={error} /> : null}
        </View>
      )}
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text variant={strong ? 'bodyStrong' : 'body'} style={styles.flex}>{label}</Text>
      <Text variant={strong ? 'title2' : 'body'}>{value}</Text>
    </View>
  );
}

function ResultView(p: {
  outcome: PaymentResult['outcome'];
  amount: number;
  reference: string | null;
  title: string;
  onBooking: () => void;
  onReceipt: () => void;
  onFindOther: () => void;
}) {
  if (p.outcome === 'success') {
    return (
      <View style={styles.result} testID="payment-success">
        <Icon as={CircleCheck} size={56} color={colors.success} />
        <Text variant="title2" style={styles.center}>Booking confirmed</Text>
        <Text variant="callout" tone="muted" style={styles.center}>
          Demo payment of {formatPeso(p.amount, { showCentavos: 'always' })} succeeded for {p.title}.{p.reference ? ` Reference ${p.reference}.` : ''} No real money moved.
        </Text>
        <Button label="View receipt" fullWidth onPress={p.onReceipt} testID="view-receipt" />
        <Button label="View booking" variant="secondary" fullWidth onPress={p.onBooking} />
      </View>
    );
  }
  const expired = p.outcome === 'expired';
  return (
    <View style={styles.result} testID={expired ? 'payment-expired' : 'payment-failed'}>
      <Icon as={expired ? TimerOff : CircleX} size={56} color={expired ? colors.textMuted : colors.danger} />
      <Text variant="title2" style={styles.center}>{expired ? 'Payment window closed' : 'Payment failed'}</Text>
      <Text variant="callout" tone="muted" style={styles.center}>
        {expired
          ? 'The hold ran out before payment, so the dates were released. Nothing was charged.'
          : 'The demo payment was declined, so the hold was released. Nothing was charged.'}{' '}
        You can send a new request if the dates are still free.
      </Text>
      <Button label="Choose dates again" fullWidth onPress={p.onFindOther} />
      <Button label="View booking" variant="secondary" fullWidth onPress={p.onBooking} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  scenario: { gap: spacing.sm },
  result: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
});
