import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Flag, ShieldCheck } from 'lucide-react-native';
import { Banner, Button, EmptyState, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, Sheet, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import { Group, Section } from '@/components/shared/Layout';
import { ok } from '@/lib/errors';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { listingModerationRepository, type ListingReportItem } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

type Pending = { kind: 'hide'; report: ListingReportItem } | { kind: 'restore'; listingId: string; title: string };

/** Listing report queue and hidden listings (plan §4.4, Phase 6 moderation status). */
export default function ListingReports() {
  const toast = useToast();
  const data = useAsync(async () => {
    const [open, hidden] = await Promise.all([listingModerationRepository.listOpen(), listingModerationRepository.listHidden()]);
    if (!open.ok) return open;
    if (!hidden.ok) return hidden;
    return ok({ open: open.data, hidden: hidden.data });
  }, []);
  const { reload } = data;
  useFocusEffect(useCallback(() => void reload(), [reload]));
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismiss = async (r: ListingReportItem) => {
    const res = await listingModerationRepository.resolve(r.id, 'dismiss');
    if (!res.ok) return setError(res.error.message);
    toast.show({ title: 'Report dismissed', message: 'The listing stays visible.', tone: 'neutral' });
    void reload();
  };

  const confirm = async () => {
    if (!pending) return;
    if (note.trim().length < 10) return setNoteError('Explain the decision (at least 10 characters). The lender sees this.');
    setBusy(true);
    const res = pending.kind === 'hide' ? await listingModerationRepository.resolve(pending.report.id, 'hide', note.trim()) : await listingModerationRepository.restore(pending.listingId, note.trim());
    setBusy(false);
    if (!res.ok) return setNoteError(res.error.message);
    toast.show({ title: pending.kind === 'hide' ? 'Listing hidden' : 'Listing restored', message: 'The lender was notified.', tone: 'success' });
    setPending(null);
    void reload();
  };

  return (
    <Screen refreshing={data.loading && Boolean(data.data)} onRefresh={reload}>
      <ScreenHeader title="Listing reports" size="compact" back />
      {error ? <Banner tone="danger" title="Couldn’t update" message={error} onDismiss={() => setError(null)} /> : null}
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={reload} />
      ) : !data.data ? (
        <LoadingRows rows={3} />
      ) : (
        <>
          <Section title="Open reports">
            {data.data.open.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="No open reports" message="Reported listings will appear here." />
            ) : (
              <View style={styles.list}>
                {data.data.open.map((r) => (
                  <View key={r.id} style={styles.card} testID={`report-${r.id}`}>
                    <View style={styles.cardHead}>
                      <Text variant="headline" style={styles.flex}>{r.listingTitle}</Text>
                      {r.listingModeration === 'hidden' ? <StatusPill label="Hidden" tone="danger" /> : null}
                    </View>
                    <Text variant="callout">“{r.reason}”</Text>
                    {r.details ? <Text variant="subhead" tone="muted">{r.details}</Text> : null}
                    <Text variant="caption" tone="faint">Reported {formatDateTimeManila(r.createdAt)}</Text>
                    <View style={styles.actions}>
                      <Button label="Dismiss" variant="secondary" size="sm" onPress={() => void dismiss(r)} style={styles.flex} />
                      <Button label="Hide listing" variant="danger" size="sm" onPress={() => { setNote(''); setNoteError(null); setPending({ kind: 'hide', report: r }); }} style={styles.flex} testID={`report-hide-${r.id}`} />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </Section>
          <Section title="Hidden listings">
            {data.data.hidden.length === 0 ? (
              <Text variant="footnote" tone="muted">No hidden listings.</Text>
            ) : (
              <Group>
                {data.data.hidden.map((h) => (
                  <ListRow
                    key={h.id}
                    icon={Flag}
                    title={h.title}
                    trailing={<Button label="Restore" variant="ghost" size="sm" onPress={() => { setNote(''); setNoteError(null); setPending({ kind: 'restore', listingId: h.id, title: h.title }); }} />}
                  />
                ))}
              </Group>
            )}
          </Section>
        </>
      )}
      <Sheet
        visible={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.kind === 'hide' ? 'Hide listing' : 'Restore listing'}
        description={pending?.kind === 'hide' ? 'Students won’t see it until restored. Existing bookings are not affected.' : 'The listing becomes visible again if it is active.'}
        footer={<Button label={pending?.kind === 'hide' ? 'Hide listing' : 'Restore'} variant={pending?.kind === 'hide' ? 'danger' : 'primary'} onPress={confirm} loading={busy} fullWidth testID="moderation-confirm" />}
      >
        <TextField label="Note to the lender" multiline value={note} onChangeText={(t) => { setNote(t); setNoteError(null); }} error={noteError} maxLength={500} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
});
