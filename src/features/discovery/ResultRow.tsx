import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Award, ImageOff, Star } from 'lucide-react-native';
import { Icon, StatusPill, Text } from '@/components/design-system';
import { CONDITION_LABEL } from '@/domain/listings';
import { formatPeso } from '@/lib/money';
import type { SearchResult } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/** Editorial result row: photo-led, price and lender trust at a glance (plan §5.2: no identical card grid). */
export function ResultRow({ r, photoUrl, datesChosen, onPress }: { r: SearchResult; photoUrl?: string; datesChosen: boolean; onPress: () => void }) {
  const rating = r.lenderRating !== null && r.lenderReviews > 0 ? `★ ${r.lenderRating.toFixed(1)} (${r.lenderReviews})` : 'New lender';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${r.title}, ${formatPeso(r.dailyRate)} per day, ${CONDITION_LABEL[r.condition]}, lent by ${r.lenderName}, ${rating}${r.lenderTrusted ? ', Verified Trusted Lender' : ''}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`result-${r.id}`}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" accessible={false} />
      ) : (
        <View style={[styles.photo, styles.noPhoto]}><Icon as={ImageOff} color={colors.textFaint} /></View>
      )}
      <View style={styles.text}>
        <Text variant="caption" tone="muted" uppercase>{r.categoryLabel}</Text>
        <Text variant="bodyStrong" numberOfLines={2}>{r.title}</Text>
        <View style={styles.price}>
          <Text variant="headline">{formatPeso(r.dailyRate)}</Text>
          <Text variant="footnote" tone="muted">/day · {CONDITION_LABEL[r.condition]}</Text>
        </View>
        <View style={styles.lender}>
          <Icon as={Star} size={13} color={colors.textMuted} />
          <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.flex}>{r.lenderName} · {rating}</Text>
        </View>
        <View style={styles.pills}>
          {r.lenderTrusted ? <StatusPill label="Trusted Lender" tone="success" icon={Award} /> : null}
          {r.isFeatured ? <StatusPill label="Featured" tone="info" /> : null}
          {datesChosen ? <StatusPill label="Available for your dates" tone="success" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.lg },
  pressed: { backgroundColor: colors.surfaceSunken },
  photo: { width: 104, height: 120, borderRadius: radii.md, backgroundColor: colors.surfaceSunken },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 3 },
  price: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  lender: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
  flex: { flex: 1 },
});
