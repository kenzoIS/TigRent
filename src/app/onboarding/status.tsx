import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { LogOut, RefreshCw } from 'lucide-react-native';
import { Banner, Button, ErrorState, ListRow, LoadingRows, Screen, ScreenHeader, StatusPill, Text, type Tone } from '@/components/design-system';
import type { VerificationStatus } from '@/domain/entities';
import { Tiggy } from '@/components/mascot/Tiggy';
import { useSession } from '@/features/auth/session';
import { formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { studentVerificationProvider } from '@/providers/student-verification/manual-demo';
import { verificationRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const COPY: Record<VerificationStatus, { title: string; body: string; tone: Tone; tip: string }> = {
  not_submitted: {
    title: 'Not submitted yet',
    body: 'Submit your details and registration form to start.',
    tone: 'neutral',
    tip: 'Submit your student registration form to start borrowing and lending gear on campus!',
  },
  pending_review: {
    title: 'Waiting for review',
    body: 'A TigRent reviewer will check your details. You can’t rent or lend until you’re verified.',
    tone: 'warning',
    tip: 'Your verification is waiting for review. I’ll let you know when there’s a decision.',
  },
  verified: {
    title: 'You’re verified',
    body: 'Your student status was approved for this academic year.',
    tone: 'success',
    tip: 'You’re officially verified! Enjoy renting and lending gear safely across UST Manila.',
  },
  rejected: {
    title: 'Not approved',
    body: 'Your submission wasn’t approved. Read the reason, then submit again with the right document.',
    tone: 'danger',
    tip: 'Check the reviewer’s reason, then resubmit with your current registration form.',
  },
  needs_resubmission: {
    title: 'Resubmission needed',
    body: 'The reviewer needs something changed before approving you.',
    tone: 'warning',
    tip: 'The reviewer asked for a change. Fix it and resubmit.',
  },
  expired: {
    title: 'Renewal needed',
    body: 'Your verification expired with the academic year. Submit your current registration form to keep using TigRent.',
    tone: 'warning',
    tip: 'A new academic year started. Renew with your current registration form.',
  },
};

/** Verification status + review history (plan §2.2, Journey A.5/A.9). */
export default function VerificationStatusScreen() {
  const { context, refresh, signOut } = useSession();
  const userId = context?.userId ?? '';
  const history = useAsync(() => verificationRepository.listMine(userId), [userId]);
  if (!context) return null;
  const status = context.verificationStatus;
  const copy = COPY[status];
  const latest = history.data?.[0];
  const canResubmit = status === 'rejected' || status === 'needs_resubmission' || status === 'expired' || status === 'not_submitted';

  const checkAgain = async () => {
    await Promise.all([refresh(), history.reload()]);
  };

  return (
    <Screen
      footer={
        <>
          {status === 'verified' ? (
            <Button label="Start using TigRent" onPress={() => router.replace('/')} fullWidth />
          ) : canResubmit ? (
            <Button label={status === 'expired' ? 'Renew verification' : 'Submit again'} onPress={() => router.push('/onboarding/verification')} fullWidth testID="status-resubmit" />
          ) : (
            <Button label="Check for updates" variant="secondary" icon={RefreshCw} onPress={checkAgain} fullWidth testID="status-refresh" />
          )}
          <Button label="Sign out" variant="ghost" icon={LogOut} onPress={() => void signOut()} fullWidth />
        </>
      }
    >
      <ScreenHeader title="Verification status" />
      <View style={styles.body}>
        <View style={styles.mascotHero}>
          <Tiggy size="xl" wave message={copy.tip} />
        </View>
        <View style={styles.card}>
          <StatusPill label={copy.title} tone={copy.tone} />
          <Text variant="callout">{copy.body}</Text>
          {latest?.reviewReason && (status === 'rejected' || status === 'needs_resubmission') ? (
            <Banner tone={status === 'rejected' ? 'danger' : 'warning'} title="Reviewer’s reason" message={latest.reviewReason} />
          ) : null}
          {status === 'verified' && latest?.expiresAt ? (
            <Text variant="footnote" tone="muted">Valid until {formatDateTimeManila(latest.expiresAt)}.</Text>
          ) : null}
        </View>

        {history.error ? (
          <ErrorState offline={history.error.kind === 'network'} message={history.error.message} onRetry={history.reload} />
        ) : !history.data ? (
          <LoadingRows rows={2} label="Loading history" />
        ) : history.data.length > 0 ? (
          <View style={styles.section}>
            <Text variant="overline" tone="muted" uppercase>Submissions</Text>
            <View style={styles.list}>
              {history.data.map((v) => (
                <ListRow
                  key={v.id}
                  title={`${v.academicYearLabel} · ${COPY[v.status].title}`}
                  subtitle={[
                    `Submitted ${formatDateTimeManila(v.submittedAt)}`,
                    v.reviewedAt ? `Reviewed ${formatDateTimeManila(v.reviewedAt)}` : null,
                    v.provider === 'manual_demo' ? studentVerificationProvider.label : v.provider,
                  ].filter(Boolean).join('\n')}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  mascotHero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  section: { gap: spacing.sm },
  list: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
});
