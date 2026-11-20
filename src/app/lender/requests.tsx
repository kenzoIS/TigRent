import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CalendarPlus, Clock, Inbox, TriangleExclamationPoint } from 'lucide-react-native';
import { EmptyState, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, StatusPill, Text } from '@/components/design-system';
import { Group, Section } from '@/components/shared/Layout';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { CONFLICT_MESSAGE, groupRequests } from '@/domain/bookings';
import { statusLabelFor } from '@/features/bookings/status';
import { formatDateOnly } from '@/lib/dates';
import { formatDateTimeManila } from '@/lib/format';
import { ok } from '@/lib/errors';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { bookingFlowRepository, type RequestInboxRow } from '@/repositories';
import { colors, spacing } from '@/theme';

const dates = (r: RequestInboxRow) => `${formatDateOnly(r.pickupDate)} → ${formatDateOnly(r.returnDate)} · ${r.rentalDays} day${r.rentalDays === 1 ? '' : 's'}`;
const open = (id: string) => router.push({ pathname: '/booking/[id]', params: { id } });

/** Lender request inbox (plan §4.3): new requests with conflict flags, extension requests, holds, recent decisions. */
export default function LenderRequests() {
  const list = useAsync(async () => {
    const [requests, extensions] = await Promise.all([bookingFlowRepository.inbox(), bookingFlowRepository.extensionInbox()]);
    if (!requests.ok) return requests;
    return ok({ requests: requests.data, extensions: extensions.ok ? extensions.data : [] });
  }, []);
  const { reload } = list;
  useFocusEffect(useCallback(() => void reload(), [reload]));
  const g = groupRequests(list.data?.requests ?? []);
  const extensions = list.data?.extensions ?? [];

  return (
    <Screen withTabBar refreshing={list.loading && Boolean(list.data)} onRefresh={reload}>
      <ScreenHeader title="Requests" eyebrow="Lending" right={<NotificationBell />} />
      {list.error ? (
        <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={reload} />
      ) : !list.data ? (
        <LoadingRows rows={3} label="Loading requests" />
      ) : list.data.requests.length === 0 && extensions.length === 0 ? (
        <EmptyState icon={Inbox} title="No requests yet" message="When a student asks to rent one of your items, it appears here for you to accept or decline." />
      ) : (
        <View style={styles.body}>
          <Section title={`New requests (${g.pending.length})`}>
            {g.pending.length === 0 ? (
              <Text variant="callout" tone="muted">You’re all caught up.</Text>
            ) : (
              <Group>
                {g.pending.map((r) => (
                  <ListRow
                    key={r.id}
                    icon={r.conflict ? TriangleExclamationPoint : Inbox}
                    iconTint={r.conflict ? colors.warning : undefined}
                    title={r.listingTitle}
                    subtitle={`${r.borrowerName} · ${dates(r)}${r.conflict ? `\n${CONFLICT_MESSAGE[r.conflict].title}` : ''}`}
                    value={formatPeso(r.subtotal)}
                    onPress={() => open(r.id)}
                    showChevron
                    testID={`request-${r.id}`}
                  />
                ))}
              </Group>
            )}
          </Section>

          {extensions.length > 0 ? (
            <Section title={`Extension requests (${extensions.length})`}>
              <Group>
                {extensions.map((e) => (
                  <ListRow
                    key={e.id}
                    icon={e.conflict ? TriangleExclamationPoint : CalendarPlus}
                    iconTint={e.conflict ? colors.warning : undefined}
                    title={e.listingTitle}
                    subtitle={`${e.borrowerName} · until ${formatDateOnly(e.newReturnDate)} (+${e.extraDays} day${e.extraDays === 1 ? '' : 's'})
${
                      e.status === 'approved_awaiting_payment' ? 'Approved: waiting for payment' : e.conflict ? 'Dates no longer available' : 'Needs your decision'
                    }`}
                    value={formatPeso(e.extraAmount)}
                    onPress={() => open(e.bookingId)}
                    showChevron
                    testID={`extension-request-${e.id}`}
                  />
                ))}
              </Group>
            </Section>
          ) : null}

          {g.awaiting.length > 0 ? (
            <Section title="Waiting for payment">
              <Group>
                {g.awaiting.map((r) => (
                  <ListRow
                    key={r.id}
                    icon={Clock}
                    title={r.listingTitle}
                    subtitle={`${r.borrowerName} · ${dates(r)}${r.holdExpiresAt ? `\nHeld until ${formatDateTimeManila(r.holdExpiresAt).split(', ')[1]}` : ''}`}
                    onPress={() => open(r.id)}
                    showChevron
                    testID={`request-${r.id}`}
                  />
                ))}
              </Group>
            </Section>
          ) : null}

          {g.recent.length > 0 ? (
            <Section title="Recent decisions">
              <Group>
                {g.recent.map((r) => {
                  const l = statusLabelFor('lender', r.status);
                  return (
                    <ListRow
                      key={r.id}
                      title={r.listingTitle}
                      subtitle={`${r.borrowerName} · ${dates(r)}`}
                      trailing={<StatusPill label={l.label} tone={l.tone} />}
                      onPress={() => open(r.id)}
                      testID={`request-${r.id}`}
                    />
                  );
                })}
              </Group>
            </Section>
          ) : null}
          <Text variant="footnote" tone="muted">Amounts are rent before the platform commission. Payments are simulated.</Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
});
