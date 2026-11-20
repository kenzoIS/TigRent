import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { BadgeCheck, CalendarCheck, CalendarX, Clock, MapPin, MessageCircle, Receipt, Star, StickyNote } from 'lucide-react-native';
import { Banner, Button, Chip, Dialog, ErrorState, Icon, ListRow, LoadingRows, Screen, ScreenHeader, Sheet, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import { Group, Section } from '@/components/shared/Layout';
import { bookingActions, checkRejectReason, CONFLICT_MESSAGE, formatCountdown, REJECT_REASONS } from '@/domain/bookings';
import { dueLabelFor } from '@/domain/pricing';
import { PriceBreakdown } from '@/features/booking/PriceBreakdown';
import { useSession } from '@/features/auth/session';
import { BookingTimeline } from '@/features/bookings/BookingTimeline';
import { ExtensionCards } from '@/features/bookings/ExtensionCard';
import { RentalPanel } from '@/features/bookings/RentalPanel';
import { BookingReviewCard } from '@/features/reviews/BookingReviewCard';
import { RentalTimeline } from '@/features/bookings/RentalTimeline';
import { CancelSheet } from '@/features/bookings/CancelSheet';
import { canOfferCancel } from '@/domain/exceptions';
import { rentalMilestones } from '@/domain/rental';
import { LenderPayout } from '@/features/bookings/LenderPayout';
import { statusExplainer, statusLabelFor } from '@/features/bookings/status';
import { useHoldCountdown } from '@/features/bookings/useHoldCountdown';
import { formatDateOnly } from '@/lib/dates';
import { formatDateTimeManila } from '@/lib/format';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { bookingFlowRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/**
 * One booking for either party (plan §4.2 "rental detail", §4.3 "booking request detail with
 * accept/reject and conflict explanation"). Every action is a server RPC; this screen only offers them.
 */
export default function BookingDetailScreen() {
  const { id, sent } = useLocalSearchParams<{ id: string; sent?: string }>();
  const toast = useToast();
  const { context } = useSession();
  const userId = context?.userId ?? '';
  const [showHistory, setShowHistory] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const data = useAsync(() => bookingFlowRepository.detail(id), [id]);
  const d = data.data;
  const seconds = useHoldCountdown(d, d?.status === 'awaiting_payment', () => void data.reload());
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const actions = d
    ? bookingActions({ role: d.myRole, status: d.status, conflict: d.conflict, holdSeconds: seconds, hasPaymentRecord: d.payments.length > 0 })
    : null;

  const accept = async () => {
    if (busy) return;
    setBusy('accept');
    setActionError(null);
    const r = await bookingFlowRepository.decide(id, 'accept');
    setBusy(null);
    setConfirmAccept(false);
    if (!r.ok) {
      setActionError(r.error.message);
    } else {
      toast.show({ title: 'Request accepted', message: 'The dates are held while the borrower pays.', tone: 'success' });
    }
    await data.reload();
  };

  const reject = async () => {
    const problem = checkRejectReason(reason);
    setReasonError(problem);
    if (problem || busy) return;
    setBusy('reject');
    setActionError(null);
    const r = await bookingFlowRepository.decide(id, 'reject', reason);
    setBusy(null);
    if (!r.ok) {
      setReasonError(r.error.message);
      return;
    }
    setRejectOpen(false);
    toast.show({ title: 'Request declined', message: 'The borrower has been told why.', tone: 'neutral' });
    await data.reload();
  };

  const label = d ? statusLabelFor(d.myRole, d.status) : null;
  const holdMinutesLabel = d?.holdExpiresAt ? formatDateTimeManila(d.holdExpiresAt).split(', ')[1] : '';

  const footer = !d || !actions ? undefined : actions.reject ? (
    <View style={styles.footerRow}>
      <Button label="Decline" variant="secondary" onPress={() => { setReasonError(null); setRejectOpen(true); }} style={styles.flex} testID="reject-request" />
      <Button
        label="Accept"
        onPress={() => setConfirmAccept(true)}
        style={styles.flex}
        disabled={!actions.accept?.enabled}
        disabledReason={actions.accept?.enabled ? undefined : 'Can’t accept: see the note above.'}
        testID="accept-request"
      />
    </View>
  ) : actions.pay ? (
    <Button label={`Pay ${formatPeso(d.total)} (demo)`} fullWidth onPress={() => router.push({ pathname: '/booking/[id]/checkout', params: { id } })} testID="go-to-checkout" />
  ) : undefined;

  return (
    <Screen footer={footer} refreshing={data.loading && Boolean(d)} onRefresh={data.reload}>
      <ScreenHeader title={d?.snapshot.listingTitle || 'Booking'} eyebrow={d?.myRole === 'lender' ? 'Booking request' : 'My rental'} size="compact" back />
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={data.reload} />
      ) : !d || !label || !actions ? (
        <LoadingRows rows={4} label="Loading booking" />
      ) : (
        <View style={styles.body}>
          {sent === '1' && d.status === 'pending_lender_approval' ? (
            <Banner tone="success" title="Request sent" message="The lender has been notified. Nothing is charged unless they accept and you complete the demo payment." />
          ) : null}

          <View style={styles.statusCard} testID="booking-status">
            <View style={styles.statusHead}>
              <StatusPill label={label.label} tone={label.tone} />
              <Text variant="footnote" tone="muted" style={styles.flex}>
                {formatDateOnly(d.pickupDate)} → {formatDateOnly(d.returnDate)} · {d.rentalDays} day{d.rentalDays === 1 ? '' : 's'}
              </Text>
            </View>
            <Text variant="callout">{statusExplainer(d.myRole, d.status, { cancelReason: d.cancelReason })}</Text>
            {d.status === 'rejected' && d.decisionReason ? (
              <Text variant="callout" tone="muted">{d.myRole === 'lender' ? 'Your reason' : 'Lender’s reason'}: “{d.decisionReason}”</Text>
            ) : null}
            {d.status === 'awaiting_payment' ? (
              <View style={styles.timer} accessibilityLiveRegion="polite" testID="hold-timer">
                <Icon as={Clock} size="sm" color={seconds > 120 ? colors.link : colors.danger} />
                <Text variant="bodyStrong">{seconds > 0 ? `${formatCountdown(seconds)} left to pay` : 'Payment window closing…'}</Text>
                <Text variant="footnote" tone="muted">(until {holdMinutesLabel})</Text>
              </View>
            ) : null}
          </View>

          {actionError ? <Banner tone="danger" title="That didn’t work" message={actionError} /> : null}
          {d.myRole === 'lender' && d.conflict ? (
            <Banner tone="warning" title={CONFLICT_MESSAGE[d.conflict].title} message={CONFLICT_MESSAGE[d.conflict].message} testID="request-conflict" />
          ) : null}

          <RentalPanel d={d} userId={userId} onChanged={() => void data.reload()} />
          <BookingReviewCard d={d} />
          <ExtensionCards d={d} onChanged={() => void data.reload()} />

          <Section title={d.myRole === 'lender' ? 'Borrower' : 'Lender'}>
            <Group>
              <ListRow
                icon={d.counterpart.isStudentVerified ? BadgeCheck : Star}
                title={d.counterpart.fullName}
                subtitle={[
                  d.counterpart.isStudentVerified ? 'Verified student' : 'Verification not current',
                  d.counterpart.ratingCount > 0 ? `${d.counterpart.ratingAvg?.toFixed(1)}★ as ${d.counterpart.role} (${d.counterpart.ratingCount})` : `No ${d.counterpart.role} reviews yet`,
                ].join(' · ')}
                onPress={d.myRole === 'borrower' ? () => router.push({ pathname: '/explore/lender/[id]', params: { id: d.counterpart.id } }) : undefined}
                showChevron={d.myRole === 'borrower'}
              />
              {d.conversationId && d.myRole !== 'staff' ? (
                <ListRow
                  icon={MessageCircle}
                  title={`Message ${d.counterpart.fullName.split(' ')[0]}`}
                  subtitle="Arrange pickup and return in TigRent"
                  onPress={() => router.push({ pathname: '/messages/[id]', params: { id: d.conversationId! } })}
                  showChevron
                  testID="open-conversation"
                />
              ) : null}
            </Group>
          </Section>

          <Section title="Pickup and return">
            <Group>
              <ListRow icon={MapPin} title={d.snapshot.pickupPoint ?? 'Pickup point to be arranged in messages'} subtitle={d.snapshot.pickupNotes ?? undefined} />
              <ListRow icon={CalendarCheck} title={`Pickup ${formatDateOnly(d.pickupDate)}`} subtitle={`Return by ${dueLabelFor(d.returnDate, d.snapshot.returnDueTimeLocal)}`} />
              {d.pickupArrangement ? <ListRow icon={StickyNote} title="Borrower’s note" subtitle={d.pickupArrangement} /> : null}
            </Group>
          </Section>

          <Section title="Agreed price">
            {d.myRole === 'lender' ? (
              <LenderPayout rentalDays={d.rentalDays} dailyRate={d.dailyRate} subtotal={d.subtotal} commissionBps={d.commissionBps} commission={d.commission} lenderNet={d.lenderNet} deposit={d.deposit} />
            ) : (
              <PriceBreakdown
                rentalDays={d.rentalDays}
                dailyRate={d.dailyRate}
                subtotal={d.subtotal}
                deposit={d.deposit}
                total={d.total}
                lateFeePerDay={d.lateFeePerDay}
                pickupDate={d.pickupDate}
                returnDate={d.returnDate}
                dueTimeLocal={d.snapshot.returnDueTimeLocal}
                confirmed
              />
            )}
            <Text variant="footnote" tone="muted">
              Locked when the request was sent; paid extensions add their days. Later listing edits don’t change this booking.
              {d.terms ? ` Accepted: ${d.terms.title}, version ${d.terms.version}${d.terms.isSample ? ' (prototype text)' : ''}.` : ''}
              {d.snapshot.policyLabel ? ` Cancellation: ${d.snapshot.policyLabel}.` : ''}
            </Text>
          </Section>

          {canOfferCancel(d.myRole, d.status) ? (
            <Group>
              <ListRow
                icon={CalendarX}
                title={d.status === 'pending_lender_approval' ? 'Cancel request' : 'Cancel booking'}
                subtitle="See the refund under the cancellation policy before you confirm"
                onPress={() => setCancelOpen(true)}
                destructive
                showChevron
                testID="open-cancel"
              />
            </Group>
          ) : null}

          {actions.receipt ? (
            <Group>
              <ListRow icon={Receipt} title="Payment record" subtitle="Demo receipt and payment attempts" onPress={() => router.push({ pathname: '/booking/[id]/receipt', params: { id } })} showChevron testID="open-receipt" />
            </Group>
          ) : null}

          <Section title="Rental timeline">
            <RentalTimeline
              milestones={rentalMilestones({
                status: d.status,
                createdAt: d.createdAt,
                events: d.events,
                pickupDate: d.pickupDate,
                dueAt: d.dueAt,
                extendedTimes: d.extensions.filter((e) => e.status === 'paid').length,
              })}
            />
            <Button label={showHistory ? 'Hide full history' : 'Show full history'} variant="ghost" size="sm" onPress={() => setShowHistory((s) => !s)} testID="toggle-history" />
            {showHistory ? <BookingTimeline events={d.events} /> : null}
          </Section>
          <Text variant="footnote" tone="muted" style={styles.center}>Requested {formatDateTimeManila(d.createdAt)}</Text>
        </View>
      )}

      {d && cancelOpen ? (
        <CancelSheet
          d={d}
          visible
          onClose={() => setCancelOpen(false)}
          onDone={(q) => {
            setCancelOpen(false);
            toast.show({ title: 'Cancelled', message: q.refundTotal > 0 ? `${formatPeso(q.refundTotal)} refunded (simulated).` : 'Nothing was charged.', tone: 'neutral' });
            void data.reload();
          }}
        />
      ) : null}
      <Dialog
        visible={confirmAccept}
        title="Accept this request?"
        message={d ? `${d.counterpart.fullName.split(' ')[0]} gets a short window to complete the demo payment. The dates are held for them until then, and other requests for these dates can’t be accepted.` : ''}
        confirmLabel="Accept and hold dates"
        loading={busy === 'accept'}
        onConfirm={accept}
        onCancel={() => setConfirmAccept(false)}
        testID="accept-dialog"
      />
      <Sheet
        visible={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Decline request"
        description="The borrower sees this reason. Nothing has been charged."
        footer={<Button label="Decline request" variant="danger" fullWidth loading={busy === 'reject'} onPress={reject} testID="confirm-reject" />}
      >
        <View style={styles.sheetBody}>
          <View style={styles.wrap}>
            {REJECT_REASONS.map((r) => <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}
          </View>
          <TextField label="Reason" value={reason} onChangeText={setReason} multiline maxLength={300} error={reasonError} placeholder="Or write your own" testID="reject-reason" />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  statusCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timer: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, flexWrap: 'wrap' },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  sheetBody: { gap: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
});
