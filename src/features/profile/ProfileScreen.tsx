import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  Award,
  Bell,
  BookOpen,
  Check,
  LogOut,
  Pencil,
  Settings,
  ShieldCheck,
  ShieldExclamationPoint,
  Star,
  Store,
  UserCheck,
  X,
} from 'lucide-react-native';
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
import { colors, elevation, radii, spacing } from '@/theme';

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
    router.navigate(role === 'lender' ? '/lender/profile' : '/borrower/profile');
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
      <ScreenHeader
        title="Profile"
        eyebrow={area === 'lender' ? 'Lending Mode' : 'Borrowing Mode'}
        right={
          <Pressable
            onPress={() => router.navigate('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings and preferences"
            hitSlop={8}
            style={styles.settingsHeaderBtn}
          >
            <Icon as={Settings} size={20} color={colors.textMuted} />
          </Pressable>
        }
      />
      <View style={styles.body}>
        {/* Student Identity Hero Card (Unified, Non-Redundant, In-Place Editing) */}
        <View style={[styles.studentHeroCard, elevation.low]}>
          <View style={styles.avatarRing}>
            <Text style={styles.avatarText}>
              {(context.fullName || 'Student')
                .split(' ')
                .map((n) => n[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </Text>
          </View>
          <View style={styles.studentInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.studentName} numberOfLines={1}>
                {context.fullName || 'UST Student'}
              </Text>
              <Pressable
                onPress={() => {
                  setName(context.fullName);
                  setNameError(null);
                  setEditing(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit full name"
                hitSlop={8}
                style={styles.editPencilBtn}
              >
                <Icon as={Pencil} size={14} color={colors.primaryPressed} />
              </Pressable>
            </View>
            <Text style={styles.studentEmail} numberOfLines={1}>
              {email ?? 'UST Manila Verified Account'}
            </Text>
            <View style={styles.pills}>
              <Pressable
                onPress={() => router.navigate('/onboarding/status')}
                accessibilityRole="button"
                accessibilityLabel={`Verification status: ${v.label}. Tap to view details.`}
              >
                <StatusPill label={v.label} tone={v.tone} icon={verified ? ShieldCheck : undefined} />
              </Pressable>
              {s?.badges.some((b) => b.code === 'trusted_lender') ? (
                <StatusPill label="Verified Trusted Lender" tone="success" icon={Award} />
              ) : null}
            </View>
          </View>
        </View>

        {/* Role Switcher */}
        <RoleSwitcher current={area} screen="profile" />

        {/* Unlock Missing Role Card (Only displayed if role is missing — replaces redundant static list) */}
        {missingRole ? (
          <View style={[styles.unlockRoleCard, elevation.low]}>
            <View style={styles.unlockRoleHeader}>
              <View style={styles.unlockRoleIcon}>
                <Icon as={missingRole === 'lender' ? Store : UserCheck} size={18} color={colors.primaryPressed} />
              </View>
              <View style={styles.unlockRoleContent}>
                <Text style={styles.unlockRoleTitle}>
                  {missingRole === 'lender' ? 'Unlock Lending on Campus' : 'Unlock Borrowing on Campus'}
                </Text>
                <Text style={styles.unlockRoleSubtitle}>
                  {missingRole === 'lender'
                    ? 'Earn extra allowance by listing your calculators, cameras & gear.'
                    : 'Rent items from verified UST students for your classes & projects.'}
                </Text>
              </View>
            </View>
            {enableError ? (
              <Banner tone="danger" title="Couldn’t enable role" message={enableError} onDismiss={() => setEnableError(null)} />
            ) : null}
            <Button
              label={missingRole === 'lender' ? 'Start lending too' : 'Start borrowing too'}
              variant="tonal"
              onPress={() => setEnabling(missingRole)}
              disabled={!verified || restricted}
              disabledReason={
                !verified
                  ? 'Available once your student verification is approved.'
                  : restricted
                  ? 'New roles can’t be enabled while your account is under review.'
                  : undefined
              }
              testID="enable-role"
            />
          </View>
        ) : null}

        {restricted ? (
          <Banner
            tone="warning"
            title="Your account is under review"
            message="New rentals and listings are paused. Existing rentals and support remain available."
            action={{ label: 'View details', onPress: () => router.navigate('/restricted') }}
          />
        ) : null}

        {/* Reputation & History Bento */}
        {summary.error ? (
          <ErrorState offline={summary.error.kind === 'network'} message={summary.error.message} onRetry={reload} />
        ) : !s ? (
          <LoadingRows rows={2} label="Loading reputation" />
        ) : (
          <>
            <Section title="Reputation & badges" action={{ label: 'About badges', onPress: () => setBadgeInfo(true) }}>
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

        {/* Activity & Feedback */}
        <Section title="Activity & feedback">
          <Group>
            <ListRow
              icon={Star}
              title="My reviews"
              subtitle="Ratings you received and rentals to rate"
              onPress={() => router.navigate('/reviews')}
              testID="my-reviews"
            />
            <ListRow
              icon={Bell}
              title="Notifications"
              subtitle={unread > 0 ? `${unread} unread updates` : 'All caught up'}
              value={unread > 0 ? `${unread} unread` : undefined}
              onPress={() => router.navigate('/notifications')}
            />
          </Group>
        </Section>

        {/* Support & Preferences */}
        <Section title="Support & policies">
          <Group>
            <ListRow
              icon={Settings}
              title="Settings & help"
              subtitle="Display preferences, FAQs & student support"
              onPress={() => router.navigate('/settings')}
            />
            <ListRow
              icon={BookOpen}
              title="Terms & policies"
              subtitle="Community rules & rental agreements"
              onPress={() => router.navigate('/policies')}
            />
            {restricted ? (
              <ListRow
                icon={ShieldExclamationPoint}
                title="Account status"
                subtitle="Account under review"
                onPress={() => router.navigate('/restricted')}
              />
            ) : null}
          </Group>
        </Section>

        <Button
          label="Sign out"
          variant="secondary"
          icon={LogOut}
          onPress={() => setConfirmOut(true)}
          testID="account-sign-out"
          style={styles.signOut}
        />
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
      <Sheet visible={editing} onClose={() => setEditing(false)} title="Edit full name" footer={<Button label="Save" onPress={saveName} loading={savingName} fullWidth />}>
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
  settingsHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  studentHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primarySoft,
    borderWidth: 2.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.ink,
  },
  studentInfo: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  studentName: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  editPencilBtn: {
    padding: 3,
    borderRadius: 4,
  },
  studentEmail: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: 4,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unlockRoleCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primarySoft,
  },
  unlockRoleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  unlockRoleIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockRoleContent: {
    flex: 1,
    gap: 2,
  },
  unlockRoleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  unlockRoleSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },
  signOut: { marginTop: spacing.md },
  criterion: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  sheetBody: { gap: spacing.sm },
  mt: { marginTop: spacing.md },
});


