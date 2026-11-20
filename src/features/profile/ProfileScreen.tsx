import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Award, Bell, BookOpen, Check, LogOut, Pencil, Settings, ShieldCheck, ShieldExclamationPoint, Star, Store, User, X } from 'lucide-react-native';
import {
  Banner,
  Button,
  Dialog,
  ErrorState,
  Icon,
  ListRow,
  LoadingRows,
  Screen,
  ScreenHeader,
  Sheet,
  StatusPill,
  Text,
  TextField,
  useToast,
  type Tone,
} from '@/components/design-system';
import { Group, Section, StatRow } from '@/components/shared/Layout';
import type { MarketplaceRole, ProfileSummary, VerificationStatus } from '@/domain/entities';
import { RoleSwitcher } from '@/features/auth/RoleSwitcher';
import { useSession } from '@/features/auth/session';
import { fullNameSchema } from '@/features/auth/validation';
import { useAsync } from '@/lib/use-async';
import { notificationInboxRepository, profilesRepository, profileSummaryRepository, sessionRepository } from '@/repositories';
import { colors, spacing } from '@/theme';

const VERIFICATION: Record<VerificationStatus, { label: string; tone: Tone }> = {
  verified: { label: 'Student verified', tone: 'success' },
  pending_review: { label: 'Verification pending', tone: 'warning' },
  not_submitted: { label: 'Not verified', tone: 'neutral' },
  rejected: { label: 'Verification rejected', tone: 'danger' },
  needs_resubmission: { label: 'Resubmission needed', tone: 'warning' },
  expired: { label: 'Verification expired', tone: 'warning' },
};

const stars = (avg: number | null, count: number) => (avg === null || count === 0 ? '–' : `★ ${avg.toFixed(1)}`);

/** Profile (plan §4.1, Phase 5): verification, ratings, badges, enabled roles, account status. */
export function ProfileScreen({ area }: { area: MarketplaceRole }) {
  const { context, email, signOut, applyContext, refresh } = useSession();
  const toast = useToast();
  const summary = useAsync(() => profileSummaryRepository.get(), [context?.userId]);
  const [unread, setUnread] = useState(0);
  const [badgeInfo, setBadgeInfo] = useState(false);
  const [enabling, setEnabling] = useState<MarketplaceRole | null>(null);
  const [enableBusy, setEnableBusy] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);

  const { reload } = summary;
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void reload();
      notificationInboxRepository.unreadCount().then((r) => active && r.ok && setUnread(r.data));
      return () => {
        active = false;
      };
    }, [reload]),
  );

  if (!context) return null;
  const v = VERIFICATION[context.verificationStatus];
  const restricted = context.accountStatus !== 'active';
  const verified = context.verificationStatus === 'verified';
  const missingRole: MarketplaceRole | null = !context.roles.includes('lender') ? 'lender' : !context.roles.includes('borrower') ? 'borrower' : null;
  const s = summary.data;

  const enableRole = async () => {
    if (!enabling) return;
    setEnableBusy(true);
    setEnableError(null);
    const r = await sessionRepository.enableRole(enabling);
    setEnableBusy(false);
    if (!r.ok) {
      setEnableError(r.error.message);
      setEnabling(null);
      return;
    }
    const role = enabling;
    applyContext(r.data);
    setEnabling(null);
    toast.show({ title: role === 'lender' ? 'Lending enabled' : 'Borrowing enabled', message: 'Use the switcher to move between borrowing and lending.', tone: 'success' });
    router.navigate(role === 'lender' ? '/lender' : '/borrower');
  };

  const saveName = async () => {
    const parsed = fullNameSchema.safeParse(name);
    if (!parsed.success) return setNameError(parsed.error.issues[0]?.message ?? 'Enter your full name.');
    setSavingName(true);
    const r = await profilesRepository.updateMine(context.userId, { fullName: parsed.data });
    setSavingName(false);
    if (!r.ok) return setNameError(r.error.message);
    setEditing(false);
    await refresh();
    void reload();
    toast.show({ title: 'Name updated', tone: 'success' });
  };

  return (
    <Screen withTabBar refreshing={summary.loading && Boolean(s)} onRefresh={reload}>
      <ScreenHeader title={context.fullName || 'Your profile'} eyebrow={area === 'lender' ? 'Lending' : 'Borrowing'} subtitle={email ?? undefined} />
      <View style={styles.body}>
        <RoleSwitcher current={area} />

        <View style={styles.pills}>
          <StatusPill label={v.label} tone={v.tone} icon={verified ? ShieldCheck : undefined} />
          {s?.badges.some((b) => b.code === 'trusted_lender') ? <StatusPill label="Verified Trusted Lender" tone="success" icon={Award} /> : null}
          {context.roles.filter((r) => r === 'borrower' || r === 'lender').map((r) => (
            <StatusPill key={r} label={r === 'borrower' ? 'Borrower' : 'Lender'} />
          ))}
        </View>

        {restricted ? (
          <Banner
            tone="warning"
            title="Your account is under review"
            message="New rentals and listings are paused. Existing rentals and support remain available."
            action={{ label: 'View details', onPress: () => router.navigate('/restricted') }}
          />
        ) : null}

        {summary.error ? (
          <ErrorState offline={summary.error.kind === 'network'} message={summary.error.message} onRetry={reload} />
        ) : !s ? (
          <LoadingRows rows={2} label="Loading profile" />
        ) : (
          <>
            <Section title="Ratings & history" action={{ label: 'About badges', onPress: () => setBadgeInfo(true) }}>
              <StatRow
                stats={[
                  { label: `As lender (${s.lenderRating.count})`, value: stars(s.lenderRating.avg, s.lenderRating.count) },
                  { label: `As borrower (${s.borrowerRating.count})`, value: stars(s.borrowerRating.avg, s.borrowerRating.count) },
                  { label: 'Completed rentals', value: s.completedLendings + s.completedBorrowings },
                ]}
              />
            </Section>
            <BadgeSheet visible={badgeInfo} onClose={() => setBadgeInfo(false)} summary={s} />
          </>
        )}

        <Section title="Roles">
          <Group>
            <ListRow icon={User} title="Borrowing" subtitle="Rent equipment from other students" trailing={<RoleState on={context.roles.includes('borrower')} />} />
            <ListRow icon={Store} title="Lending" subtitle="List your equipment and set your own rates" trailing={<RoleState on={context.roles.includes('lender')} />} />
          </Group>
          {enableError ? <Banner tone="danger" title="Couldn’t enable the role" message={enableError} onDismiss={() => setEnableError(null)} /> : null}
          {missingRole ? (
            <Button
              label={missingRole === 'lender' ? 'Start lending too' : 'Start borrowing too'}
              variant="tonal"
              onPress={() => setEnabling(missingRole)}
              disabled={!verified || restricted}
              disabledReason={!verified ? 'Available once your student verification is approved.' : restricted ? 'New roles can’t be enabled while your account is under review.' : undefined}
              testID="enable-role"
            />
          ) : null}
        </Section>

        <Section title="Account">
          <Group>
            <ListRow icon={Pencil} title="Edit name" value={context.fullName} onPress={() => { setName(context.fullName); setNameError(null); setEditing(true); }} />
            <ListRow icon={ShieldCheck} title="Verification status" value={v.label} onPress={() => router.navigate('/onboarding/status')} />
            <ListRow icon={Star} title="My reviews" subtitle="Ratings you received and rentals to rate" onPress={() => router.navigate('/reviews')} testID="my-reviews" />
            {restricted ? <ListRow icon={ShieldExclamationPoint} title="Account status" onPress={() => router.navigate('/restricted')} /> : null}
            <ListRow icon={Bell} title="Notifications" value={unread > 0 ? `${unread} unread` : undefined} onPress={() => router.navigate('/notifications')} />
            <ListRow icon={Settings} title="Settings & help" onPress={() => router.navigate('/settings')} />
            <ListRow icon={BookOpen} title="Terms & policies" onPress={() => router.navigate('/policies')} />
          </Group>
        </Section>

        <Button label="Sign out" variant="secondary" icon={LogOut} onPress={() => setConfirmOut(true)} testID="account-sign-out" style={styles.signOut} />
      </View>

      <Dialog
        visible={enabling !== null}
        title={enabling === 'lender' ? 'Start lending?' : 'Start borrowing?'}
        message={
          enabling === 'lender'
            ? 'You’ll be able to list equipment, set daily rates and deposits, and accept requests, using this same account and verification.'
            : 'You’ll be able to request equipment from other verified students, using this same account and verification.'
        }
        confirmLabel="Enable"
        loading={enableBusy}
        onConfirm={enableRole}
        onCancel={() => setEnabling(null)}
        testID="enable-role-dialog"
      />
      <Sheet visible={editing} onClose={() => setEditing(false)} title="Edit name" footer={<Button label="Save" onPress={saveName} loading={savingName} fullWidth />}>
        <TextField label="Full name" value={name} onChangeText={setName} error={nameError} autoComplete="name" />
      </Sheet>
      <Dialog
        visible={confirmOut}
        title="Sign out?"
        message="You’ll need your email and password to sign in again."
        confirmLabel="Sign out"
        onCancel={() => setConfirmOut(false)}
        onConfirm={async () => {
          setConfirmOut(false);
          await signOut();
        }}
      />
    </Screen>
  );
}

function RoleState({ on }: { on: boolean }) {
  return <StatusPill label={on ? 'On' : 'Off'} tone={on ? 'success' : 'neutral'} />;
}

function Criterion({ ok: met, label }: { ok: boolean; label: string }) {
  return (
    <View style={styles.criterion} accessible accessibilityLabel={`${met ? 'Met' : 'Not yet met'}: ${label}`}>
      <Icon as={met ? Check : X} size="sm" color={met ? colors.success : colors.textFaint} />
      <Text variant="callout" style={styles.flex}>{label}</Text>
    </View>
  );
}

/** Explains both badges and the configured criteria, with honest progress (plan §2.9). */
function BadgeSheet({ visible, onClose, summary: s }: { visible: boolean; onClose: () => void; summary: ProfileSummary }) {
  const t = s.trustedLender;
  return (
    <Sheet visible={visible} onClose={onClose} title="About TigRent badges" description="Badges mean TigRent prototype criteria were met. They are not an official UST endorsement.">
      <View style={styles.sheetBody}>
        <Text variant="headline">Student verified</Text>
        <Text variant="callout" tone="muted">A TigRent reviewer approved this member’s student details and registration form for the current academic year (manual demo review).</Text>
        <Text variant="headline" style={styles.mt}>Verified Trusted Lender</Text>
        {t.ruleIsSample ? <StatusPill label="Sample criteria" tone="warning" /> : null}
        <Criterion ok={t.progress.studentVerified} label="Student verified" />
        <Criterion ok={t.progress.accountInGoodStanding} label="Account in good standing" />
        <Criterion ok={t.progress.completedLendings >= t.rule.minCompletedLendings} label={`At least ${t.rule.minCompletedLendings} completed lendings (you have ${t.progress.completedLendings})`} />
        <Criterion
          ok={(t.progress.avgRating ?? 0) >= t.rule.minAvgRating}
          label={`Average lender rating of ${t.rule.minAvgRating.toFixed(1)} or higher (yours: ${t.progress.avgRating === null ? 'no ratings yet' : t.progress.avgRating.toFixed(2)})`}
        />
        {t.rule.noUnresolvedSevereDisputes ? <Criterion ok={t.progress.unresolvedSevereDisputes === 0} label="No unresolved severe disputes" /> : null}
        <Banner tone={t.earned ? 'success' : 'neutral'} title={t.earned ? 'You hold this badge' : 'Not earned yet'} message="Badges update automatically as rentals complete and reviews arrive." />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  signOut: { marginTop: spacing.xl },
  criterion: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  sheetBody: { gap: spacing.sm },
  mt: { marginTop: spacing.md },
});

