import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  AlertCircle,
  Ban,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  Clock,
  Inbox,
  Package,
  ShieldCheck,
  Zap,
} from 'lucide-react-native';
import {
  Banner,
  Chip,
  EmptyState,
  ErrorState,
  Icon,
  LoadingRows,
  Screen,
  ScreenHeader,
  StatusPill,
  Text,
  type IconComponent,
} from '@/components/design-system';
import { BOOKING_STATUS_LABEL as STATUS_LABEL } from '@/features/bookings/status';
import { ReviewPrompts } from '@/features/reviews/ReviewPrompts';
import type { BookingStatus, BookingSummary } from '@/domain/entities';
import { useSession } from '@/features/auth/session';
import { formatDateOnly } from '@/lib/dates';
import { formatDateTimeManila } from '@/lib/format';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { bookingsRepository } from '@/repositories';
import { colors, elevation, radii, spacing } from '@/theme';

type Filter = 'requested' | 'upcoming' | 'active' | 'completed' | 'cancelled' | 'disputed';

const GROUPS: Record<Filter, { label: string; icon: IconComponent; statuses: BookingStatus[] }> = {
  requested: { label: 'Requested', icon: Inbox, statuses: ['pending_lender_approval', 'awaiting_payment'] },
  upcoming: { label: 'Upcoming', icon: CalendarClock, statuses: ['confirmed'] },
  active: { label: 'Active', icon: Zap, statuses: ['active', 'overdue', 'return_requested'] },
  completed: { label: 'Completed', icon: CheckCircle2, statuses: ['completed'] },
  cancelled: { label: 'Cancelled', icon: Ban, statuses: ['cancelled', 'rejected', 'payment_expired'] },
  disputed: { label: 'Disputed', icon: AlertCircle, statuses: ['disputed'] },
};

/** My Rentals (plan §4.2): every borrowing grouped by state; elevated lively cards with breathable layout. */
export default function MyRentals() {
  const { context } = useSession();
  const userId = context?.userId ?? '';
  const list = useAsync(() => bookingsRepository.listMine(), [userId]);
  const { reload } = list;
  useFocusEffect(useCallback(() => void reload(), [reload]));
  const mine = useMemo(() => (list.data ?? []).filter((b) => b.borrowerId === userId), [list.data, userId]);
  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    for (const k of Object.keys(GROUPS) as Filter[]) c[k] = mine.filter((b) => GROUPS[k].statuses.includes(b.status)).length;
    return c;
  }, [mine]);
  const firstNonEmpty = (Object.keys(GROUPS) as Filter[]).find((k) => counts[k] > 0) ?? 'active';
  const [filter, setFilter] = useState<Filter | null>(null);
  const current = filter ?? (counts.active > 0 ? 'active' : firstNonEmpty);
  const rows: BookingSummary[] = mine.filter((b) => GROUPS[current].statuses.includes(b.status));

  return (
    <Screen withTabBar refreshing={list.loading && Boolean(list.data)} onRefresh={reload}>
      <ScreenHeader title="My Rentals" eyebrow="Borrowing" />
      <ReviewPrompts role="borrower" />

      {/* ── Filter Chips Bar with Live Counters & Themed Icons ─────────── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {(Object.keys(GROUPS) as Filter[]).map((k) => {
          const g = GROUPS[k];
          return (
            <Chip
              key={k}
              icon={g.icon}
              label={`${g.label} (${counts[k] ?? 0})`}
              selected={current === k}
              onPress={() => setFilter(k)}
              testID={`rentals-filter-${k}`}
            />
          );
        })}
      </ScrollView>

      {list.error ? (
        <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={reload} />
      ) : !list.data ? (
        <LoadingRows rows={3} label="Loading rentals" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={mine.length === 0 ? 'No rentals yet' : `No ${GROUPS[current].label.toLowerCase()} rentals`}
          message={mine.length === 0 ? 'When you request an item, its live status, timeline, and dates appear here.' : 'Try another tab above.'}
          action={mine.length === 0 ? { label: 'Explore campus gear', onPress: () => router.navigate('/borrower') } : undefined}
        />
      ) : (
        /* ── Lively Student Rental Cards ─────────────────────────────── */
        <View style={styles.cardsList}>
          {rows.map((b) => {
            const statusConfig = STATUS_LABEL[b.status];
            const isPaymentPending = b.status === 'awaiting_payment';

            return (
              <Pressable
                key={b.id}
                onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}
                accessibilityRole="button"
                accessibilityLabel={`${b.listingTitle}, status: ${statusConfig.label}`}
                style={({ pressed }) => [
                  styles.rentalCard,
                  elevation.low,
                  pressed && styles.rentalCardPressed,
                  isPaymentPending && styles.rentalCardUrgent,
                ]}
                testID={`rental-${b.id}`}
              >
                {/* Card Top Row: Package badge, Status Pill, Chevron */}
                <View style={styles.cardHeader}>
                  <View style={styles.iconCircle}>
                    <Icon as={Package} size={16} color={colors.ink} />
                  </View>
                  <View style={styles.headerSpacer}>
                    <StatusPill label={statusConfig.label} tone={statusConfig.tone} />
                  </View>
                  <Icon as={ChevronRight} size={18} color={colors.textMuted} />
                </View>

                {/* Card Middle: Title & Timeline */}
                <View style={styles.cardContent}>
                  <Text style={styles.listingTitle} numberOfLines={2}>
                    {b.listingTitle}
                  </Text>

                  {/* Compact Timeline Strip */}
                  <View style={styles.timelineStrip}>
                    <View style={styles.timelineDates}>
                      <Icon as={CalendarRange} size={13} color={colors.link} />
                      <Text style={styles.datesText}>
                        {formatDateOnly(b.pickupDate)} → {formatDateOnly(b.returnDate)}
                      </Text>
                    </View>
                    <View style={styles.durationPill}>
                      <Text style={styles.durationText}>
                        {b.rentalDays} day{b.rentalDays === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Urgent Payment Alert Banner if applicable */}
                {isPaymentPending && b.holdExpiresAt ? (
                  <View style={styles.paymentAlertBox}>
                    <Icon as={Clock} size={13} color={colors.warning} />
                    <Text style={styles.paymentAlertText}>
                      Pay {formatPeso(b.total)} by {formatDateTimeManila(b.holdExpiresAt).split(', ')[1]} to confirm (demo)
                    </Text>
                  </View>
                ) : null}

                {/* Card Footer: Total Price & Deposit Breakdown */}
                <View style={styles.cardFooter}>
                  <View style={styles.pricingStack}>
                    <Text style={styles.priceTotal}>Total {formatPeso(b.total)}</Text>
                    <Text style={styles.depositLabel}>
                      incl. {formatPeso(b.deposit)} refundable deposit
                    </Text>
                  </View>
                  <View style={styles.viewDetailsBtn}>
                    <Text style={styles.viewDetailsText}>Manage</Text>
                    <Icon as={ChevronRight} size={13} color={colors.ink} />
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* ── Spaced Info Guarantee Banner with Breathable Separation ─────── */}
      <View style={styles.guaranteeContainer}>
        <Banner
          tone="gold"
          title="Campus Rental Protection"
          message="Every rental includes verified UST student identities, deposit escrow safety, and photo-documented handovers."
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  cardsList: {
    gap: spacing.md,
  },
  rentalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rentalCardPressed: {
    opacity: 0.94,
    transform: [{ scale: 0.995 }],
  },
  rentalCardUrgent: {
    borderColor: colors.warning,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    flex: 1,
    flexDirection: 'row',
  },
  cardContent: {
    gap: 6,
  },
  listingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  timelineStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  timelineDates: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  datesText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.textMuted,
  },
  durationPill: {
    backgroundColor: colors.surfaceSunken,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  durationText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.link,
  },
  paymentAlertBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: radii.md,
  },
  paymentAlertText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.warning,
    flex: 1,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pricingStack: {
    gap: 1,
  },
  priceTotal: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  depositLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
  },
  viewDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  viewDetailsText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.ink,
  },
  guaranteeContainer: {
    marginTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
});
