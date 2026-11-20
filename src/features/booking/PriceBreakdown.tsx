import { StyleSheet, View } from 'react-native';
import { CalendarCheck, Info } from 'lucide-react-native';
import { Icon, StatusPill, Text } from '@/components/design-system';
import { dueLabelFor } from '@/domain/pricing';
import { formatDateOnly, type DateOnly } from '@/lib/dates';
import { formatPeso, type Centavos } from '@/lib/money';
import { colors, radii, spacing } from '@/theme';

type Props = {
  rentalDays: number;
  dailyRate: Centavos;
  subtotal: Centavos;
  deposit: Centavos;
  total: Centavos;
  lateFeePerDay: Centavos;
  pickupDate: DateOnly;
  returnDate: DateOnly;
  dueTimeLocal: string;
  /** True once the server has confirmed these numbers (quote_booking). */
  confirmed?: boolean;
};

/** Full PHP breakdown shown before any request or payment (plan §2.3: no surprises). */
export function PriceBreakdown(p: Props) {
  return (
    <View style={styles.root} accessibilityLabel={`Price: ${formatPeso(p.dailyRate)} times ${p.rentalDays} days equals ${formatPeso(p.subtotal)}, plus a refundable deposit of ${formatPeso(p.deposit)}, total ${formatPeso(p.total)}`}>
      <View style={styles.head}>
        <Text variant="headline" style={styles.flex}>Price breakdown</Text>
        <StatusPill label={p.confirmed ? 'Confirmed by TigRent' : 'Estimate'} tone={p.confirmed ? 'success' : 'neutral'} />
      </View>
      <Row label={`${formatPeso(p.dailyRate)} × ${p.rentalDays} day${p.rentalDays === 1 ? '' : 's'}`} value={formatPeso(p.subtotal)} />
      <Row label="Refundable deposit" value={formatPeso(p.deposit)} hint="Returned after a clean return" />
      <View style={styles.divider} />
      <Row label="Total at checkout" value={formatPeso(p.total, { showCentavos: 'always' })} strong />

      <View style={styles.note}>
        <Icon as={CalendarCheck} size="sm" color={colors.link} />
        <Text variant="footnote" style={styles.flex}>
          {formatDateOnly(p.pickupDate)} to {formatDateOnly(p.returnDate)}. Both days count, so your return day is included in the {p.rentalDays}-day rental. Return by {dueLabelFor(p.returnDate, p.dueTimeLocal)}.
        </Text>
      </View>
      <View style={styles.note}>
        <Icon as={Info} size="sm" color={colors.textMuted} />
        <Text variant="footnote" tone="muted" style={styles.flex}>
          {p.lateFeePerDay > 0 ? `Late fee ${formatPeso(p.lateFeePerDay)} per day, only after the due time. ` : 'No late fee is set for this item. '}
          Payments in this prototype are simulated; no real money moves.
        </Text>
      </View>
    </View>
  );
}

function Row({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text variant={strong ? 'bodyStrong' : 'body'}>{label}</Text>
        {hint ? <Text variant="caption" tone="muted">{hint}</Text> : null}
      </View>
      <Text variant={strong ? 'title2' : 'body'}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginTop: spacing.xs },
  flex: { flex: 1 },
});
