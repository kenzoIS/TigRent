import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Gavel, MessageSquarePlus, Scale } from 'lucide-react-native';
import { Banner, Button, Chip, Dialog, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, SegmentedControl, Sheet, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import { Group, Section } from '@/components/shared/Layout';
import { DECIDED, DISPUTE_CATEGORY_LABEL, DISPUTE_STATUS_LABEL, decisionPreview } from '@/domain/exceptions';
import { useSession } from '@/features/auth/session';
import { EvidencePhotos } from '@/features/bookings/EvidencePhotos';
import { EvidenceSheet } from '@/features/bookings/EvidenceSheet';
import { formatDateOnly } from '@/lib/dates';
import { formatDateTimeManila } from '@/lib/format';
import { formatPeso, parsePesoInput } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { disputesRepository, type DisputeDetail } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const ROLE_LABEL = { borrower: 'Borrower', lender: 'Lender', staff: 'TigRent moderator' } as const;

/**
 * A dispute case (plan §2.7, Phase 10): what was reported, private evidence, both sides' replies, the
 * moderator's decision with who receives what, and a one-time appeal. Staff decide from this screen.
 */
export default function DisputeCase() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { context } = useSession();
  const toast = useToast();
  const data = useAsync(() => disputesRepository.get(id), [id]);
  const d = data.data;
  const [replyOpen, setReplyOpen] = useState(false);
  const [requestFrom, setRequestFrom] = useState<'borrower' | 'lender' | null>(null);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealText, setAppealText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const decided = d ? DECIDED.includes(d.status) : false;
  const staff = d?.myRole === 'staff';
  const label = d ? DISPUTE_STATUS_LABEL[d.status] : null;
  const awaitingMe = d && ((d.status === 'awaiting_borrower_response' && d.myRole === 'borrower') || (d.status === 'awaiting_lender_response' && d.myRole === 'lender'));

  const appeal = async () => {
    setBusy(true);
    setError(null);
    const r = await disputesRepository.appeal(id, appealText);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setAppealOpen(false);
    toast.show({ title: 'Appeal sent', message: 'A moderator will review the decision.', tone: 'success' });
    void data.reload();
  };

  return (
    <Screen refreshing={data.loading && Boolean(d)} onRefresh={data.reload}>
      <ScreenHeader title={d ? `${DISPUTE_CATEGORY_LABEL[d.category]} case` : 'Case'} subtitle={d?.booking.listingTitle} size="compact" back />
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={data.reload} />
      ) : !d || !label ? (
        <LoadingRows rows={4} label="Loading case" />
      ) : (
        <View style={styles.body}>
          <View style={styles.card} testID="dispute-summary">
            <View style={styles.head}>
              <StatusPill label={label.label} tone={label.tone} />
              <Text variant="footnote" tone="muted" style={styles.flex}>Opened by the {d.openedBy} · {formatDateTimeManila(d.createdAt)}</Text>
            </View>
            <Text variant="callout">“{d.description}”</Text>
            <Line label={d.openedBy === 'borrower' ? 'Refund requested' : 'Amount requested from the deposit'} value={formatPeso(d.requestedAmount)} />
            <Line label="Deposit held by TigRent" value={formatPeso(d.booking.deposit)} />
            <Line label="Rent paid" value={formatPeso(d.booking.subtotal)} />
            {d.booking.lateDays > 0 ? <Line label={`Late: ${d.booking.lateDays} day${d.booking.lateDays === 1 ? '' : 's'} × ${formatPeso(d.booking.lateFeePerDay)}`} value={formatPeso(d.booking.lateFee)} /> : null}
            <Text variant="caption" tone="muted">{formatDateOnly(d.booking.pickupDate)} → {formatDateOnly(d.booking.returnDate)} · {d.borrower.fullName} (borrower) · {d.lender.fullName} (lender)</Text>
          </View>

          {awaitingMe ? <Banner tone="warning" title="Your reply is needed" message="Add your side and any photos. A moderator decides after hearing both parties." /> : null}

          {d.decision ? (
            <View style={[styles.card, styles.decision]} testID="dispute-decision">
              <View style={styles.head}>
                <Text variant="headline" style={styles.flex}>Moderator decision</Text>
                {d.decidedAt ? <Text variant="caption" tone="muted">{formatDateTimeManila(d.decidedAt)}</Text> : null}
              </View>
              <Text variant="callout">{d.decision}</Text>
              {d.resolutionAmount !== null ? <Line label="Deposit to the lender" value={formatPeso(d.resolutionAmount)} /> : null}
              <Text variant="footnote" tone="muted">Any refund is shown on the booking’s payment record (simulated).</Text>
              {d.canAppeal ? (
                <Button label="Appeal this decision" variant="secondary" onPress={() => { setError(null); setAppealOpen(true); }} testID="appeal" />
              ) : d.appealDeadline && decided && !staff ? (
                <Text variant="caption" tone="muted">No appeal is available: this case was already appealed or the window (until {formatDateTimeManila(d.appealDeadline)}) has closed.</Text>
              ) : null}
            </View>
          ) : null}

          <Section title="Evidence">
            {d.evidence.length === 0 ? (
              <Text variant="callout" tone="muted">No photos yet.</Text>
            ) : (
              <View style={styles.card}>
                {(['lender', 'borrower', 'staff'] as const).map((r) => (
                  <EvidencePhotos key={r} paths={d.evidence.filter((e) => e.byRole === r).map((e) => e.path)} label={`From the ${r === 'staff' ? 'moderator' : r}`} />
                ))}
              </View>
            )}
          </Section>

          <Section title="Conversation">
            <View style={styles.card}>
              {d.messages.length === 0 ? <Text variant="callout" tone="muted">No replies yet.</Text> : null}
              {d.messages.map((m) => (
                <View key={m.id} style={styles.message}>
                  <Text variant="caption" tone="muted">{m.byMe ? 'You' : ROLE_LABEL[m.senderRole]} · {formatDateTimeManila(m.at)}</Text>
                  <Text variant="body">{m.body}</Text>
                </View>
              ))}
            </View>
            {!decided ? (
              <Button
                label={staff ? 'Message the parties' : 'Add your side'}
                variant={awaitingMe ? 'primary' : 'secondary'}
                icon={MessageSquarePlus}
                fullWidth
                onPress={() => setReplyOpen(true)}
                testID="dispute-reply"
              />
            ) : null}
          </Section>

          {staff && !decided && d.status !== 'appealed' ? <ResolvePanel d={d} onDone={() => void data.reload()} /> : null}
          {staff && d.status === 'appealed' ? <AppealReview d={d} onDone={() => void data.reload()} /> : null}

          {!staff ? (
            <Group>
              <ListRow icon={Scale} title="View booking" subtitle="Timeline, messages and payment record" onPress={() => router.push({ pathname: '/booking/[id]', params: { id: d.bookingId } })} showChevron />
            </Group>
          ) : null}
          <Text variant="footnote" tone="muted">Cases are private to the borrower, the lender and TigRent moderators. Amounts are simulated; no real money moves.</Text>
        </View>
      )}

      {d ? (
        <EvidenceSheet
          visible={replyOpen}
          onClose={() => setReplyOpen(false)}
          title={staff ? 'Message the parties' : 'Add your side'}
          description={staff ? 'Both parties see this message. Optionally ask one of them to respond.' : 'Explain what happened. Both the other party and the moderator see this.'}
          notesLabel="Message"
          submitLabel="Send"
          bookingId={d.bookingId}
          userId={context?.userId ?? ''}
          allowPhotos={!staff}
          onSubmit={async (notes, photos) => {
            if (!notes.trim()) return 'Write a message.';
            const r = await disputesRepository.respond(id, notes, photos, staff ? requestFrom : null);
            if (!r.ok) return r.error.message;
            setReplyOpen(false);
            void data.reload();
            return null;
          }}
          testID="dispute-reply-sheet"
        >
          {staff ? (
            <View style={styles.chips}>
              <Chip label="No reply needed" selected={requestFrom === null} onPress={() => setRequestFrom(null)} />
              <Chip label="Ask the borrower" selected={requestFrom === 'borrower'} onPress={() => setRequestFrom('borrower')} />
              <Chip label="Ask the lender" selected={requestFrom === 'lender'} onPress={() => setRequestFrom('lender')} />
            </View>
          ) : null}
        </EvidenceSheet>
      ) : null}

      <Sheet
        visible={appealOpen}
        onClose={() => setAppealOpen(false)}
        title="Appeal the decision"
        description="One appeal per case, within the appeal window. A moderator reviews it and records the outcome."
        footer={<Button label="Send appeal" fullWidth loading={busy} onPress={appeal} testID="confirm-appeal" />}
      >
        <View style={styles.sheet}>
          <TextField label="Why should it be reviewed?" value={appealText} onChangeText={setAppealText} multiline maxLength={2000} testID="appeal-reason" />
          {error ? <Banner tone="danger" title="Not sent" message={error} /> : null}
        </View>
      </Sheet>
    </Screen>
  );
}

function ResolvePanel({ d, onDone }: { d: DisputeDetail; onDone: () => void }) {
  const toast = useToast();
  const [deposit, setDeposit] = useState('');
  const [rent, setRent] = useState('');
  const [outcome, setOutcome] = useState<'completed' | 'cancelled'>('completed');
  const [decision, setDecision] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toLender = deposit.trim() === '' ? 0 : parsePesoInput(deposit);
  const rentRefund = rent.trim() === '' ? 0 : parsePesoInput(rent);
  const preview = decisionPreview({ deposit: d.booking.deposit, rentPaid: Math.max(0, d.booking.paid - d.booking.deposit), depositToLender: toLender ?? -1, rentRefund: rentRefund ?? -1 });
  const problem = toLender === null || rentRefund === null ? 'Enter amounts in pesos.' : preview.problems[0] ?? (decision.trim().length < 10 ? 'Explain the decision (at least 10 characters).' : null);

  const resolve = async () => {
    if (problem || toLender === null || rentRefund === null) return;
    setBusy(true);
    setError(null);
    const r = await disputesRepository.resolve(d.id, toLender, rentRefund, outcome, decision);
    setBusy(false);
    setConfirm(false);
    if (!r.ok) return setError(r.error.message);
    toast.show({ title: 'Decision recorded', message: 'Both parties have been notified.', tone: 'success' });
    onDone();
  };

  return (
    <Section title="Decide (moderator)">
      <View style={styles.card} testID="resolve-panel">
        <TextField label="Deposit to the lender (₱)" value={deposit} onChangeText={setDeposit} keyboardType="decimal-pad" placeholder="0" helper={`Up to ${formatPeso(d.booking.deposit)}. The rest of the deposit goes back to the borrower.`} testID="resolve-deposit" />
        <TextField label="Rent refund to the borrower (₱)" value={rent} onChangeText={setRent} keyboardType="decimal-pad" placeholder="0" helper={`Up to ${formatPeso(Math.max(0, d.booking.paid - d.booking.deposit))} of the original rent. The lender’s share and commission are re-based.`} testID="resolve-rent" />
        <SegmentedControl segments={[{ value: 'completed', label: 'Rental completed' }, { value: 'cancelled', label: 'Rental cancelled' }] as const} value={outcome} onChange={setOutcome} accessibilityLabel="How the rental ends" />
        <TextField label="Decision (both parties see this)" value={decision} onChangeText={setDecision} multiline maxLength={2000} testID="resolve-decision" />
        {!problem ? (
          <Text variant="footnote" tone="muted" testID="resolve-preview">
            Borrower gets {formatPeso(preview.borrowerGets)} back; lender gets {formatPeso(preview.lenderGets)} from the deposit (simulated).
          </Text>
        ) : null}
        {error ? <Banner tone="danger" title="Not recorded" message={error} /> : null}
        <Button label="Record decision" icon={Gavel} fullWidth disabled={Boolean(problem)} disabledReason={problem ?? undefined} onPress={() => setConfirm(true)} testID="resolve" />
      </View>
      <Dialog
        visible={confirm}
        title="Record this decision?"
        message={`The borrower gets ${formatPeso(preview.borrowerGets)} back and the lender gets ${formatPeso(preview.lenderGets)} from the deposit. The rental is marked ${outcome}. This can only be appealed once, not edited.`}
        confirmLabel="Record decision"
        loading={busy}
        onConfirm={() => void resolve()}
        onCancel={() => setConfirm(false)}
        testID="resolve-dialog"
      />
    </Section>
  );
}

function AppealReview({ d, onDone }: { d: DisputeDetail; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await disputesRepository.decideAppeal(d.id, note);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    onDone();
  };
  return (
    <Section title="Review appeal (moderator)">
      <View style={styles.card}>
        <Text variant="footnote" tone="muted">The money already moved stays as decided. Record whether the decision stands; any manual correction is noted here in this prototype.</Text>
        <TextField label="Appeal outcome" value={note} onChangeText={setNote} multiline maxLength={2000} testID="appeal-note" />
        {error ? <Banner tone="danger" title="Not recorded" message={error} /> : null}
        <Button label="Close appeal" fullWidth loading={busy} disabled={note.trim().length < 10} disabledReason="Explain the outcome (at least 10 characters)." onPress={submit} testID="close-appeal" />
      </View>
    </Section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text variant="callout" tone="muted" style={styles.flex}>{label}</Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  decision: { borderWidth: 1, borderColor: colors.primary },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  message: { gap: 2, paddingVertical: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sheet: { gap: spacing.md },
  flex: { flex: 1 },
});
