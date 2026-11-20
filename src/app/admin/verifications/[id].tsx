import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Check, ExternalLink, FileText, RotateCcw, X } from 'lucide-react-native';
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
} from '@/components/design-system';
import { useSession } from '@/features/auth/session';
import { ok } from '@/lib/errors';
import { formatBytes, formatDateTimeManila } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { signedUrlFor } from '@/providers/storage/private-upload';
import { verificationRepository, type ReviewDecision } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

const SIGNED_URL_TTL = 300;

/** Staff review of one submission with private, short-lived document access (plan §2.2, §6.5). */
export default function ReviewVerification() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { context } = useSession();
  const toast = useToast();
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const item = useAsync(async () => {
    const r = await verificationRepository.getById(id);
    if (!r.ok || !r.data) return r.ok ? ok(null) : r;
    const url = r.data.documentPath ? await signedUrlFor('verification-docs', r.data.documentPath, SIGNED_URL_TTL) : null;
    return ok({ v: r.data, url: url?.ok ? url.data : null, urlError: url && !url.ok ? url.error.message : null });
  }, [id]);

  const decide = async () => {
    if (!decision) return;
    if (decision !== 'approve' && reason.trim().length < 10) {
      setReasonError('Explain what the student should fix (at least 10 characters).');
      return;
    }
    setBusy(true);
    setActionError(null);
    const r = await verificationRepository.review(id, decision, decision === 'approve' ? undefined : reason.trim());
    setBusy(false);
    if (!r.ok) {
      setDecision(null);
      setActionError(r.error.message);
      return;
    }
    setDecision(null);
    toast.show({
      title: decision === 'approve' ? 'Student verified' : decision === 'reject' ? 'Submission rejected' : 'Sent back for resubmission',
      message: 'The student was notified.',
      tone: decision === 'approve' ? 'success' : 'neutral',
    });
    router.back();
  };

  if (item.error) {
    return (
      <Screen>
        <ScreenHeader title="Review" size="compact" back />
        <ErrorState offline={item.error.kind === 'network'} message={item.error.message} onRetry={item.reload} />
      </Screen>
    );
  }
  if (!item.data) {
    return (
      <Screen>
        <ScreenHeader title="Review" size="compact" back />
        {item.loading ? <LoadingRows rows={4} label="Loading submission" /> : <Banner tone="warning" title="This submission no longer exists." />}
      </Screen>
    );
  }

  const { v, url, urlError } = item.data;
  const isPending = v.status === 'pending_review';
  const own = v.userId === context?.userId;

  return (
    <Screen
      footer={
        isPending && !own ? (
          <>
            <Button label="Approve" icon={Check} onPress={() => setDecision('approve')} fullWidth testID="review-approve" />
            <View style={styles.row}>
              <Button label="Request changes" variant="secondary" icon={RotateCcw} onPress={() => setDecision('request_resubmission')} style={styles.flex} testID="review-resubmit" />
              <Button label="Reject" variant="secondary" icon={X} onPress={() => setDecision('reject')} style={styles.flex} testID="review-reject" />
            </View>
          </>
        ) : undefined
      }
    >
      <ScreenHeader title={v.fullName} size="compact" back />
      <View style={styles.body}>
        {actionError ? <Banner tone="danger" title="Couldn’t record the decision" message={actionError} /> : null}
        {own ? <Banner tone="warning" title="This is your own submission" message="Another reviewer must decide on it." /> : null}
        {!isPending ? (
          <Banner tone="info" title={`Already decided: ${v.status.replace('_', ' ')}`} message={v.reviewReason ?? undefined} />
        ) : null}

        <View style={styles.card}>
          <ListRow title="University email" value={v.studentEmail} />
          <ListRow title="Student ID" value={v.studentId} />
          <ListRow title="Academic year" value={v.academicYearLabel} trailing={<StatusPill label={v.academicYearIsCurrent ? 'Current' : 'Not current'} tone={v.academicYearIsCurrent ? 'success' : 'warning'} />} />
          <ListRow title="Wants to" value={v.requestedRoles.map((r) => (r === 'borrower' ? 'Borrow' : 'Lend')).join(' + ')} />
          <ListRow title="Submitted" value={formatDateTimeManila(v.submittedAt)} />
          <ListRow title="Review method" value="Manual student review (demo)" />
        </View>

        <View style={styles.section}>
          <Text variant="overline" tone="muted" uppercase>Registration form</Text>
          {urlError ? (
            <Banner tone="danger" title="Document unavailable" message={`${urlError} The sample file may not be uploaded yet.`} />
          ) : url && v.documentMime?.startsWith('image/') ? (
            <Image source={{ uri: url }} style={styles.preview} contentFit="contain" accessibilityLabel="Registration form image" />
          ) : (
            <View style={[styles.card, styles.docCard]}>
              <Icon as={FileText} size="lg" color={colors.link} />
              <View style={styles.flex}>
                <Text variant="callout">{v.documentMime === 'application/pdf' ? 'PDF document' : 'Document'}</Text>
                <Text variant="footnote" tone="muted">{v.documentSizeBytes ? formatBytes(v.documentSizeBytes) : ''}</Text>
              </View>
            </View>
          )}
          {url ? (
            <Button
              label="Open document"
              variant="secondary"
              icon={ExternalLink}
              onPress={() => void Linking.openURL(url)}
            />
          ) : null}
          <Text variant="footnote" tone="muted">Opens a private link that expires in {SIGNED_URL_TTL / 60} minutes. Don’t share it or save copies.</Text>
        </View>
      </View>

      <Dialog
        visible={decision === 'approve'}
        title="Approve this student?"
        message={`${v.fullName} will be verified until the end of ${v.academicYearLabel} and can start to ${v.requestedRoles.map((r) => (r === 'borrower' ? 'borrow' : 'lend')).join(' and ')}.`}
        confirmLabel="Approve"
        loading={busy}
        onConfirm={decide}
        onCancel={() => setDecision(null)}
        testID="approve-dialog"
      />
      <Sheet
        visible={decision === 'reject' || decision === 'request_resubmission'}
        onClose={() => setDecision(null)}
        title={decision === 'reject' ? 'Reject submission' : 'Request changes'}
        description="The student sees this reason exactly as written."
        footer={
          <Button
            label={decision === 'reject' ? 'Reject' : 'Send back to student'}
            variant={decision === 'reject' ? 'danger' : 'primary'}
            onPress={decide}
            loading={busy}
            fullWidth
            testID="review-confirm-reason"
          />
        }
      >
        <TextField
          label="Reason"
          multiline
          value={reason}
          onChangeText={(t) => {
            setReason(t);
            if (reasonError) setReasonError(null);
          }}
          error={reasonError}
          placeholder="e.g. The form is for a previous term. Please upload your current registration form."
          maxLength={500}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  section: { gap: spacing.sm },
  docCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  preview: { width: '100%', height: 360, borderRadius: radii.md, backgroundColor: colors.surfaceSunken },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
