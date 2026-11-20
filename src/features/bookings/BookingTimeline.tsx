import { StyleSheet, View } from 'react-native';
import { Text } from '@/components/design-system';
import type { BookingStatus } from '@/domain/entities';
import { formatDateTimeManila } from '@/lib/format';
import type { BookingEvent } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

type Label = { mine: string; theirs: string };

const STATUS_LABEL: Record<BookingStatus, Label> = {
  pending_lender_approval: { mine: 'You sent the request', theirs: 'Request received' },
  awaiting_payment: { mine: 'You accepted; dates held for payment', theirs: 'Lender accepted; payment window opened' },
  confirmed: { mine: 'You paid (demo)', theirs: 'Borrower paid (demo)' },
  rejected: { mine: 'You declined', theirs: 'Lender declined' },
  cancelled: { mine: 'You cancelled', theirs: 'Cancelled' },
  payment_expired: { mine: 'Payment window closed', theirs: 'Payment window closed' },
  active: { mine: 'Rental started', theirs: 'Rental started' },
  overdue: { mine: 'Marked overdue', theirs: 'Marked overdue' },
  return_requested: { mine: 'You returned the item', theirs: 'Borrower returned the item' },
  disputed: { mine: 'Dispute opened', theirs: 'Dispute opened' },
  completed: { mine: 'You confirmed a clean return', theirs: 'Lender confirmed a clean return' },
};

/** History entries that aren't status changes (migration 016 `log_booking_note`). */
const KIND_LABEL: Record<string, Label> = {
  handover_lender: { mine: 'You handed the item over', theirs: 'Lender handed the item over' },
  handover_borrower: { mine: 'You confirmed receipt', theirs: 'Borrower confirmed receipt' },
  extension_requested: { mine: 'You asked for more days', theirs: 'Borrower asked for more days' },
  extension_approved: { mine: 'You approved the extension', theirs: 'Lender approved the extension' },
  extension_rejected: { mine: 'You declined the extension', theirs: 'Lender declined the extension' },
  extension_payment_failed: { mine: 'Extension payment failed', theirs: 'Extension payment failed' },
  extension_expired: { mine: 'Extension payment window closed', theirs: 'Extension payment window closed' },
  extended: { mine: 'You paid for more days (demo)', theirs: 'Borrower paid for more days (demo)' },
};

/** Booking history from the append-only event log (plan §6.3), oldest first. */
export function BookingTimeline({ events }: { events: BookingEvent[] }) {
  return (
    <View style={styles.root} accessibilityRole="list">
      {events.map((e, i) => {
        const l = (e.kind ? KIND_LABEL[e.kind] : undefined) ?? STATUS_LABEL[e.toStatus];
        const title = e.byMe ? l.mine : l.theirs;
        const showReason = e.reason && e.toStatus !== 'pending_lender_approval' && !/^(Lender accepted|Demo payment succeeded|Handover confirmed by both)$/.test(e.reason);
        return (
          <View key={`${e.at}-${i}`} style={styles.item}>
            <View style={styles.rail}>
              <View style={[styles.dot, i === events.length - 1 ? styles.dotCurrent : null]} />
              {i < events.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.text}>
              <Text variant="bodyStrong">{title}</Text>
              {showReason ? <Text variant="footnote" tone="muted">{e.reason}</Text> : null}
              <Text variant="caption" tone="muted">{formatDateTimeManila(e.at)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  item: { flexDirection: 'row', gap: spacing.md },
  rail: { width: 12, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.borderStrong, marginTop: 6 },
  dotCurrent: { backgroundColor: colors.primary },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  text: { flex: 1, gap: 2, paddingBottom: spacing.md },
});
