import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { CalendarClock, Compass, ImageOff, Search } from 'lucide-react-native';
import { Button, Chip, EmptyState, ErrorState, Icon, ListRow, LoadingRows, Screen, StatusPill, Text } from '@/components/design-system';
import { GreetingHeader } from '@/components/shared/GreetingHeader';
import { Group, Section, StatRow } from '@/components/shared/Layout';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { CONDITION_LABEL } from '@/domain/listings';
import { dueLabel, summarizeBorrower } from '@/domain/rules/dashboard';
import { RoleSwitcher } from '@/features/auth/RoleSwitcher';
import { useSession } from '@/features/auth/session';
import { borrowerTip } from '@/features/mascot/dialogue';
import { useListingPhotos } from '@/features/listings/useListingPhotos';
import { formatDateOnly, todayInBusinessTz } from '@/lib/dates';
import { ok } from '@/lib/errors';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { bookingsRepository, discoverRepository, discoveryRepository } from '@/repositories';
import { colors, elevation, radii, spacing } from '@/theme';

/** Borrower home (plan §4.2): search entry, categories, rentals summary and featured items. */
export default function BorrowerHome() {
  const { context } = useSession();
  const { width } = useWindowDimensions();
  const userId = context?.userId ?? '';
  const today = todayInBusinessTz();
  const data = useAsync(async () => {
    const [bookings, featured] = await Promise.all([bookingsRepository.listMine(), discoverRepository.featured(userId)]);
    if (!bookings.ok) return bookings;
    if (!featured.ok) return featured;
    return ok({ dash: summarizeBorrower(bookings.data, userId, today), featured: featured.data });
  }, [userId, today]);
  const { reload } = data;
  const categories = useAsync(() => discoveryRepository.categories(), []);
  useFocusEffect(useCallback(() => void reload(), [reload]));

  const firstName = (context?.fullName ?? '').split(' ')[0] || 'there';
  const d = data.data?.dash;
  const tip = d ? borrowerTip(d, today) : null;
  // Query-level filtering is authoritative; this also keeps a stale response out of the carousel.
  const featured = (data.data?.featured ?? []).filter((listing) => listing.isFeatured);
  const featuredPhotos = useListingPhotos(featured.map((listing) => listing.coverPath));
  const featuredCardWidth = Math.min(Math.max(width * 0.74, 244), 320);

  return (
    <Screen withTabBar refreshing={data.loading && Boolean(data.data)} onRefresh={reload}>
      <GreetingHeader eyebrow="Borrowing" title={`Hi, ${firstName}`} tip={tip} right={<NotificationBell />} />
      <RoleSwitcher current="borrower" />
      <Pressable
        onPress={() => router.push('/explore/search')}
        accessibilityRole="search"
        accessibilityLabel="Search equipment"
        style={({ pressed }) => [styles.search, pressed && styles.searchPressed]}
        testID="home-search"
      >
        <Icon as={Search} color={colors.textMuted} />
        <Text variant="body" tone="faint">Search calculators, cameras, projectors…</Text>
      </Pressable>
      {categories.data ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {categories.data.map((c) => (
            <Chip key={c.value} label={c.label} onPress={() => router.push({ pathname: '/explore/search', params: { category: c.value } })} testID={`home-category-${c.value}`} />
          ))}
        </ScrollView>
      ) : null}
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={reload} />
      ) : !d || !data.data ? (
        <LoadingRows rows={3} label="Loading your rentals" />
      ) : (
        <>
          {d.nextDue ? (
            <View style={[styles.due, d.nextDue.status === 'overdue' && styles.dueOverdue]} accessible accessibilityLabel={`Due back next: ${d.nextDue.listingTitle}, ${dueLabel(d.nextDue.returnDate, today)}`}>
              <Text variant="overline" tone="muted" uppercase>Due back next</Text>
              <Text variant="title2">{d.nextDue.listingTitle}</Text>
              <View style={styles.dueRow}>
                <StatusPill label={dueLabel(d.nextDue.returnDate, today)} tone={d.nextDue.status === 'overdue' ? 'danger' : 'warning'} />
                <Text variant="footnote" tone="muted">Return by {formatDateOnly(d.nextDue.returnDate)}</Text>
              </View>
            </View>
          ) : null}

          <Section title="Your rentals" action={{ label: 'All rentals', onPress: () => router.navigate('/borrower/rentals') }}>
            <StatRow
              stats={[
                { label: 'In progress', value: d.inProgress.length, onPress: () => router.navigate('/borrower/rentals'), tone: d.overdue.length ? 'danger' : 'default' },
                { label: 'Upcoming', value: d.upcoming.length, onPress: () => router.navigate('/borrower/rentals') },
                { label: 'Requests', value: d.requests.length, onPress: () => router.navigate('/borrower/rentals') },
              ]}
            />
          </Section>

          {d.upcoming.length > 0 ? (
            <Section title="Upcoming pickups">
              <Group>
                {d.upcoming.slice(0, 3).map((b) => (
                  <ListRow key={b.id} icon={CalendarClock} title={b.listingTitle} subtitle={`Pickup ${formatDateOnly(b.pickupDate)} · ${b.rentalDays} day${b.rentalDays === 1 ? '' : 's'}`} value={formatPeso(b.total)} />
                ))}
              </Group>
            </Section>
          ) : null}

          <Section title="Featured from students" action={{ label: 'See all', onPress: () => router.push('/explore/search') }}>
            {featured.length === 0 ? (
              <EmptyState icon={Compass} title="No items yet" message="When students list equipment, featured items will appear here." />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                disableIntervalMomentum
                snapToInterval={featuredCardWidth + spacing.md}
                snapToAlignment="start"
                contentContainerStyle={styles.featuredCarousel}
                accessibilityRole="adjustable"
                accessibilityLabel="Featured equipment carousel"
              >
                {featured.map((listing) => {
                  const photoUrl = listing.coverPath ? featuredPhotos.data?.[listing.coverPath] : undefined;
                  return (
                    <Pressable
                      key={listing.id}
                      onPress={() => router.push({ pathname: '/explore/listing/[id]', params: { id: listing.id } })}
                      accessibilityRole="button"
                      accessibilityLabel={`${listing.title}, ${formatPeso(listing.dailyRate)} per day, ${CONDITION_LABEL[listing.condition]}`}
                      style={({ pressed }) => [styles.featuredCard, { width: featuredCardWidth }, pressed && styles.featuredCardPressed]}
                      testID={`featured-${listing.id}`}
                    >
                      {photoUrl ? (
                        <Image source={{ uri: photoUrl }} style={styles.featuredImage} contentFit="cover" accessible={false} />
                      ) : (
                        <View style={[styles.featuredImage, styles.featuredImageFallback]}><Icon as={ImageOff} color={colors.textFaint} /></View>
                      )}
                      <View style={styles.featuredDetails}>
                        <Text variant="bodyStrong" numberOfLines={1}>{listing.title}</Text>
                        <Text variant="subhead" tone="muted" numberOfLines={1}>{formatPeso(listing.dailyRate)}/day · {CONDITION_LABEL[listing.condition]}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <Button label="Browse all equipment" variant="secondary" icon={Search} onPress={() => router.push('/explore/search')} />
          </Section>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 50, paddingHorizontal: spacing.md + 2, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md },
  searchPressed: { backgroundColor: colors.surfaceSunken },
  chips: { gap: spacing.sm, paddingTop: spacing.md },
  due: { backgroundColor: colors.warningSoft, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.xs, marginTop: spacing.lg },
  dueOverdue: { backgroundColor: colors.dangerSoft },
  dueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.xs },
  featuredCarousel: { gap: spacing.md, paddingRight: spacing.lg },
  featuredCard: { overflow: 'hidden', borderRadius: radii.lg, backgroundColor: colors.surface, ...elevation.low },
  featuredCardPressed: { backgroundColor: colors.surfaceSunken, opacity: 0.94 },
  featuredImage: { width: '100%', aspectRatio: 4 / 3, backgroundColor: colors.surfaceSunken },
  featuredImageFallback: { alignItems: 'center', justifyContent: 'center' },
  featuredDetails: { minHeight: 66, justifyContent: 'center', gap: spacing.xxs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
