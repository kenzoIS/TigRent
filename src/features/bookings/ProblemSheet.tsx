import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip, Text, TextField } from '@/components/design-system';
import { checkClaimAmount, checkDescription } from '@/domain/exceptions';
import { formatPeso, parsePesoInput } from '@/lib/money';
import { bookingFlowRepository, type BookingDetail } from '@/repositories';
import { spacing } from '@/theme';
import { EvidenceSheet } from './EvidenceSheet';

export type ProblemMode = 'return_problem' | 'not_returned' | 'borrower';

const BORROWER_CATEGORIES = [
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'payment', label: 'Payment' },
  { value: 'other', label: 'Something else' },
] as const;

/**
 * Report a problem → a dispute decided by a TigRent moderator (plan §2.7). The deposit stays held until
 * then; nobody can take it unilaterally.
 */
export function ProblemSheet({ d, mode, visible, userId, onClose, onOpened }: {
  d: BookingDetail;
  mode: ProblemMode;
  visible: boolean;
  userId: string;
  onClose: () => void;
  onOpened: (disputeId: string) => void;
}) {
  const [outcome, setOutcome] = useState<'damaged' | 'incomplete'>('damaged');
  const [category, setCategory] = useState<(typeof BORROWER_CATEGORIES)[number]['value']>('not_as_described');
  const [amount, setAmount] = useState('');
  const max = mode === 'borrower' ? d.subtotal : d.deposit;

  const submit = async (notes: string, photos: string[]) => {
    const problem = checkDescription(notes);
    if (problem) return problem;
    const requested = amount.trim() === '' ? 0 : parsePesoInput(amount);
    const amountProblem = checkClaimAmount(requested, max);
    if (amountProblem) return amountProblem;
    const r =
      mode === 'return_problem'
        ? await bookingFlowRepository.reportReturnProblem(d.id, outcome, notes, requested!, photos)
        : mode === 'not_returned'
          ? await bookingFlowRepository.reportNotReturned(d.id, notes, requested!)
          : await bookingFlowRepository.openDispute(d.id, category, notes, requested!, photos);
    if (!r.ok) return r.error.message;
    onOpened(r.data);
    return null;
  };

  return (
    <EvidenceSheet
      visible={visible}
      onClose={onClose}
      title={mode === 'not_returned' ? 'Report item not returned' : 'Report a problem'}
      description={
        mode === 'borrower'
          ? 'A TigRent moderator reviews both sides and decides any refund. You can keep messaging the lender meanwhile.'
          : `The ${formatPeso(d.deposit)} deposit stays held until a TigRent moderator decides. The borrower can reply with their side.`
      }
      notesLabel="What happened?"
      notesPlaceholder={mode === 'not_returned' ? 'e.g. Due 3 days ago; no reply to messages' : mode === 'borrower' ? 'e.g. The compass is missing from the set' : 'e.g. The screen is cracked; it was fine at handover'}
      submitLabel="Send report"
      submitVariant="danger"
      bookingId={d.id}
      userId={userId}
      allowPhotos={mode !== 'not_returned'}
      onSubmit={submit}
      testID="problem-sheet"
    >
      {mode === 'return_problem' ? (
        <View style={styles.chips}>
          <Chip label="Damaged" selected={outcome === 'damaged'} onPress={() => setOutcome('damaged')} />
          <Chip label="Missing parts" selected={outcome === 'incomplete'} onPress={() => setOutcome('incomplete')} />
        </View>
      ) : null}
      {mode === 'borrower' ? (
        <View style={styles.chips}>
          {BORROWER_CATEGORIES.map((c) => <Chip key={c.value} label={c.label} selected={category === c.value} onPress={() => setCategory(c.value)} />)}
        </View>
      ) : null}
      <TextField
        label={mode === 'borrower' ? 'Refund you’re asking for (₱, optional)' : 'Amount from the deposit you’re asking for (₱)'}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0"
        helper={`Up to ${formatPeso(max)}${mode === 'borrower' ? ' (the rent you paid)' : ' (the deposit TigRent holds)'}. The moderator decides the final amount.`}
        testID="problem-amount"
      />
      <Text variant="footnote" tone="muted">Photos and notes are private to you, the other party and TigRent staff.</Text>
    </EvidenceSheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
