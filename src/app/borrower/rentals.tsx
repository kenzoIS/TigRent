import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';
import { Banner, Chip, EmptyState, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, StatusPill } from '@/components/design-system';
import { BOOKING_STATUS_LABEL as STATUS_LABEL } from '@/features/bookings/status';
import { Group } from '@/components/shared/Layout';
import { ReviewPrompts } from '@/features/reviews/ReviewPrompts';
import type { BookingStatus, BookingSummary } from '@/domain/entities';
import { useSession } from '@/features/auth/session';
import { formatDateOnly } from '@/lib/dates';
import { formatDateTimeManila } from '@/lib/format';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { bookingsRepository } from '@/repositories';
import { spacing } from '@/theme';

type Filter = 'requested' | 'upcoming' | 'active' | 'completed' | 'cancelled' | 'disputed';
const GROUPS: Record<Filter, { label: string; statuses: BookingStatus[] }> = {
  requested: { label: 'Requested', statuses: ['pending_lender_approval', 'awaiting_payment'] },
  upcoming: { label: 'Upcoming', statuses: ['confirmed'] },
  active: { label: 'Active', statuses: ['active', 'overdue', 'return_requested'] },
  completed: { label: 'Completed', statuses: ['completed'] },
  cancelled: { label: 'Cancelled', statuses: ['cancelled', 'rejected', 'payment_expired'] },
  disputed: { label: 'Disputed', statuses: ['disputed'] },
};

/** My Rentals (plan §4.2): every borrowing grouped by state; each opens its booking detail. */
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {(Object.keys(GROUPS) as Filter[]).map((k) => (
          <Chip key={k} label={`${GROUPS[k].label} ${counts[k] ?? 0}`} selected={current === k} onPress={() => setFilter(k)} testID={`rentals-filter-${k}`} />
        ))}
      </ScrollView>
      {list.error ? (
        <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={reload} />
      ) : !list.data ? (
        <LoadingRows rows={3} label="Loading rentals" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={mine.length === 0 ? 'No rentals yet' : `No ${GROUPS[current].label.toLowerCase()} rentals`}
          message={mine.length === 0 ? 'When you request an item, its status and dates appear here.' : 'Try another tab above.'}
          action={mine.length === 0 ? { label: 'See featured items', onPress: () => router.navigate('/borrower') } : undefined}
        />
      ) : (
        <Group>
          {rows.map((b) => (
            <ListRow
              key={b.id}
              title={b.listingTitle}
              subtitle={`${formatDateOnly(b.pickupDate)} → ${formatDateOnly(b.returnDate)} · ${b.rentalDays} day${b.rentalDays === 1 ? '' : 's'}\n${
                b.status === 'awaiting_payment' && b.holdExpiresAt
                  ? `Pay ${formatPeso(b.total)} by ${formatDateTimeManila(b.holdExpiresAt).split(', ')[1]} (demo)`
                  : `Total ${formatPeso(b.total)} incl. ${formatPeso(b.deposit)} refundable deposit`
              }`}
              trailing={<StatusPill label={STATUS_LABEL[b.status].label} tone={STATUS_LABEL[b.status].tone} />}
              onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}
              testID={`rental-${b.id}`}
            />
          ))}
        </Group>
      )}
      <Banner tone="neutral" title="Everything for a rental is in one place" message="Tap a rental for its timeline, messages, handover, extensions and return. Cancellations, late fees and damage claims arrive in the next build step (Phase 10)." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  filters: { gap: spacing.sm, paddingBottom: spacing.md },
});
