import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CalendarClock, Inbox, PackagePlus, Repeat, Sparkles } from 'lucide-react-native';
import { EmptyState, ErrorState, ListRow, LoadingRows, Screen, StatusPill, Text } from '@/components/design-system';
import { GreetingHeader } from '@/components/shared/GreetingHeader';
import { Group, Section, StatRow } from '@/components/shared/Layout';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { dueLabel, summarizeLender } from '@/domain/rules/dashboard';
import { RoleSwitcher } from '@/features/auth/RoleSwitcher';
import { useSession } from '@/features/auth/session';
import { lenderTip } from '@/features/mascot/dialogue';
import { ReviewPrompts } from '@/features/reviews/ReviewPrompts';
import { formatDateOnly, todayInBusinessTz } from '@/lib/dates';
import { ok } from '@/lib/errors';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { bookingsRepository, ledgerRepository, listingsRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/** Lender dashboard (plan §4.3, Phase 5): requests, handovers, active rentals, equipment, simulated earnings. */
export default function LenderDashboard() {
  const { context } = useSession();
  const userId = context?.userId ?? '';
  const today = todayInBusinessTz();
  const data = useAsync(async () => {
    const [bookings, listings, payables] = await Promise.all([
      bookingsRepository.listMine(),
      listingsRepository.listByLender(userId),
      ledgerRepository.myPayables(userId),
    ]);
    if (!bookings.ok) return bookings;
    if (!listings.ok) return listings;
    if (!payables.ok) return payables;
    return ok(summarizeLender(bookings.data, listings.data, payables.data, userId, today));
  }, [userId, today]);
  const { reload } = data;
  useFocusEffect(useCallback(() => void reload(), [reload]));

  const firstName = (context?.fullName ?? '').split(' ')[0] || 'there';
  const d = data.data;
  const tip = d ? lenderTip(d) : null;
  const totalListings = d ? Object.values(d.listingCounts).reduce((a, b) => a + b, 0) - d.listingCounts.removed : 0;

  return (
    <Screen withTabBar refreshing={data.loading && Boolean(d)} onRefresh={reload}>
      <GreetingHeader eyebrow="Lending" title={`Hi, ${firstName}`} tip={tip} right={<NotificationBell />} />
      <RoleSwitcher current="lender" />
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={reload} />
      ) : !d ? (
        <LoadingRows rows={3} label="Loading your dashboard" />
      ) : (
        <>
          <Section title="Today">
            <StatRow
              stats={[
                { label: 'New requests', value: d.pendingRequests.length, onPress: () => router.navigate('/lender/requests'), tone: d.pendingRequests.length ? 'warning' : 'default' },
                { label: 'Handovers (7 days)', value: d.upcomingHandovers.length },
                { label: 'Out on rent', value: d.inProgress.length },
                { label: 'Overdue', value: d.overdue.length, tone: d.overdue.length ? 'danger' : 'default' },
              ]}
            />
          </Section>

          {d.pendingRequests.length > 0 ? (
            <Section title="Booking requests" action={{ label: 'Review', onPress: () => router.navigate('/lender/requests') }}>
              <Group>
                {d.pendingRequests.slice(0, 3).map((b) => (
                  <ListRow key={b.id} icon={Inbox} title={b.listingTitle} subtitle={`${formatDateOnly(b.pickupDate)} → ${formatDateOnly(b.returnDate)} · ${b.rentalDays} day${b.rentalDays === 1 ? '' : 's'}`} value={formatPeso(b.subtotal)} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })} />
                ))}
              </Group>
            </Section>
          ) : null}

          <ReviewPrompts role="lender" />

          {d.upcomingHandovers.length > 0 ? (
            <Section title="Upcoming handovers">
              <Group>
                {d.upcomingHandovers.map((b) => (
                  <ListRow key={b.id} icon={CalendarClock} title={b.listingTitle} subtitle={`Pickup ${formatDateOnly(b.pickupDate)}`} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })} />
                ))}
              </Group>
            </Section>
          ) : null}

          {d.inProgress.length > 0 ? (
            <Section title="Out on rent">
              <Group>
                {d.inProgress.map((b) => (
                  <ListRow
                    key={b.id}
                    icon={Repeat}
                    title={b.listingTitle}
                    onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}
                    subtitle={`Return by ${formatDateOnly(b.returnDate)}`}
                    trailing={
                      <StatusPill
                        label={b.status === 'return_requested' ? 'Returned: inspect' : b.status === 'disputed' ? 'Disputed' : dueLabel(b.returnDate, today)}
                        tone={b.status === 'overdue' || b.status === 'disputed' ? 'danger' : b.status === 'return_requested' ? 'info' : 'warning'}
                      />
                    }
                  />
                ))}
              </Group>
            </Section>
          ) : null}

          <Section title="My equipment" action={{ label: 'Manage', onPress: () => router.navigate('/lender/equipment') }}>
            {totalListings === 0 ? (
              <EmptyState
                icon={PackagePlus}
                title="List your first item"
                message="Calculators, cameras, lab gear, drafting tools: set your own daily rate and deposit."
                action={{ label: 'Go to My Equipment', onPress: () => router.navigate('/lender/equipment') }}
              />
            ) : (
              <StatRow
                stats={[
                  { label: 'Active', value: d.listingCounts.active, onPress: () => router.navigate('/lender/equipment') },
                  { label: 'Drafts', value: d.listingCounts.draft, onPress: () => router.navigate('/lender/equipment') },
                  { label: 'Paused', value: d.listingCounts.paused + d.listingCounts.unavailable, onPress: () => router.navigate('/lender/equipment') },
                ]}
              />
            )}
          </Section>

          <Section title="Estimated earnings">
            <View style={styles.earnings} accessible accessibilityLabel={`Estimated earnings ${formatPeso(d.estimatedEarnings)}, simulated`}>
              <View style={styles.earnRow}>
                <Text variant="largeTitle">{formatPeso(d.estimatedEarnings, { showCentavos: 'always' })}</Text>
                <StatusPill label="Simulated" tone="info" />
              </View>
              <Text variant="footnote" tone="muted">
                Your share of every paid rental so far, after the platform commission ({d.completedCount} completed). Refundable deposits aren’t included. This is a demo estimate: no real payout has been made.
              </Text>
            </View>
          </Section>

          <Section title="Grow your lending">
            <Group>
              <ListRow
                icon={Sparkles}
                title="TigRent Premium"
                subtitle="Featured listings, analytics, advanced calendar and promotional tools · PHP 99/month demo"
                onPress={() => router.push('/premium')}
                showChevron
                testID="open-premium"
              />
            </Group>
          </Section>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  earnings: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  earnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
});
