import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ScrollText } from 'lucide-react-native';
import { EmptyState, ErrorState, LoadingRows, Screen, ScreenHeader, Text } from '@/components/design-system';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { premiumRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';
/** Append-only admin audit history (Phase 12). */
export default function AuditScreen() { const data = useAsync(() => premiumRepository.audit(), []); const { reload } = data; useFocusEffect(useCallback(() => void reload(), [reload])); return <Screen refreshing={data.loading && Boolean(data.data)} onRefresh={reload}><ScreenHeader title="Audit log" eyebrow="Admin history" size="compact" back /><View style={styles.body}>{data.error ? <ErrorState message={data.error.message} onRetry={reload} /> : !data.data ? <LoadingRows rows={4} /> : data.data.length === 0 ? <EmptyState icon={ScrollText} title="No audit events" message="Protected actions appear here." /> : data.data.map((a) => <View key={a.id} style={styles.card}><Text variant="bodyStrong">{a.action.replaceAll('.', ' · ')}</Text><Text variant="footnote" tone="muted">{a.actorName ?? 'System'} · {a.entityType}{a.entityId ? ` · ${a.entityId}` : ''}</Text><Text variant="caption" tone="muted">{formatDateTimeManila(a.createdAt)}</Text></View>)}</View></Screen>; }
const styles = StyleSheet.create({ body: { gap: spacing.sm }, card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs } });
