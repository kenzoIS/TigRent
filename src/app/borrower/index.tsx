import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, type ScrollViewInstance, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { router, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import {
  ArrowRight,
  Calculator,
  CalendarClock,
  Camera,
  ChevronRight,
  Clock,
  Compass,
  FlaskConical,
  ImageOff,
  Laptop,
  Package,
  Plug,
  Ruler,
  Search,
  Sparkles,
  Tv,
} from 'lucide-react-native';
import { Chip, EmptyState, ErrorState, Icon, LoadingRows, Screen, Text, type IconComponent } from '@/components/design-system';
import { GreetingHeader } from '@/components/shared/GreetingHeader';
import { Section } from '@/components/shared/Layout';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { CONDITION_LABEL } from '@/domain/listings';
import { dueLabel, summarizeBorrower } from '@/domain/rules/dashboard';
import { RoleSwitcher } from '@/features/auth/RoleSwitcher';
import { useSession } from '@/features/auth/session';
import { borrowerTip } from '@/features/mascot/dialogue';
import { useListingPhotos } from '@/features/listings/useListingPhotos';
import { todayInBusinessTz } from '@/lib/dates';
import { ok } from '@/lib/errors';
import { formatPeso } from '@/lib/money';
import { useMotion } from '@/lib/motion';
import { useAsync } from '@/lib/use-async';
import { bookingsRepository, discoverRepository, discoveryRepository } from '@/repositories';
import { colors, elevation, radii, spacing } from '@/theme';

const CATEGORY_ICONS: Record<string, IconComponent> = {
  calculators: Calculator,
  'photo-video': Camera,
  'laptop-accessories': Laptop,
  presentation: Tv,
  drafting: Ruler,
  'lab-gear': FlaskConical,
  'power-cables': Plug,
  other: Package,
};

/** Borrower home (plan §4.2): segmented discovery, automated spotlight carousel, and glanceable rental bento hub. */
export default function BorrowerHome() {
  const { context } = useSession();
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
  const { reduceMotion } = useMotion();
  const d = data.data?.dash;
  const tip = d ? borrowerTip(d, today) : null;
  const featured = (data.data?.featured ?? []).filter((listing) => listing.isFeatured);
  const featuredPhotos = useListingPhotos(featured.map((listing) => listing.coverPath));

  // Auto-cycle spotlight cards smoothly every 4.2s without manual horizontal scroll
  const [activeSlide, setActiveSlide] = useState(0);
  useEffect(() => {
    if (featured.length <= 1) return;
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % featured.length);
    }, 4200);
    return () => clearInterval(timer);
  }, [featured.length]);

  const activeListing = featured[activeSlide] ?? featured[0];
  const activePhoto = activeListing?.coverPath ? featuredPhotos.data?.[activeListing.coverPath] : undefined;

  return (
    <Screen withTabBar refreshing={data.loading && Boolean(data.data)} onRefresh={reload}>
      {/* ── Segment 1: Header & Mascot ───────────────────────────────────── */}
      <GreetingHeader eyebrow="Borrowing" title={`Hi, ${firstName}`} tip={tip} right={<NotificationBell />} />
      <RoleSwitcher current="borrower" />

      {/* ── Segment 2: Search Hero ───────────────────────────────────────── */}
      <Pressable
        onPress={() => router.push('/explore/search')}
        accessibilityRole="search"
        accessibilityLabel="Search equipment"
        style={({ pressed }) => [styles.search, elevation.low, pressed && styles.searchPressed]}
        testID="home-search"
      >
        <View style={styles.searchIconCircle}>
          <Icon as={Search} size={18} color={colors.ink} />
        </View>
        <View style={styles.searchTextBox}>
          <Text variant="subhead" style={styles.searchTitle}>Find equipment on campus</Text>
          <Text variant="caption" tone="muted">Calculators, cameras, gear…</Text>
        </View>
        <View style={styles.searchBadge}>
          <Text style={styles.searchBadgeText}>Search</Text>
        </View>
      </Pressable>

      {/* ── Segment 3: Category Discovery ─────────────────────────────────── */}
      {categories.data ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {categories.data.map((c) => (
            <Chip
              key={c.value}
              label={c.label}
              icon={CATEGORY_ICONS[c.value] ?? Sparkles}
              onPress={() => router.push({ pathname: '/explore/search', params: { category: c.value } })}
              testID={`home-category-${c.value}`}
            />
          ))}
        </ScrollView>
      ) : null}

      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={reload} />
      ) : !d || !data.data ? (
        <LoadingRows rows={3} label="Loading your rentals" />
      ) : (
        <>
          {/* ── Segment 4: Clean Rental Activity Bento (Non-wordy glanceable hub) */}
          <View style={[styles.activityCard, elevation.low]}>
            <View style={styles.activityHeader}>
              <View style={styles.activityTitleRow}>
                <Icon as={CalendarClock} size={16} color={colors.primaryPressed} />
                <Text style={styles.activityTitle}>My Rentals</Text>
              </View>
              <Pressable
                onPress={() => router.navigate('/borrower/rentals')}
                accessibilityRole="button"
                accessibilityLabel="View all rentals"
                hitSlop={8}
              >
                <Text style={styles.activityLink}>View all →</Text>
              </Pressable>
            </View>

            <View style={styles.statsRow}>
              <Pressable
                onPress={() => router.navigate('/borrower/rentals')}
                style={[styles.statBox, d.inProgress.length > 0 && styles.statBoxActive]}
              >
                <Text style={[styles.statValue, d.inProgress.length > 0 ? styles.statValueActive : null]}>
                  {d.inProgress.length}
                </Text>
                <Text style={styles.statLabel}>Active</Text>
              </Pressable>

              <Pressable
                onPress={() => router.navigate('/borrower/rentals')}
                style={styles.statBox}
              >
                <Text style={styles.statValue}>{d.upcoming.length}</Text>
                <Text style={styles.statLabel}>Upcoming</Text>
              </Pressable>

              <Pressable
                onPress={() => router.navigate('/borrower/rentals')}
                style={styles.statBox}
              >
                <Text style={styles.statValue}>{d.requests.length}</Text>
                <Text style={styles.statLabel}>Requests</Text>
              </Pressable>
            </View>

            {d.nextDue ? (
              <Pressable
                onPress={() => router.navigate('/borrower/rentals')}
                style={[
                  styles.dueBanner,
                  d.nextDue.status === 'overdue' ? styles.dueBannerOverdue : null,
                ]}
              >
                <Icon
                  as={Clock}
                  size={14}
                  color={d.nextDue.status === 'overdue' ? colors.danger : colors.warning}
                />
                <Text style={styles.dueBannerText} numberOfLines={1}>
                  {d.nextDue.listingTitle} · {dueLabel(d.nextDue.returnDate, today)}
                </Text>
                <Icon as={ChevronRight} size={14} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          {/* ── Segment 5: Automated Campus Spotlight Carousel ─────────────── */}
          <Section
            title="Campus Spotlight ✨"
            action={{ label: 'Explore all', onPress: () => router.push('/explore/search') }}
          >
            {!activeListing ? (
              <EmptyState icon={Compass} title="No items yet" message="Featured equipment will appear here." />
            ) : (
              <View style={styles.spotlightWrapper}>
                <CampusSpotlightCarousel listings={featured} photos={featuredPhotos.data ?? {}} reduceMotion={reduceMotion} />
                <Animated.View
                  key={activeListing.id}
                  style={styles.legacySpotlight}
                  entering={reduceMotion ? undefined : FadeIn.duration(450).easing(Easing.out(Easing.cubic))}
                  exiting={reduceMotion ? undefined : FadeOut.duration(350).easing(Easing.in(Easing.cubic))}
                  layout={reduceMotion ? undefined : LinearTransition.duration(300)}
                >
                  <Pressable
                    onPress={() => router.push({ pathname: '/explore/listing/[id]', params: { id: activeListing.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${activeListing.title}, ${formatPeso(activeListing.dailyRate)} per day`}
                    style={({ pressed }) => [styles.spotlightCard, elevation.low, pressed && styles.spotlightCardPressed]}
                    testID={`featured-${activeListing.id}`}
                  >
                    <View style={styles.spotlightImageContainer}>
                      {activePhoto ? (
                        <Image source={{ uri: activePhoto }} style={styles.spotlightImage} contentFit="cover" accessible={false} />
                      ) : (
                        <View style={[styles.spotlightImage, styles.spotlightImageFallback]}>
                          <Icon as={ImageOff} color={colors.textFaint} />
                        </View>
                      )}
                      <View style={styles.spotlightBadge}>
                        <Icon as={Sparkles} size={11} color={colors.ink} />
                        <Text style={styles.spotlightBadgeText}>Featured · {activeSlide + 1}/{featured.length}</Text>
                      </View>
                      <View style={styles.spotlightPriceBadge}>
                        <Text style={styles.spotlightPriceText}>{formatPeso(activeListing.dailyRate)}</Text>
                        <Text style={styles.spotlightPerDayText}>/day</Text>
                      </View>
                    </View>

                    <View style={styles.spotlightDetails}>
                      <View style={styles.spotlightMeta}>
                        <Text variant="caption" uppercase style={styles.spotlightCategory}>
                          {activeListing.category}
                        </Text>
                        <View style={styles.conditionPill}>
                          <Text style={styles.conditionPillText}>{CONDITION_LABEL[activeListing.condition]}</Text>
                        </View>
                      </View>

                      <Text style={styles.spotlightTitle} numberOfLines={2}>
                        {activeListing.title}
                      </Text>

                      <View style={styles.spotlightFooter}>
                        <Text style={styles.spotlightPrompt}>Auto-showcasing student equipment</Text>
                        <View style={styles.spotlightActionBtn}>
                          <Text style={styles.spotlightActionText}>Check Availability</Text>
                          <Icon as={ArrowRight} size={13} color={colors.ink} />
                        </View>
                      </View>
                    </View>
                  </Pressable>
                </Animated.View>

                {/* Animated Slide Dots Indicator */}
                {featured.length > 1 ? (
                  <View style={styles.dotsRow}>
                    {featured.map((item, idx) => (
                      <Pressable
                        key={item.id}
                        onPress={() => setActiveSlide(idx)}
                        hitSlop={8}
                        style={[
                          styles.dot,
                          idx === activeSlide ? styles.activeDot : null,
                        ]}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}

type SpotlightListing = { id: string; title: string; category: string; condition: keyof typeof CONDITION_LABEL; dailyRate: number; coverPath: string | null };

/** Swipeable, forward-looping carousel. The repeated first card makes the automatic return seamless. */
function CampusSpotlightCarousel({ listings, photos, reduceMotion }: { listings: SpotlightListing[]; photos: Record<string, string>; reduceMotion: boolean }) {
  const { width } = useWindowDimensions();
  const cardWidth = width - spacing.lg * 2;
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [index, setIndex] = useState(0);
  const cards = listings.length > 1 ? [...listings, listings[0]!] : listings;

  useEffect(() => {
    if (reduceMotion || listings.length <= 1) return;
    const timer = setInterval(() => scrollRef.current?.scrollTo({ x: (index + 1) * cardWidth, animated: true }), 4200);
    return () => clearInterval(timer);
  }, [cardWidth, index, listings.length, reduceMotion]);

  const settle = (offset: number) => {
    const next = Math.round(offset / cardWidth);
    if (next >= listings.length) {
      setIndex(0);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ x: 0, animated: false }));
    } else {
      setIndex(next);
    }
  };

  return (
    <View style={styles.carouselShell}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => settle(event.nativeEvent.contentOffset.x)}
        accessibilityRole="adjustable"
        accessibilityLabel="Campus Spotlight carousel"
      >
        {cards.map((listing, cardIndex) => {
          const photo = listing.coverPath ? photos[listing.coverPath] : undefined;
          return (
            <Pressable
              key={`${listing.id}-${cardIndex}`}
              onPress={() => router.push({ pathname: '/explore/listing/[id]', params: { id: listing.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${listing.title}, ${formatPeso(listing.dailyRate)} per day, ${CONDITION_LABEL[listing.condition]}`}
              style={[styles.carouselCard, { width: cardWidth }]}
              testID={`spotlight-${listing.id}`}
            >
              {photo ? <Image source={{ uri: photo }} style={styles.carouselImage} contentFit="cover" accessible={false} /> : <View style={[styles.carouselImage, styles.spotlightImageFallback]}><Icon as={ImageOff} color={colors.textFaint} /></View>}
              <View style={styles.carouselDetails}>
                <Text variant="bodyStrong" numberOfLines={1}>{listing.title}</Text>
                <Text variant="subhead" tone="muted">{formatPeso(listing.dailyRate)}/day · {CONDITION_LABEL[listing.condition]}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {listings.length > 1 ? <View style={styles.carouselDots}>{listings.map((listing, dotIndex) => <View key={listing.id} style={[styles.dot, dotIndex === index && styles.activeDot]} />)}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  searchPressed: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.primary,
  },
  searchIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchTextBox: {
    flex: 1,
    gap: 1,
  },
  searchTitle: {
    fontWeight: '700',
    color: colors.text,
  },
  searchBadge: {
    backgroundColor: colors.surfaceSunken,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  searchBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
  },
  chips: { gap: spacing.sm, paddingTop: spacing.md },

  /* Clean Activity Bento Hub */
  activityCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activityTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activityTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  activityLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.link,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.surfaceSunken,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  statBoxActive: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  statValueActive: {
    color: colors.text,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
  },
  dueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  dueBannerOverdue: {
    backgroundColor: colors.dangerSoft,
  },
  dueBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },

  /* Automated Spotlight Showcase */
  spotlightWrapper: {
    gap: spacing.sm,
    overflow: 'hidden',
  },
  legacySpotlight: { display: 'none' },
  carouselShell: { gap: spacing.sm },
  carouselCard: { overflow: 'hidden', borderRadius: radii.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, ...elevation.low },
  carouselImage: { width: '100%', height: 180, backgroundColor: colors.surfaceSunken },
  carouselDetails: { minHeight: 66, justifyContent: 'center', gap: spacing.xxs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  carouselDots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  spotlightCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  spotlightCardPressed: {
    opacity: 0.96,
  },
  spotlightImageContainer: {
    position: 'relative',
    width: '100%',
    height: 180,
    backgroundColor: colors.surfaceSunken,
  },
  spotlightImage: {
    width: '100%',
    height: '100%',
  },
  spotlightImageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotlightBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  spotlightBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.ink,
  },
  spotlightPriceBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  spotlightPriceText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.surface,
  },
  spotlightPerDayText: {
    fontSize: 11,
    fontWeight: '400',
    color: colors.textOnInk,
  },
  spotlightDetails: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  spotlightMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spotlightCategory: {
    color: colors.link,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  conditionPill: {
    backgroundColor: colors.surfaceSunken,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  conditionPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
  },
  spotlightTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 22,
  },
  spotlightFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  spotlightPrompt: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  spotlightActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  spotlightActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.borderStrong,
  },
  activeDot: {
    width: 22,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
});
