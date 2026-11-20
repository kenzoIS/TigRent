import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleCheck, CircleX, Clock, ShieldCheck, TimerOff } from 'lucide-react-native';
import { Banner, Button, DateField, EmptyState, ErrorState, Icon, LoadingRows, Screen, ScreenHeader, SegmentedControl, StatusPill, Text } from '@/components/design-system';
import { formatCountdown } from '@/domain/bookings';
import { EXTENSION_LABEL, extensionQuote } from '@/domain/rental';
import { dueLabelFor } from '@/domain/pricing';
import { useHoldCountdown } from '@/features/bookings/useHoldCountdown';
import { addDays, compareDateOnly, formatDateOnly, type DateOnly } from '@/lib/dates';
import { ok } from '@/lib/errors';
import { formatDateTimeManila } from '@/lib/format';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { newIdempotencyKey, paymentProvider } from '@/providers/payments/mock';
import type { DemoScenario, PaymentResult } from '@/providers/payments/types';
import { bookingFlowRepository, discoveryRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const SCENARIOS = [
  { value: 'success', label: 'Simulate success' },
  { value: 'failure', label: 'Simulate failure' },
] as const;

/**
 * Extension request and status (plan §2.8, §4.2): pick a later return date, see the extra rent, send it;
 * after the lender approves, pay (demo). The due date changes only when that payment succeeds.
 */
export default function ExtendRental() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useAsync(async () => {
    const detail = await bookingFlowRepository.detail(id);
    if (!detail.ok) return detail;
    const [window, ranges] = await Promise.all([
      discoveryRepository.requestWindow(),
      discoveryRepository.unavailableDates(detail.data.listingId, addDays(detail.data.returnDate, 1), addDays(detail.data.pickupDate, 60)),
    ]);
    return ok({ d: detail.data, maxRentalDays: window.ok ? window.data.maxRentalDays : 30, ranges: ranges.ok ? ranges.data : [] });
  }, [id]);
  const v = data.data;
  const d = v?.d;
  const open = d?.extensions.find((e) => e.status === 'pending' || e.status === 'approved_awaiting_payment') ?? null;

  const [newReturn, setNewReturn] = useState<DateOnly | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<DemoScenario>('success');
  const [key] = useState(() => newIdempotencyKey(id));
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<PaymentResult | null>(null);

  const hold = useMemo(
    () => (d && open?.status === 'approved_awaiting_payment' ? { holdExpiresAt: open.holdExpiresAt, serverNow: d.serverNow, fetchedAtMs: d.fetchedAtMs } : null),
    [d, open],
  );
  const seconds = useHoldCountdown(hold, Boolean(hold) && !result, () => void data.reload());

  const unavailable = useMemo(() => {
    if (!v) return undefined;
    return (day: DateOnly) => {
      const hit = v.ranges.find((r) => compareDateOnly(day, r.startDate) >= 0 && compareDateOnly(day, r.endDate) <= 0);
      return hit ? (hit.reason === 'booked' ? 'Booked' : 'Unavailable') : null;
    };
  }, [v]);
  const quote = d && newReturn ? extensionQuote({ dailyRate: d.dailyRate, commissionBps: d.commissionBps, oldReturn: d.returnDate, newReturn }) : null;
  const blockedDay = useMemo(() => {
    if (!d || !newReturn || !unavailable) return null;
    for (let day = addDays(d.returnDate, 1); compareDateOnly(day, newReturn) <= 0; day = addDays(day, 1)) if (unavailable(day)) return day;
    return null;
  }, [d, newReturn, unavailable]);
  const canRequest = d?.myRole === 'borrower' && d.status === 'active' && Date.parse(d.serverNow) < Date.parse(d.dueAt);

  const send = async () => {
    if (!newReturn || sending) return;
    setSending(true);
    setError(null);
    const r = await bookingFlowRepository.requestExtension(id, newReturn);
    setSending(false);
    if (!r.ok) return setError(r.error.message);
    setNewReturn(null);
    void data.reload();
  };
  const pay = async () => {
    if (!open || paying || result) return;
    setPaying(true);
    setError(null);
    const r = await paymentProvider.payExtension({ extensionId: open.id, idempotencyKey: key, scenario });
    setPaying(false);
    if (r.ok) setResult(r.data);
    else setError(r.error.message);
  };

  const footer = !d || result
    ? undefined
    : open?.status === 'approved_awaiting_payment' && seconds > 0
      ? <Button label={`Pay ${formatPeso(open.extraAmount, { showCentavos: 'always' })} (demo)`} icon={ShieldCheck} fullWidth loading={paying} onPress={pay} testID="pay-extension" />
      : !open && canRequest
        ? <Button label="Request extension" fullWidth loading={sending} onPress={send} disabled={!quote || quote.extraDays < 1 || Boolean(blockedDay)} disabledReason={!newReturn ? 'Choose a new return date.' : blockedDay ? 'Some of those days are taken.' : undefined} testID="send-extension" />
        : undefined;

  return (
    <Screen footer={footer} refreshing={data.loading && Boolean(v)} onRefresh={data.reload}>
      <ScreenHeader title="More days" size="compact" back />
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={data.reload} />
      ) : !d || !v ? (
        <LoadingRows rows={3} label="Loading rental" />
      ) : d.myRole !== 'borrower' ? (
        <EmptyState title="Only the borrower asks for more days" message="As the lender, approve or decline extension requests from the booking." />
      ) : result ? (
        <ResultView result={result} onDone={() => router.back()} />
      ) : open ? (
        <View style={styles.body}>
          <View style={styles.card}>
            <View style={styles.head}>
              <Text variant="headline" style={styles.flex}>Until {formatDateOnly(open.newReturnDate)}</Text>
              <StatusPill label={EXTENSION_LABEL[open.status].label} tone={EXTENSION_LABEL[open.status].tone} />
            </View>
            <Text variant="callout">+{open.extraDays} day{open.extraDays === 1 ? '' : 's'} · extra rent {formatPeso(open.extraAmount)} at the agreed {formatPeso(d.dailyRate)}/day</Text>
            <Text variant="footnote" tone="muted">Your return date stays {formatDateOnly(d.returnDate)} until the extra payment succeeds.</Text>
          </View>
          {open.status === 'pending' ? (
            <Banner tone="info" title="Waiting for the lender" message="You’ll get a notification when they approve or decline." />
          ) : seconds > 0 ? (
            <>
              <View style={styles.timer} accessibilityLiveRegion="polite" testID="extension-timer">
                <StatusPill label="Demo payment" tone="info" />
                <Icon as={Clock} size="sm" color={seconds > 120 ? colors.link : colors.danger} />
                <Text variant="bodyStrong">{formatCountdown(seconds)} left to pay</Text>
              </View>
              <Banner tone="info" title="Simulated checkout" message="No card, GCash, Maya or bank details are asked for, and no real money moves." />
              <SegmentedControl segments={SCENARIOS} value={scenario} onChange={setScenario} accessibilityLabel="Demo payment outcome" testID="extension-scenario" />
            </>
          ) : (
            <Banner tone="neutral" title="Payment window closing…" message="Pull down to refresh." />
          )}
          {error ? <Banner tone="danger" title="That didn’t work" message={error} /> : null}
        </View>
      ) : !canRequest ? (
        <EmptyState title="Extensions aren’t available" message="You can ask for more days only during an active rental, before the due time." />
      ) : (
        <View style={styles.body}>
          <Text variant="callout">Currently due {formatDateTimeManila(d.dueAt)}. Pick a later return date; the lender approves it, then you pay the extra days (demo).</Text>
          <DateField
            label="New return date"
            value={newReturn}
            onChange={setNewReturn}
            minDate={addDays(d.returnDate, 1)}
            maxDate={addDays(d.pickupDate, v.maxRentalDays - 1)}
            unavailableReason={unavailable}
            helper={`Up to ${v.maxRentalDays} days in total (sample setting). Crossed-out days are taken.`}
            testID="new-return-date"
          />
          {quote && quote.extraDays > 0 ? (
            <View style={styles.card} testID="extension-quote">
              <Row label={`${formatPeso(d.dailyRate)} × ${quote.extraDays} extra day${quote.extraDays === 1 ? '' : 's'}`} value={formatPeso(quote.extraAmount)} />
              <Text variant="footnote" tone="muted">Your deposit doesn’t change. New due time: {dueLabelFor(newReturn!, d.snapshot.returnDueTimeLocal)}.</Text>
            </View>
          ) : null}
          {blockedDay ? <Banner tone="warning" title="Those days aren’t free" message={`${formatDateOnly(blockedDay)} is already taken. Choose an earlier date.`} /> : null}
          {error ? <Banner tone="danger" title="Request not sent" message={error} /> : null}
        </View>
      )}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text variant="body" style={styles.flex}>{label}</Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

function ResultView({ result, onDone }: { result: PaymentResult; onDone: () => void }) {
  const ok = result.outcome === 'success';
  const expired = result.outcome === 'expired';
  return (
    <View style={styles.result} testID={ok ? 'extension-paid' : expired ? 'extension-expired' : 'extension-failed'}>
      <Icon as={ok ? CircleCheck : expired ? TimerOff : CircleX} size={56} color={ok ? colors.success : expired ? colors.textMuted : colors.danger} />
      <Text variant="title2" style={styles.center}>{ok ? 'Extension confirmed' : expired ? 'Payment window closed' : 'Payment failed'}</Text>
      <Text variant="callout" tone="muted" style={styles.center}>
        {ok
          ? `Demo payment of ${formatPeso(result.amount, { showCentavos: 'always' })} succeeded. Your new return date is on the booking. No real money moved.`
          : 'Your original return date stands. Nothing was charged.'}
      </Text>
      <Button label="Back to rental" fullWidth onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  result: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
});
