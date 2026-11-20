import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Award, ImageOff, Sparkles, Star } from 'lucide-react-native';
import { Icon, StatusPill, Text } from '@/components/design-system';
import { CONDITION_LABEL } from '@/domain/listings';
import { formatPeso } from '@/lib/money';
import type { SearchResult } from '@/repositories';
import { colors, elevation, radii, spacing, typography } from '@/theme';

/** Editorial result card: photo-led, elevated, lively badges, and trust at a glance. */
export function ResultRow({ r, photoUrl, datesChosen, onPress }: { r: SearchResult; photoUrl?: string; datesChosen: boolean; onPress: () => void }) {
  const rating = r.lenderRating !== null && r.lenderReviews > 0 ? `★ ${r.lenderRating.toFixed(1)} (${r.lenderReviews})` : 'New lender';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${r.title}, ${formatPeso(r.dailyRate)} per day, ${CONDITION_LABEL[r.condition]}, lent by ${r.lenderName}, ${rating}${r.lenderTrusted ? ', Verified Trusted Lender' : ''}`}
      style={({ pressed }) => [styles.row, elevation.low, pressed && styles.pressed]}
      testID={`result-${r.id}`}
    >
      <View style={styles.photoContainer}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" accessible={false} />
        ) : (
          <View style={[styles.photo, styles.noPhoto]}><Icon as={ImageOff} color={colors.textFaint} /></View>
        )}
      </View>
      <View style={styles.text}>
        <View style={styles.headerRow}>
          <Text variant="caption" uppercase style={styles.category}>{r.categoryLabel}</Text>
          <View style={styles.conditionPill}>
            <Text style={styles.conditionText}>{CONDITION_LABEL[r.condition]}</Text>
          </View>
        </View>

        <Text variant="bodyStrong" numberOfLines={2} style={styles.title}>{r.title}</Text>

        <View style={styles.priceRow}>
          <Text style={styles.priceValue}>{formatPeso(r.dailyRate)}</Text>
          <Text style={styles.pricePeriod}>/day</Text>
        </View>

        <View style={styles.lenderRow}>
          <Icon as={Star} size={13} color={colors.primary} />
          <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.flex}>
            {r.lenderName} · <Text variant="footnote" style={styles.ratingText}>{rating}</Text>
          </Text>
        </View>

        <View style={styles.pills}>
          {r.isFeatured ? <StatusPill label="Featured" tone="gold" icon={Sparkles} /> : null}
          {r.lenderTrusted ? <StatusPill label="Trusted Lender" tone="success" icon={Award} /> : null}
          {datesChosen ? <StatusPill label="Available for your dates" tone="success" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.primary,
    transform: [{ scale: 0.99 }],
  },
  photoContainer: {
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
  },
  photo: {
    width: 104,
    height: 124,
    borderRadius: radii.md,
  },
  noPhoto: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  category: {
    color: colors.link,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  conditionPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSunken,
  },
  conditionText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.text,
    marginTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    marginTop: 4,
  },
  priceValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  pricePeriod: {
    ...typography.footnote,
    color: colors.textMuted,
  },
  lenderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  ratingText: {
    fontWeight: '600',
    color: colors.text,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 6,
  },
  flex: { flex: 1 },
});
