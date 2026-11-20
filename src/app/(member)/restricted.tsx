import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarClock, LifeBuoy, LogOut, MessageCircle, MessageSquareText, ShieldExclamationPoint } from 'lucide-react-native';
import { Banner, Button, Icon, ListRow, LoadingRows, Screen, ScreenHeader, Sheet, StatusPill, Text, TextField, useToast } from '@/components/design-system';
import { Section } from '@/components/shared/Layout';
import { ACCOUNT_STATUS_LABEL, APPEAL_STATUS_LABEL, canAppeal, ruleSentence } from '@/domain/trust';
import { useSession } from '@/features/auth/session';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { trustRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const TITLES = {
  active: 'Your account is in good standing',
  paused_pending_review: 'Your account is paused for review',
  restricted: 'Your account is restricted',
  suspended: 'Your account is suspended',
} as const;

/**
 * Account status, reason, the (sample) rule, history and the appeal (plan §2.9, Phase 11). New marketplace
 * actions are blocked server-side; existing rentals, their messages, support and the appeal stay available.
 */
export default function Restricted() {
  const { context, signOut, refresh } = useSession();
  const toast = useToast();
  const health = useAsync(() => trustRepository.myAccountHealth(), [context?.userId]);
  const h = health.data;
  const status = h?.accountStatus ?? context?.accountStatus ?? 'active';
  const roles = context?.roles ?? [];
  const rentalsHref = roles.includes('borrower') ? '/borrower/rentals' : roles.includes('lender') ? '/lender' : null;
  const messagesHref = roles.includes('borrower') ? '/borrower/messages' : roles.includes('lender') ? '/lender/messages' : null;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const appealOpen = h ? canAppeal(status, h.appeal) : false;
  const needsInfo = h?.appeal?.status === 'needs_info';

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await trustRepository.submitAppeal(reason);
    setBusy(false);
    if (!r.ok) return setError(r.error.message);
    setOpen(false);
    setReason('');
    toast.show({ title: needsInfo ? 'Information sent' : 'Appeal sent', message: 'A moderator will review it.', tone: 'success' });
    void health.reload();
  };

  return (
    <Screen refreshing={health.loading && Boolean(h)} onRefresh={() => { void health.reload(); void refresh(); }}>
      <ScreenHeader title={TITLES[status]} size="large" />
      <View style={styles.body}>
        <View style={styles.headRow}>
          <View style={styles.icon}>
            <Icon as={ShieldExclamationPoint} size="xl" color={status === 'active' ? colors.success : colors.warning} />
          </View>
          <StatusPill label={ACCOUNT_STATUS_LABEL[status].label} tone={ACCOUNT_STATUS_LABEL[status].tone} />
        </View>
        {(h?.statusReason ?? context?.statusReason) && status !== 'active' ? <Banner tone="warning" title="Reason" message={(h?.statusReason ?? context?.statusReason)!} /> : null}
        {status !== 'active' ? (
          <Text variant="callout" tone="muted">
            While your account is under review you can’t send new booking requests or publish new listings, and your listings are hidden from search. Your existing rentals, messages about them, returns and support remain available{h && h.openObligations > 0 ? ` (${h.openObligations} open rental${h.openObligations === 1 ? '' : 's'})` : ''}.
          </Text>
        ) : (
          <>
            <Text variant="callout" tone="muted">You can rent and list as usual.</Text>
            <Button label="Go to your dashboard" onPress={() => { void refresh().then(() => router.replace('/')); }} testID="back-to-dashboard" />
          </>
        )}

        {!h ? (
          health.error ? <Banner tone="danger" title="Couldn’t load your account health" message={health.error.message} /> : <LoadingRows rows={2} label="Loading account health" />
        ) : (
          <>
            <Section title="Account health">
              <View style={styles.card} testID="account-health">
                <Text variant="bodyStrong">
                  {h.metrics.reviewCount} rating{h.metrics.reviewCount === 1 ? '' : 's'} received{h.metrics.avgRating !== null ? ` · average ${h.metrics.avgRating.toFixed(2)} / 5` : ''}
                </Text>
                <Text variant="footnote" tone="muted">{ruleSentence(h.metrics.rule, h.metrics.ruleIsSample)}</Text>
                {status !== 'active' && !h.metrics.ruleMet ? (
                  <Text variant="footnote" tone="muted">The rule is no longer met (for example after a moderator hid a review); a moderator still confirms before restoring your account.</Text>
                ) : null}
              </View>
            </Section>

            <Section title="Appeal">
              <View style={styles.card} testID="appeal-card">
                {h.appeal ? (
                  <>
                    <StatusPill label={APPEAL_STATUS_LABEL[h.appeal.status].label} tone={APPEAL_STATUS_LABEL[h.appeal.status].tone} />
                    <Text variant="caption" tone="muted">Sent {formatDateTimeManila(h.appeal.createdAt)}</Text>
                    {h.appeal.moderatorNote ? <Text variant="callout">Moderator: “{h.appeal.moderatorNote}”</Text> : null}
                  </>
                ) : (
                  <Text variant="callout" tone="muted">{status === 'active' ? 'Nothing to appeal.' : 'No appeal yet. A moderator reviews your explanation and can lift the restriction.'}</Text>
                )}
                {appealOpen ? (
                  <Button
                    label={needsInfo ? 'Send the requested information' : 'Appeal this decision'}
                    icon={MessageSquareText}
                    fullWidth
                    onPress={() => { setError(null); setOpen(true); }}
                    testID="open-appeal"
                  />
                ) : null}
              </View>
            </Section>

            {h.history.length > 0 ? (
              <Section title="History">
                <View style={styles.card}>
                  {h.history.map((e, i) => (
                    <View key={`${e.at}-${i}`} style={styles.event}>
                      <Text variant="bodyStrong">{ACCOUNT_STATUS_LABEL[e.to].label}{e.automatic ? ' (automatic)' : ' (moderator)'}</Text>
                      <Text variant="footnote" tone="muted">{e.reason}</Text>
                      <Text variant="caption" tone="muted">{formatDateTimeManila(e.at)}</Text>
                    </View>
                  ))}
                </View>
              </Section>
            ) : null}
          </>
        )}

        <View style={styles.links}>
          {rentalsHref ? <ListRow title="My existing rentals" subtitle="Active rentals and their obligations stay available" icon={CalendarClock} onPress={() => router.navigate(rentalsHref)} /> : null}
          {messagesHref ? <ListRow title="Messages" subtitle="Keep arranging returns with the other party" icon={MessageCircle} onPress={() => router.navigate(messagesHref)} /> : null}
          <ListRow title="Help & support" icon={LifeBuoy} onPress={() => router.navigate('/settings')} />
        </View>
        <Button label="Sign out" variant="secondary" icon={LogOut} onPress={() => void signOut()} />
      </View>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={needsInfo ? 'Send more information' : 'Appeal'}
        description={needsInfo ? 'The moderator asked for more information. It’s added to your appeal.' : 'Explain what happened. A TigRent moderator reviews it and decides; you’ll get a notification.'}
        footer={<Button label="Send" fullWidth loading={busy} onPress={submit} testID="submit-appeal" />}
      >
        <View style={styles.sheet}>
          <TextField label="Your explanation" value={reason} onChangeText={setReason} multiline maxLength={2000} testID="appeal-text" />
          {error ? <Banner tone="danger" title="Not sent" message={error} /> : null}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 64, height: 64, borderRadius: radii.md, backgroundColor: colors.warningSoft, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  event: { gap: 2, paddingVertical: spacing.xs },
  links: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  sheet: { gap: spacing.md },
});
