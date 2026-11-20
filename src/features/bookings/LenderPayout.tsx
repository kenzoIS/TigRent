import { StyleSheet, View } from 'react-native';
import { StatusPill, Text } from '@/components/design-system';
import { formatPeso, type Centavos } from '@/lib/money';
import { colors, radii, spacing } from '@/theme';

type Props = {
  rentalDays: number;
  dailyRate: Centavos;
  subtotal: Centavos;
  commissionBps: number;
  commission: Centavos;
  lenderNet: Centavos;
  deposit: Centavos;
};

/** Lender view of one booking's money (plan §2.5): gross, commission, estimated net; deposit kept apart. */
export function LenderPayout(p: Props) {
  const pct = (p.commissionBps / 100).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  return (
    <View style={styles.root} accessibilityLabel={`Rent ${formatPeso(p.subtotal)}, platform commission ${formatPeso(p.commission)}, your estimated share ${formatPeso(p.lenderNet)}, simulated`}>
      <View style={styles.head}>
        <Text variant="headline" style={styles.flex}>Your earnings</Text>
        <StatusPill label="Simulated" tone="info" />
      </View>
      <Row label={`Rent: ${formatPeso(p.dailyRate)} × ${p.rentalDays} day${p.rentalDays === 1 ? '' : 's'}`} value={formatPeso(p.subtotal)} />
      <Row label={`Platform commission (${pct}%)`} value={`−${formatPeso(p.commission)}`} />
      <View style={styles.divider} />
      <Row label="Your estimated share" value={formatPeso(p.lenderNet, { showCentavos: 'always' })} strong />
      <Text variant="footnote" tone="muted">
        The refundable deposit ({formatPeso(p.deposit)}) is held for the borrower and isn’t part of your earnings. This is a demo estimate: no real payout is made.
      </Text>
    </View>
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

const styles = StyleSheet.create({
  root: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.xs },
  flex: { flex: 1 },
});
