import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Award, ShieldCheck } from 'lucide-react-native';
import { ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, StatusPill, Text } from '@/components/design-system';
import { Group, Section, StatRow } from '@/components/shared/Layout';
import { CONDITION_LABEL } from '@/domain/listings';
import { formatDateTimeManila } from '@/lib/format';
import { ok } from '@/lib/errors';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { ReviewList } from '@/features/reviews/ReviewList';
import { discoveryRepository, profileSummaryRepository } from '@/repositories';
import { spacing } from '@/theme';

/** Public lender profile for borrowers (plan §4.2 "lender profile"): trust signals and active listings. */
export default function LenderProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useAsync(async () => {
    const [summary, listings] = await Promise.all([profileSummaryRepository.get(id), discoveryRepository.lenderListings(id)]);
    if (!summary.ok) return summary;
    return ok({ summary: summary.data, listings: listings.ok ? listings.data : [] });
  }, [id]);
  const s = data.data?.summary;
  return (
    <Screen>
      <ScreenHeader title="Lender" size="compact" back />
      {data.error ? (
        <ErrorState offline={data.error.kind === 'network'} message={data.error.message} onRetry={data.reload} />
      ) : !s || !data.data ? (
        <LoadingRows rows={3} />
      ) : (
        <View style={styles.body}>
          <Text variant="title">{s.fullName}</Text>
          <Text variant="footnote" tone="muted">Member since {formatDateTimeManila(s.memberSince).split(',')[0]}</Text>
          <View style={styles.pills}>
            {s.isStudentVerified ? <StatusPill label="Student verified" tone="success" icon={ShieldCheck} /> : null}
            {s.badges.some((b) => b.code === 'trusted_lender') ? <StatusPill label="Verified Trusted Lender" tone="success" icon={Award} /> : null}
          </View>
          <StatRow
            stats={[
              { label: `Lender rating (${s.lenderRating.count})`, value: s.lenderRating.count ? `★ ${s.lenderRating.avg?.toFixed(1)}` : '–' },
              { label: 'Completed lendings', value: s.completedLendings },
              { label: 'Active items', value: data.data.listings.length },
            ]}
          />
          <Text variant="footnote" tone="muted">Badges mean TigRent prototype criteria were met; they are not an official UST endorsement.</Text>
          <Section title="Available from this lender">
            {data.data.listings.length === 0 ? (
              <Text variant="footnote" tone="muted">No active listings right now.</Text>
            ) : (
              <Group>
                {data.data.listings.map((l) => (
                  <ListRow key={l.id} title={l.title} subtitle={CONDITION_LABEL[l.condition]} value={`${formatPeso(l.dailyRate)}/day`} onPress={() => router.push({ pathname: '/explore/listing/[id]', params: { id: l.id } })} />
                ))}
              </Group>
            )}
          </Section>
          <Section title="Reviews from borrowers">
            <ReviewList userId={id} direction="borrower_to_lender" emptyText="No reviews yet." />
          </Section>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
