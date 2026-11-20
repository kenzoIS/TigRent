import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Text } from '@/components/design-system';
import { ok } from '@/lib/errors';
import { useAsync } from '@/lib/use-async';
import { signedEvidenceUrls } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/** Private condition photos for a booking (handover/return). Only parties and staff can load them. */
export function EvidencePhotos({ paths, label }: { paths: string[]; label: string }) {
  const urls = useAsync(() => (paths.length ? signedEvidenceUrls(paths) : Promise.resolve(ok<Record<string, string>>({}))), [paths.join('|')]);
  if (paths.length === 0) return null;
  return (
    <View style={styles.root} testID="evidence-photos">
      <Text variant="caption" tone="muted">{label} · private</Text>
      <View style={styles.row}>
        {paths.map((p) => (
          <View key={p} style={styles.thumb}>
            {urls.data?.[p] ? <Image source={{ uri: urls.data[p] }} style={styles.image} contentFit="cover" accessibilityLabel={label} /> : null}
          </View>
        ))}
      </View>
      {urls.error ? <Text variant="caption" tone="muted">{urls.error.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surfaceSunken },
  image: { width: '100%', height: '100%' },
});
