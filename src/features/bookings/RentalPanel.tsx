import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarPlus, CircleCheck, Handshake, PackageCheck, PackageX, Scale, TriangleExclamationPoint, Undo2 } from 'lucide-react-native';
import { Banner, Button, Icon, StatusPill, Text, useToast } from '@/components/design-system';
import { DISPUTE_CATEGORY_LABEL, DISPUTE_STATUS_LABEL, lateFeeSettlement } from '@/domain/exceptions';
import { rentalActions } from '@/domain/rental';
import { todayInBusinessTz } from '@/lib/dates';
import { formatDateTimeManila } from '@/lib/format';
import { formatPeso } from '@/lib/money';
import { bookingFlowRepository, type BookingDetail } from '@/repositories';
import { colors, radii, spacing } from '@/theme';
import { EvidencePhotos } from './EvidencePhotos';
import { EvidenceSheet } from './EvidenceSheet';
import { ProblemSheet, type ProblemMode } from './ProblemSheet';

type Sheet = 'handover' | 'return' | 'inspect' | ProblemMode | null;

/**
 * After checkout (plan Phase 9–10): handover and receipt, return, inspection with late-fee settlement,
 * problem reports that open a moderated dispute, and overdue/disputed/completed states. Each side sees
 * where things stand and only their own actions.
 */
export function RentalPanel({ d, userId, onChanged }: { d: BookingDetail; userId: string; onChanged: () => void }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const actions = rentalActions({
    role: d.myRole,
    status: d.status,
    today: todayInBusinessTz(),
    handoverOpensOn: d.handoverOpensOn,
    returnDate: d.returnDate,
    handover: d.handover,
    dueAt: d.dueAt,
    // Server time when the booking was read; the server re-checks the due time on every action.
    nowMs: Date.parse(d.serverNow),
    hasOpenExtension: d.extensions.some((e) => e.status === 'pending' || e.status === 'approved_awaiting_payment'),
    lateDaysNow: d.lateDaysNow,
  });
  const lender = d.myRole === 'lender';
  const other = d.counterpart.fullName.split(' ')[0] || (lender ? 'The borrower' : 'The lender');
  const late = lateFeeSettlement(d.lateDaysNow, d.lateFeePerDay, d.deposit);

  const finish = (title: string, message?: string) => async (result: Promise<{ ok: boolean; error?: { message: string } }>) => {
    const r = await result;
    if (!r.ok) return r.error?.message ?? 'That didn’t work. Try again.';
    setSheet(null);
    toast.show({ title, message, tone: 'success' });
    onChanged();
    return null;
  };
  const opened = (disputeId: string) => {
    setSheet(null);
    toast.show({ title: 'Report sent', message: 'A TigRent moderator will review it.', tone: 'success' });
    router.push({ pathname: '/dispute/[id]', params: { id: disputeId } });
  };

  const showsPanel = ['confirmed', 'active', 'overdue', 'return_requested', 'disputed', 'completed'].includes(d.status);
  if (!showsPanel) return null;

  const refund = d.refunds.find((f) => f.status === 'succeeded');
  const lateFeeTaken = d.returnInfo?.lateFee ? Math.min(d.returnInfo.lateFee, d.deposit) : 0;

  return (
    <View style={styles.root} testID="rental-panel">
      {d.status === 'confirmed' ? (
        <>
          <Step done={Boolean(d.handover?.lenderConfirmedAt)} title={lender ? 'You hand the item over' : `${other} hands the item over`} at={d.handover?.lenderConfirmedAt} note={d.handover?.lenderNotes} />
          <Step done={Boolean(d.handover?.borrowerConfirmedAt)} title={lender ? `${other} confirms receipt` : 'You confirm what you received'} at={d.handover?.borrowerConfirmedAt} note={d.handover?.borrowerNotes} />
          <Text variant="footnote" tone="muted">The rental starts when both steps are done. Handover opens the day before pickup.</Text>
          {actions.handover ? (
            <Button
              label={lender ? 'Confirm handover' : 'Confirm receipt'}
              icon={Handshake}
              fullWidth
              disabled={!actions.handover.enabled}
              disabledReason={actions.handover.reason}
              onPress={() => setSheet('handover')}
              testID="confirm-handover"
            />
          ) : null}
        </>
      ) : null}

      {d.status === 'active' || d.status === 'overdue' ? (
        <>
          {d.status === 'overdue' ? (
            <Banner
              tone="danger"
              title={`Overdue by ${d.lateDaysNow} day${d.lateDaysNow === 1 ? '' : 's'}`}
              message={
                lender
                  ? `${other} hasn’t returned the item. Message them first. The agreed late fee (${formatPeso(d.lateFeePerDay)}/day, ${formatPeso(d.lateFeeNow)} so far) comes out of the deposit at return. If it isn’t coming back, report it below.`
                  : `Return it as soon as possible and message ${other}. The agreed late fee is ${formatPeso(d.lateFeePerDay)} per started day (${formatPeso(d.lateFeeNow)} so far), taken from your deposit at return.`
              }
            />
          ) : (
            <Text variant="callout">Due back {formatDateTimeManila(d.dueAt)}.</Text>
          )}
          {actions.extend ? (
            <Button
              label="Request more days"
              variant="secondary"
              icon={CalendarPlus}
              fullWidth
              disabled={!actions.extend.enabled}
              disabledReason={actions.extend.reason}
              onPress={() => router.push({ pathname: '/booking/[id]/extend', params: { id: d.id } })}
              testID="request-extension"
            />
          ) : null}
          {actions.returnItem ? <Button label="Return item" icon={Undo2} fullWidth onPress={() => setSheet('return')} testID="return-item" /> : null}
          {actions.reportNotReturned ? (
            <Button label="Report not returned" variant="secondary" icon={PackageX} fullWidth onPress={() => setSheet('not_returned')} testID="report-not-returned" />
          ) : null}
          {lender && d.status === 'active' ? <Text variant="footnote" tone="muted">{other} submits the return; then you inspect it here.</Text> : null}
        </>
      ) : null}

      {d.status === 'return_requested' ? (
        <>
          <Step done title={lender ? `${other} returned the item` : 'You returned the item'} at={d.returnInfo?.requestedAt} note={d.returnInfo?.borrowerNotes} />
          <Step done={false} title={lender ? 'You inspect and confirm' : `${other} inspects and confirms`} />
          {d.lateDaysNow > 0 ? (
            <Banner
              tone="warning"
              title={`Returned ${d.lateDaysNow} day${d.lateDaysNow === 1 ? '' : 's'} late`}
              message={`Agreed late fee: ${d.lateDaysNow} × ${formatPeso(d.lateFeePerDay)} = ${formatPeso(late.fee)}, taken from the deposit${late.uncollected > 0 ? ` (capped at the ${formatPeso(d.deposit)} deposit; the prototype collects nothing beyond it)` : ''}. ${formatPeso(late.released)} of the deposit goes back to ${lender ? other : 'you'}.`}
              testID="late-fee-preview"
            />
          ) : null}
          {actions.inspect ? (
            <>
              <Button label={d.lateDaysNow > 0 ? 'Confirm return (late fee applies)' : 'Confirm clean return'} icon={PackageCheck} fullWidth onPress={() => setSheet('inspect')} testID="confirm-clean-return" />
              <Button label="Report a problem" variant="secondary" icon={TriangleExclamationPoint} fullWidth onPress={() => setSheet('return_problem')} testID="report-return-problem" />
            </>
          ) : (
            <Text variant="footnote" tone="muted">Your {formatPeso(d.deposit)} deposit is released after the inspection{d.lateDaysNow > 0 ? ', minus the agreed late fee' : ''}.</Text>
          )}
        </>
      ) : null}

      {actions.reportProblem ? (
        <Button label="Report a problem" variant="ghost" icon={TriangleExclamationPoint} onPress={() => setSheet('borrower')} testID="report-problem" />
      ) : null}

      {d.status === 'disputed' && d.dispute ? (
        <View style={styles.dispute} testID="dispute-banner">
          <Icon as={Scale} color={colors.link} />
          <View style={styles.flex}>
            <Text variant="bodyStrong">{DISPUTE_CATEGORY_LABEL[d.dispute.category]} case</Text>
            <Text variant="footnote" tone="muted">The deposit stays held until a TigRent moderator decides.</Text>
          </View>
          <StatusPill label={DISPUTE_STATUS_LABEL[d.dispute.status].label} tone={DISPUTE_STATUS_LABEL[d.dispute.status].tone} />
        </View>
      ) : null}
      {d.dispute ? (
        <Button label="Open the case" variant={d.status === 'disputed' ? 'primary' : 'secondary'} icon={Scale} fullWidth onPress={() => router.push({ pathname: '/dispute/[id]', params: { id: d.dispute!.id } })} testID="open-dispute" />
      ) : null}

      {d.status === 'completed' ? (
        <View style={styles.done}>
          <Icon as={CircleCheck} color={colors.success} />
          <Text variant="callout" style={styles.flex}>
            {d.returnInfo?.outcome === 'late' ? `Returned ${d.returnInfo.lateDays} day${d.returnInfo.lateDays === 1 ? '' : 's'} late` : 'Returned in the agreed condition'}
            {d.returnInfo?.inspectedAt ? ` (${formatDateTimeManila(d.returnInfo.inspectedAt)})` : ''}.
            {lateFeeTaken > 0 ? ` Late fee ${formatPeso(lateFeeTaken)} taken from the deposit.` : ''}
            {refund ? ` ${formatPeso(refund.amount)} refunded to ${lender ? other : 'you'} (simulated).` : ''}
          </Text>
        </View>
      ) : null}

      <EvidencePhotos paths={d.handover?.photoPaths ?? []} label="Handover photos" />
      <EvidencePhotos paths={[...(d.returnInfo?.borrowerPhotoPaths ?? []), ...(d.returnInfo?.lenderPhotoPaths ?? [])]} label="Return photos" />

      <EvidenceSheet
        visible={sheet === 'handover'}
        onClose={() => setSheet(null)}
        title={lender ? 'Confirm handover' : 'Confirm receipt'}
        description={lender ? 'Confirm you handed the item over. Note its condition and what was included.' : 'Check the item now. Note anything that differs from the listing before you confirm.'}
        notesLabel="Condition notes (optional)"
        notesPlaceholder={lender ? 'e.g. With case and charger; small scratch on lid' : 'e.g. Works fine; scratch on lid as noted'}
        submitLabel={lender ? 'Confirm handover' : 'Confirm receipt and start rental'}
        bookingId={d.id}
        userId={userId}
        onSubmit={(notes, photos) => finish(lender ? 'Handover confirmed' : 'Rental started', lender ? `${other} confirms receipt next.` : undefined)(bookingFlowRepository.confirmHandover(d.id, notes, photos))}
        testID="handover-sheet"
      />
      <EvidenceSheet
        visible={sheet === 'return'}
        onClose={() => setSheet(null)}
        title="Return item"
        description={`Submit after you’ve handed the item back to ${other}. They inspect it and confirm; your deposit is released after that${d.lateDaysNow > 0 ? `, minus the agreed late fee (${formatPeso(Math.min(d.lateFeeNow, d.deposit))} so far)` : ''}.`}
        notesLabel="Return notes (optional)"
        notesPlaceholder="e.g. Left at the library desk with the case"
        submitLabel="Submit return"
        bookingId={d.id}
        userId={userId}
        onSubmit={(notes, photos) => finish('Return submitted', `${other} will inspect it.`)(bookingFlowRepository.submitReturn(d.id, notes, photos))}
        testID="return-sheet"
      />
      <EvidenceSheet
        visible={sheet === 'inspect'}
        onClose={() => setSheet(null)}
        title={d.lateDaysNow > 0 ? 'Confirm return' : 'Confirm clean return'}
        description={
          d.lateDaysNow > 0
            ? `Confirm it came back in the agreed condition. The ${formatPeso(late.withheld)} late fee is taken from the deposit and ${formatPeso(late.released)} goes back to ${other} (simulated). This completes the rental.`
            : `Confirm the item came back in the agreed condition. This completes the rental and releases ${other}’s ${formatPeso(d.deposit)} deposit (simulated refund).`
        }
        notesLabel="Inspection notes (optional)"
        submitLabel="Confirm return"
        bookingId={d.id}
        userId={userId}
        onSubmit={(notes, photos) => finish('Rental complete', late.withheld > 0 ? `Late fee ${formatPeso(late.withheld)} recorded.` : 'The deposit was released.')(bookingFlowRepository.confirmCleanReturn(d.id, notes, photos))}
        testID="inspect-sheet"
      />
      {sheet === 'return_problem' || sheet === 'not_returned' || sheet === 'borrower' ? (
        <ProblemSheet d={d} mode={sheet} visible onClose={() => setSheet(null)} userId={userId} onOpened={opened} />
      ) : null}
    </View>
  );
}

function Step({ done, title, at, note }: { done: boolean; title: string; at?: string | null; note?: string | null }) {
  return (
    <View style={styles.step} accessibilityLabel={`${title}: ${done ? 'done' : 'not yet'}`}>
      <View style={[styles.check, done && styles.checkDone]}>{done ? <Icon as={CircleCheck} size="sm" color={colors.textOnGold} /> : null}</View>
      <View style={styles.flex}>
        <Text variant="bodyStrong" tone={done ? undefined : 'muted'}>{title}</Text>
        {at ? <Text variant="caption" tone="muted">{formatDateTimeManila(at)}</Text> : null}
        {note ? <Text variant="footnote" tone="muted">“{note}”</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkDone: { backgroundColor: colors.success, borderColor: colors.success },
  done: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dispute: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
