import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BarChart3, CalendarRange, Megaphone, Sparkles } from 'lucide-react-native';
import { Banner, Button, Dialog, ErrorState, LoadingRows, Screen, ScreenHeader, StatusPill, Text, useToast } from '@/components/design-system';
import { Group, Section, StatRow } from '@/components/shared/Layout';
import { formatDateTimeManila } from '@/lib/format';
import { formatPeso } from '@/lib/money';
import { useAsync } from '@/lib/use-async';
import { premiumRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/** TigRent Premium is a clearly-labelled PHP 99/month simulated subscription (plan §2.10, Phase 12). */
export default function PremiumScreen() {
  const toast = useToast();
  const info = useAsync(() => premiumRepository.mine(), []);
  const analytics = useAsync(() => info.data?.isActive ? premiumRepository.analytics() : Promise.resolve({ ok: true as const, data: null }), [info.data?.isActive]);
  const [scenario, setScenario] = useState<'success' | 'failure'>('success');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const subscribe = async () => { const key = `premium-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; setBusy(true); const r = await premiumRepository.subscribe(key, scenario); setBusy(false); setConfirm(false); if (!r.ok) return toast.show({ title: 'Checkout unavailable', message: r.error.message, tone: 'danger' }); toast.show({ title: scenario === 'success' ? 'Premium unlocked' : 'Demo payment failed', message: scenario === 'success' ? 'No real money moved.' : 'Try the simulated checkout again.', tone: scenario === 'success' ? 'success' : 'warning' }); void info.reload(); };
  const cancel = async () => { setBusy(true); const r = await premiumRepository.cancel(); setBusy(false); if (!r.ok) return toast.show({ title: 'Couldn’t cancel', message: r.error.message, tone: 'danger' }); toast.show({ title: 'Premium cancelled', message: 'Demo Premium tools are now locked. Your data remains.', tone: 'neutral' }); void info.reload(); };
  const p = info.data;
  return <Screen><ScreenHeader title="TigRent Premium" eyebrow="For lenders" size="compact" back /><View style={styles.body}>
    <Banner tone="info" title="Demo subscription" message="PHP 99/month is simulated. No card, e-wallet, bank details, recurring charge, or real money movement is involved." />
    {info.error ? <ErrorState message={info.error.message} onRetry={info.reload} /> : !p ? <LoadingRows rows={3} /> : <>
      <View style={styles.hero}><Sparkles color={colors.primary} size={28} /><View style={styles.flex}><Text variant="headline">Premium · {formatPeso(p.price, { showCentavos: 'always' })}/month</Text><Text variant="footnote" tone="muted">Featured listings, analytics, advanced calendar and promotional tools.</Text></View><StatusPill label={p.isActive ? 'Active (demo)' : p.status.replace('_', ' ')} tone={p.isActive ? 'success' : 'neutral'} /></View>
      {p.isActive ? <Text variant="footnote" tone="muted">Active until {p.periodEnd ? formatDateTimeManila(p.periodEnd) : '—'}. Cancelling locks premium-only controls without deleting history.</Text> : <><Section title="Choose demo outcome"><Group><Button label="Simulate success" variant={scenario === 'success' ? 'primary' : 'secondary'} onPress={() => setScenario('success')} /><Button label="Simulate failure" variant={scenario === 'failure' ? 'danger' : 'secondary'} onPress={() => setScenario('failure')} /></Group></Section><Button label={`Subscribe for ${formatPeso(p.price)} (demo)`} fullWidth onPress={() => setConfirm(true)} /></>}
      <Section title="What unlocks"><Group><Text variant="callout"><Megaphone size={16} /> Featured listing placement and promotional controls</Text><Text variant="callout"><BarChart3 size={16} /> Ledger-backed simulated earnings analytics</Text><Text variant="callout"><CalendarRange size={16} /> Advanced booking-calendar entitlement</Text></Group></Section>
      {p.isActive ? <><Section title="Premium analytics">{analytics.data ? <StatRow stats={[{ label: 'Completed', value: analytics.data.completedRentals }, { label: 'Active listings', value: analytics.data.activeListings }, { label: 'Featured', value: analytics.data.featuredListings }]} /> : <LoadingRows rows={1} />}<Text variant="footnote" tone="muted">Estimated net {analytics.data ? formatPeso(analytics.data.estimatedNet, { showCentavos: 'always' }) : '—'} · simulated, deposits excluded.</Text></Section><Button label="Cancel Premium" variant="secondary" fullWidth loading={busy} onPress={cancel} /></> : null}
    </>}</View><Dialog visible={confirm} title="Simulate Premium checkout?" message="This is a demo transaction. No payment details are requested and no money moves." confirmLabel={scenario === 'success' ? 'Simulate success' : 'Simulate failure'} loading={busy} onConfirm={subscribe} onCancel={() => setConfirm(false)} /></Screen>;
}
const styles = StyleSheet.create({ body: { gap: spacing.lg }, hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, padding: spacing.lg, borderRadius: radii.lg }, flex: { flex: 1 } });
