import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FileCog, Plus } from 'lucide-react-native';
import { Banner, Button, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, Sheet, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import { Group, Section } from '@/components/shared/Layout';
import { useAsync } from '@/lib/use-async';
import { premiumRepository, settingsRepository } from '@/repositories';
import type { PlatformSetting } from '@/domain/entities';
import { colors, radii, spacing } from '@/theme';

/** Admin-operated, versioned sample configuration. Values are parsed as JSON and server-validated. */
export default function ConfigurationScreen() {
  const toast = useToast();
  const settings = useAsync(() => settingsRepository.listCurrent(), []);
  const policies = useAsync(() => premiumRepository.policies(), []);
  const [editing, setEditing] = useState<PlatformSetting | null>(null);
  const [value, setValue] = useState(''); const [description, setDescription] = useState(''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [newPolicy, setNewPolicy] = useState(false); const [label, setLabel] = useState(''); const [rules, setRules] = useState('');
  const open = (s: PlatformSetting) => { setEditing(s); setValue(JSON.stringify(s.value)); setDescription(s.description); setError(null); };
  const save = async () => { if (!editing) return; let parsed: unknown; try { parsed = JSON.parse(value); } catch { return setError('Value must be valid JSON.'); } setBusy(true); const r = await premiumRepository.updateSetting(editing.key, parsed, description); setBusy(false); if (!r.ok) return setError(r.error.message); setEditing(null); toast.show({ title: 'Setting version saved', message: 'New bookings use the current setting; snapshots are retained.', tone: 'success' }); void settings.reload(); };
  const createPolicy = async () => { let parsed: unknown; try { parsed = JSON.parse(rules); } catch { return setError('Rules must be valid JSON.'); } setBusy(true); const r = await premiumRepository.createPolicy(label, parsed); setBusy(false); if (!r.ok) return setError(r.error.message); setNewPolicy(false); toast.show({ title: 'Policy activated', message: 'Existing bookings retain their accepted policy snapshot.', tone: 'success' }); void policies.reload(); };
  return <Screen><ScreenHeader title="Policies, fees & thresholds" eyebrow="Admin configuration" size="compact" back /><View style={styles.body}>
    <Banner tone="warning" title="Sample configuration" message="These are prototype values, not approved business or legal terms. Changes are versioned and audited." />
    {settings.error ? <ErrorState message={settings.error.message} onRetry={settings.reload} /> : !settings.data ? <LoadingRows rows={5} /> : <Section title="Current platform settings"><Group>{settings.data.map((s) => <ListRow key={s.key} icon={FileCog} title={s.key.replaceAll('_', ' ')} subtitle={`${JSON.stringify(s.value)} · v${s.version}${s.isSample ? ' · sample' : ''}`} onPress={() => open(s)} showChevron />)}</Group></Section>}
    <Section title="Cancellation policy"><Text variant="footnote" tone="muted">Activating a new version never changes bookings that already stored a policy snapshot.</Text>{policies.data?.map((p) => <View key={p.id} style={styles.card}><Text variant="bodyStrong">{p.label} · v{p.version}</Text><StatusPill label={p.is_active ? 'Current' : 'Archived'} tone={p.is_active ? 'success' : 'neutral'} /><Text variant="caption" tone="muted">{p.is_sample ? 'Sample policy' : 'Configured policy'}</Text></View>)}<Button label="Create policy version" icon={Plus} variant="secondary" fullWidth onPress={() => { const active = policies.data?.find((p) => p.is_active); setLabel(''); setRules(JSON.stringify(active?.rules ?? {}, null, 2)); setError(null); setNewPolicy(true); }} /></Section>
    <Sheet visible={editing !== null} onClose={() => setEditing(null)} title={`Edit ${editing?.key ?? ''}`} footer={<Button label="Save version" fullWidth loading={busy} onPress={save} />}><View style={styles.form}><Text variant="footnote" tone="muted">Use valid JSON. Existing bookings keep their snapshotted price, commission, terms and cancellation policy.</Text><TextField label="Value (JSON)" value={value} onChangeText={setValue} multiline maxLength={5000} /><TextField label="Description" value={description} onChangeText={setDescription} multiline maxLength={500} />{error ? <Banner tone="danger" title="Not saved" message={error} /> : null}</View></Sheet>
    <Sheet visible={newPolicy} onClose={() => setNewPolicy(false)} title="Create cancellation policy version" description="This activates a new policy for future bookings only." footer={<Button label="Create and activate" fullWidth loading={busy} onPress={createPolicy} />}><View style={styles.form}><TextField label="Policy label" value={label} onChangeText={setLabel} maxLength={160} /><TextField label="Rules (JSON)" value={rules} onChangeText={setRules} multiline maxLength={12000} />{error ? <Banner tone="danger" title="Not saved" message={error} /> : null}</View></Sheet>
  </View></Screen>;
}
const styles = StyleSheet.create({ body: { gap: spacing.lg }, card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs }, form: { gap: spacing.md } });
