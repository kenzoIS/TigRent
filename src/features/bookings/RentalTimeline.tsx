import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { Icon, Text } from '@/components/design-system';
import type { Milestone } from '@/domain/rental';
import { formatDateTimeManila } from '@/lib/format';
import { colors, radii, spacing } from '@/theme';

/** The rental's key steps, identical for both parties (plan Phase 9 "rental timeline"). */
export function RentalTimeline({ milestones }: { milestones: Milestone[] }) {
  return (
    <View style={styles.root} accessibilityRole="list" testID="rental-timeline">
      {milestones.map((m, i) => {
        const last = i === milestones.length - 1;
        return (
          <View key={m.key} style={styles.item} accessibilityLabel={`${m.label}: ${m.state === 'done' ? 'done' : m.state === 'current' ? 'now' : 'later'}`}>
            <View style={styles.rail}>
              <View style={[styles.dot, m.state === 'done' && styles.done, m.state === 'current' && styles.current]}>
                {m.state === 'done' ? <Icon as={Check} size={12} color={colors.textOnGold} /> : null}
              </View>
              {!last ? <View style={[styles.line, m.state === 'done' && styles.lineDone]} /> : null}
            </View>
            <View style={styles.text}>
              <Text variant={m.state === 'current' ? 'bodyStrong' : 'body'} tone={m.state === 'upcoming' ? 'muted' : undefined}>{m.label}</Text>
              {/* The due time is known in advance; other steps show a time once they happen. */}
              {m.at && (m.state !== 'upcoming' || m.key === 'due') ? <Text variant="caption" tone="muted">{formatDateTimeManila(m.at)}</Text> : null}
              {m.detail ? <Text variant="caption" tone="muted">{m.detail}</Text> : null}
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
  rail: { width: 18, alignItems: 'center' },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  done: { backgroundColor: colors.primary, borderColor: colors.primary },
  current: { borderColor: colors.primary, borderWidth: 3 },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2, minHeight: 12 },
  lineDone: { backgroundColor: colors.primary },
  text: { flex: 1, gap: 2, paddingBottom: spacing.md },
});
