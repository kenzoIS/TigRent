import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Flag } from 'lucide-react-native';
import { Banner, Button, EmptyState, ErrorState, LoadingRows, Screen, ScreenHeader, Text, TextField } from '@/components/design-system';
import { StarRating } from '@/features/reviews/StarRating';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { trustRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/** Reported reviews (plan Phase 11): keep (clears the report) or hide (excluded from ratings and account health). */
export default function ReportedReviews() {
  const list = useAsync(() => trustRepository.reportedReviews(), []);
  const { reload } = list;
  useFocusEffect(useCallback(() => void reload(), [reload]));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (id: string, action: 'keep' | 'hide') => {
    setBusy(id);
    setError(null);
    const r = await trustRepository.moderateReview(id, action, notes[id] ?? '');
    setBusy(null);
    if (!r.ok) return setError(r.error.message);
    void reload();
  };

  return (
    <Screen refreshing={list.loading && Boolean(list.data)} onRefresh={reload}>
      <ScreenHeader title="Reported reviews" eyebrow="Moderation" size="compact" back />
      <View style={styles.body}>
        {error ? <Banner tone="danger" title="Not recorded" message={error} /> : null}
        {list.error ? (
          <ErrorState offline={list.error.kind === 'network'} message={list.error.message} onRetry={reload} />
        ) : !list.data ? (
          <LoadingRows rows={3} label="Loading reports" />
        ) : list.data.length === 0 ? (
          <EmptyState icon={Flag} title="No reported reviews" message="Reports from members appear here." />
        ) : (
          list.data.map((r) => (
            <View key={r.id} style={styles.card} testID={`reported-${r.id}`}>
              <StarRating value={r.rating} size={18} />
              {r.comment ? <Text variant="callout">“{r.comment}”</Text> : null}
              <Text variant="footnote" tone="muted">
                {r.reviewerName} → {r.targetName} ({r.direction === 'borrower_to_lender' ? 'lender' : 'borrower'}) · {r.listingTitle}
              </Text>
              <Text variant="footnote">Report: {r.reportReason ?? '—'} · {formatDateTimeManila(r.reportedAt)}</Text>
              <TextField label="Moderation note" value={notes[r.id] ?? ''} onChangeText={(v) => setNotes((n) => ({ ...n, [r.id]: v }))} maxLength={500} testID={`note-${r.id}`} />
              <View style={styles.row}>
                <Button label="Keep" variant="secondary" style={styles.flex} loading={busy === r.id} disabled={(notes[r.id] ?? '').trim().length < 3} disabledReason="Add a note." onPress={() => void act(r.id, 'keep')} testID={`keep-${r.id}`} />
                <Button label="Hide" variant="danger" style={styles.flex} loading={busy === r.id} disabled={(notes[r.id] ?? '').trim().length < 3} disabledReason="Add a note." onPress={() => void act(r.id, 'hide')} testID={`hide-${r.id}`} />
              </View>
              <Button label="Review this member’s account" variant="ghost" size="sm" onPress={() => router.push({ pathname: '/admin/accounts/[id]', params: { id: r.targetId } })} />
            </View>
          ))
        )}
        <Text variant="footnote" tone="muted">Hidden reviews stay on record but no longer count towards ratings, the Trusted Lender badge or the low-rating rule. Actions are audited.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
