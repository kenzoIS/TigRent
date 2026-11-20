import { StyleSheet, View } from 'react-native';
import { ErrorState, LoadingRows, Screen, ScreenHeader, StatusPill, Text } from '@/components/design-system';
import type { TermsDocType } from '@/domain/entities';
import { useAsync } from '@/lib/use-async';
import { termsRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const ORDER: TermsDocType[] = ['tos', 'privacy', 'rental_terms'];

/** Read-only viewer for the active policy documents (plan §4.1). */
export default function Policies() {
  const docs = useAsync(() => termsRepository.listActive(), []);
  return (
    <Screen>
      <ScreenHeader title="Terms & policies" size="compact" back />
      {docs.error ? (
        <ErrorState offline={docs.error.kind === 'network'} message={docs.error.message} onRetry={docs.reload} />
      ) : !docs.data ? (
        <LoadingRows rows={3} label="Loading documents" />
      ) : (
        <View style={styles.list}>
          {[...docs.data].sort((a, b) => ORDER.indexOf(a.docType) - ORDER.indexOf(b.docType)).map((d) => (
            <View key={d.id} style={styles.doc}>
              <Text variant="headline">{d.title}</Text>
              <View style={styles.pills}>
                <StatusPill label={`Version ${d.version}`} />
                {d.isSample ? <StatusPill label="Prototype text, not legally reviewed" tone="warning" /> : null}
              </View>
              <Text variant="callout">{d.content}</Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.lg },
  doc: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
