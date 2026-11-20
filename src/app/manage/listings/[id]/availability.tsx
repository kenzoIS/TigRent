import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { CalendarX, Lock } from 'lucide-react-native';
import { Banner, Button, Calendar, DateField, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, Sheet, Text, TextField, useToast } from '@/components/design-system';
import { Group, Section } from '@/components/shared/Layout';
import { addDays, compareDateOnly, formatDateOnly, todayInBusinessTz, type DateOnly } from '@/lib/dates';
import { useAsync } from '@/lib/use-async';
import { listingManagementRepository, premiumRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const within = (d: DateOnly, s: DateOnly, e: DateOnly) => compareDateOnly(d, s) >= 0 && compareDateOnly(d, e) <= 0;

/** Availability calendar: manual blocks + existing reservations (plan Phase 6). */
export default function ListingAvailability() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const listing = useAsync(() => listingManagementRepository.get(id), [id]);
  const premium = useAsync(() => premiumRepository.mine(), []);
  const today = todayInBusinessTz();
  const [start, setStart] = useState<DateOnly | null>(null);
  const [end, setEnd] = useState<DateOnly | null>(null);
  const [reason, setReason] = useState('');
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const l = listing.data;

  const unavailableReason = useMemo(() => {
    if (!l) return undefined;
    return (d: DateOnly) => {
      if (l.held.some((h) => within(d, h.startDate, h.endDate))) return 'Booked';
      if (l.blocks.some((b) => within(d, b.startDate, b.endDate))) return 'Blocked by you';
      return null;
    };
  }, [l]);

  const openBlock = (d: DateOnly) => {
    setStart(d);
    setEnd(d);
    setReason('');
    setError(null);
    setSheet(true);
  };

  const save = async () => {
    if (!start || !end) return setError('Choose both dates.');
    if (end > start && !premium.data?.isActive) return setError('Blocking a date range is a Premium demo feature. Single-day blocks remain available.');
    setBusy(true);
    const r = await listingManagementRepository.addBlock(id, start, end, reason);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setSheet(false);
    toast.show({ title: 'Dates blocked', tone: 'success' });
    void listing.reload();
  };

  const unblock = async (blockId: string) => {
    const r = await listingManagementRepository.removeBlock(blockId);
    if (!r.ok) return toast.show({ title: 'Couldn’t unblock', message: r.error.message, tone: 'danger' });
    toast.show({ title: 'Dates available again', tone: 'success' });
    void listing.reload();
  };

  return (
    <Screen>
      <ScreenHeader title="Availability" size="compact" back />
      {listing.error ? (
        <ErrorState offline={listing.error.kind === 'network'} message={listing.error.message} onRetry={listing.reload} />
      ) : !l ? (
        <LoadingRows rows={3} />
      ) : (
        <View style={styles.body}>
          <Text variant="callout" tone="muted">Tap a free date to block it. Booked and blocked dates are crossed out. Blocking never cancels an existing booking. Multi-day blocking is a Premium demo tool.</Text>
          <View style={styles.calendar}>
            <Calendar value={null} onChange={openBlock} minDate={today} maxDate={addDays(today, 365)} unavailableReason={unavailableReason} />
          </View>

          <Section title="Blocked by you">
            {l.blocks.length === 0 ? (
              <Text variant="footnote" tone="muted">No blocked dates.</Text>
            ) : (
              <Group>
                {l.blocks.map((b) => (
                  <ListRow
                    key={b.id}
                    icon={CalendarX}
                    title={`${formatDateOnly(b.startDate)} → ${formatDateOnly(b.endDate)}`}
                    subtitle={b.reason ?? undefined}
                    trailing={<Button label="Unblock" variant="ghost" size="sm" onPress={() => void unblock(b.id)} />}
                  />
                ))}
              </Group>
            )}
          </Section>

          <Section title="Booked">
            {l.held.length === 0 ? (
              <Text variant="footnote" tone="muted">No current or upcoming bookings.</Text>
            ) : (
              <Group>
                {l.held.map((h) => (
                  <ListRow key={h.bookingId} icon={Lock} title={`${formatDateOnly(h.startDate)} → ${formatDateOnly(h.endDate)}`} subtitle="Reserved by a booking" />
                ))}
              </Group>
            )}
          </Section>
        </View>
      )}

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Block dates" description="Students won’t be able to request these dates." footer={<Button label="Block dates" onPress={save} loading={busy} fullWidth testID="block-save" />}>
        <View style={styles.form}>
          {error ? <Banner tone="danger" title={error} /> : null}
          <DateField label="From" value={start} onChange={setStart} minDate={today} required />
          <DateField label="To" value={end} onChange={setEnd} minDate={start ?? today} required />
          <TextField label="Reason (only you see this)" value={reason} onChangeText={setReason} maxLength={200} placeholder="e.g. Using it for my own project" />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  calendar: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md },
  form: { gap: spacing.lg },
});
