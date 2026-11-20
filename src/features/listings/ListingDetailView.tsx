import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
import { ImageOff, MapPin, Package, ShieldCheck, Timer, Wallet } from 'lucide-react-native';
import { Icon, ListRow, StatusPill, Text } from '@/components/design-system';
import { CONDITION_LABEL } from '@/domain/listings';
import type { ItemCondition } from '@/domain/entities';
import { formatPeso, type Centavos } from '@/lib/money';
import { colors, gutter, radii, spacing } from '@/theme';

export type ListingView = {
  title: string;
  categoryLabel: string;
  condition: ItemCondition;
  description: string;
  equipmentNotes: string | null;
  dailyRate: Centavos;
  deposit: Centavos;
  lateFeePerDay: Centavos;
  pickupPointLabel: string | null;
  pickupNotes: string | null;
  photoUrls: string[];
};

/** How a listing appears to borrowers. Shared by the lender preview (Phase 6) and listing detail (Phase 7). */
export function ListingDetailView({ listing: l }: { listing: ListingView }) {
  const { width } = useWindowDimensions();
  const photoWidth = width - gutter * 2;
  const [page, setPage] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / photoWidth));

  return (
    <View style={styles.root}>
      {l.photoUrls.length > 0 ? (
        <View>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} style={{ width: photoWidth }}>
            {l.photoUrls.map((u, i) => (
              <Image key={u} source={{ uri: u }} style={[styles.photo, { width: photoWidth }]} contentFit="cover" accessibilityLabel={`Photo ${i + 1} of ${l.photoUrls.length}`} />
            ))}
          </ScrollView>
          {l.photoUrls.length > 1 ? (
            <View style={styles.dots} accessibilityLabel={`Photo ${page + 1} of ${l.photoUrls.length}`}>
              {l.photoUrls.map((u, i) => (
                <View key={u} style={[styles.dot, i === page && styles.dotOn]} />
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.photo, styles.noPhoto]}>
          <Icon as={ImageOff} size="xl" color={colors.textFaint} />
          <Text variant="footnote" tone="muted">No photos yet</Text>
        </View>
      )}

      <View style={styles.headline}>
        <Text variant="overline" tone="muted" uppercase>{l.categoryLabel}</Text>
        <Text variant="title">{l.title}</Text>
        <View style={styles.priceRow}>
          <Text variant="title2">{formatPeso(l.dailyRate)}</Text>
          <Text variant="callout" tone="muted">per day</Text>
          <StatusPill label={CONDITION_LABEL[l.condition]} />
        </View>
      </View>

      <View style={styles.card}>
        <ListRow icon={Wallet} title="Refundable deposit" value={formatPeso(l.deposit)} subtitle="Returned after a clean return" />
        <ListRow icon={Timer} title="Late fee" value={l.lateFeePerDay > 0 ? `${formatPeso(l.lateFeePerDay)}/day` : 'None'} subtitle="Charged only after the due time" />
        <ListRow icon={MapPin} title="Pickup and return" subtitle={[l.pickupPointLabel, l.pickupNotes].filter(Boolean).join(' · ') || 'Arrange in messages'} />
      </View>

      {l.description ? (
        <View style={styles.block}>
          <Text variant="headline">About this item</Text>
          <Text variant="body">{l.description}</Text>
        </View>
      ) : null}
      {l.equipmentNotes ? (
        <View style={styles.block}>
          <View style={styles.inline}>
            <Icon as={Package} size="sm" color={colors.textMuted} />
            <Text variant="headline">Notes from the lender</Text>
          </View>
          <Text variant="body">{l.equipmentNotes}</Text>
        </View>
      ) : null}
      <View style={styles.inline}>
        <Icon as={ShieldCheck} size="sm" color={colors.success} />
        <Text variant="footnote" tone="muted">Listed by a verified TigRent student. Rental terms and the price breakdown are shown before you send a request.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  photo: { height: 260, borderRadius: radii.lg, backgroundColor: colors.surfaceSunken },
  noPhoto: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.ink, width: 16 },
  headline: { gap: spacing.xs },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, flexWrap: 'wrap' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  block: { gap: spacing.xs },
  inline: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, flexShrink: 1 },
});
