import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { Mail, ShieldCheck, User } from 'lucide-react-native';
import { Banner, Button, Checkbox, ErrorState, LoadingRows, Screen, ScreenHeader, SelectField, Text, TextField } from '@/components/design-system';
import type { AcademicYear, MarketplaceRole } from '@/domain/entities';
import { useSession } from '@/features/auth/session';
import { DocumentField, type UploadedDocument } from '@/features/verification/DocumentField';
import { buildVerificationSchema, SERVER_ERROR_FIELD, type VerificationField } from '@/features/verification/validation';
import { fieldErrors } from '@/features/auth/validation';
import { ok } from '@/lib/errors';
import { useAsync } from '@/lib/use-async';
import { studentVerificationProvider } from '@/providers/student-verification/manual-demo';
import { academicYearsRepository, verificationRepository, type VerificationQueueItem, type VerificationRules } from '@/repositories';
import { spacing } from '@/theme';

/** Student verification submission (plan §2.2, Phase 4, Journey A.3). */
export default function VerificationScreen() {
  const { context, refresh, signOut } = useSession();
  const userId = context?.userId ?? '';

  const loaded = useAsync(async () => {
    const [rules, years, history] = await Promise.all([
      verificationRepository.getRules(),
      academicYearsRepository.list(),
      verificationRepository.listMine(userId),
    ]);
    if (!rules.ok) return rules;
    if (!years.ok) return years;
    if (!history.ok) return history;
    return ok({ rules: rules.data, years: years.data, history: history.data });
  }, [userId]);

  if (!context) return null;
  if (context.verificationStatus === 'verified') return <Redirect href="/" />;
  if (context.verificationStatus === 'pending_review') return <Redirect href="/onboarding/status" />;

  return (
    <Screen footer={<Button label="Sign out" variant="ghost" onPress={() => void signOut()} fullWidth />}>
      <ScreenHeader
        title={context.verificationStatus === 'expired' ? 'Renew your verification' : 'Verify your student status'}
        subtitle="TigRent is only for verified UST students. Signing in doesn’t verify you; this review does."
        back={context.verificationStatus === 'not_submitted' ? undefined : true}
      />
      {loaded.error ? (
        <ErrorState offline={loaded.error.kind === 'network'} message={loaded.error.message} onRetry={loaded.reload} />
      ) : !loaded.data ? (
        <LoadingRows rows={4} label="Loading form" />
      ) : (
        <VerificationForm
          key={loaded.data.history[0]?.id ?? 'new'}
          userId={userId}
          fallbackName={context.fullName}
          data={loaded.data}
          onSubmitted={async () => {
            await refresh();
            router.replace('/onboarding/status');
          }}
        />
      )}
    </Screen>
  );
}

type Loaded = { rules: VerificationRules; years: AcademicYear[]; history: VerificationQueueItem[] };

function VerificationForm({ userId, fallbackName, data, onSubmitted }: { userId: string; fallbackName: string; data: Loaded; onSubmitted: () => Promise<void> }) {
  const { rules, years, history } = data;
  const previous = history[0];
  const current = years.find((y) => y.isCurrent);
  const [fullName, setFullName] = useState(previous?.fullName ?? fallbackName);
  const [studentEmail, setStudentEmail] = useState(previous?.studentEmail ?? '');
  const [studentId, setStudentId] = useState(previous?.studentId ?? '');
  const [academicYearId, setAcademicYearId] = useState<string | null>(current?.id ?? null);
  const [roles, setRoles] = useState<MarketplaceRole[]>(previous?.requestedRoles ?? []);
  const [doc, setDoc] = useState<UploadedDocument | null>(null);
  const [errors, setErrors] = useState<Partial<Record<VerificationField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const schema = useMemo(() => buildVerificationSchema(rules, years), [rules, years]);
  const toggleRole = (r: MarketplaceRole, on: boolean) => setRoles((s) => (on ? [...new Set([...s, r])] : s.filter((x) => x !== r)));

  const submit = async () => {
    const parsed = schema.safeParse({ fullName, studentEmail, studentId, academicYearId: academicYearId ?? '', roles, documentPath: doc?.path });
    if (!parsed.success) {
      const fe = fieldErrors<string>(parsed.error);
      setErrors({ ...fe, document: fe.documentPath } as Partial<Record<VerificationField, string>>);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    const r = await studentVerificationProvider.submit({
      fullName: parsed.data.fullName,
      studentEmail: parsed.data.studentEmail,
      studentId: parsed.data.studentId,
      academicYearId: parsed.data.academicYearId,
      requestedRoles: parsed.data.roles,
      documentPath: parsed.data.documentPath,
    });
    if (r.ok) {
      await onSubmitted();
      return;
    }
    setBusy(false);
    const field = r.error.code ? SERVER_ERROR_FIELD[r.error.code] : undefined;
    if (field) setErrors({ [field]: r.error.message });
    else setFormError(r.error.message);
  };

  return (
    <View style={styles.form}>
      {previous && (previous.status === 'rejected' || previous.status === 'needs_resubmission') && previous.reviewReason ? (
        <Banner tone="warning" title="What the reviewer asked you to fix" message={previous.reviewReason} />
      ) : null}
      <Banner tone="info" title={studentVerificationProvider.label} message={studentVerificationProvider.description} />
      {formError ? <Banner tone="danger" title="Couldn’t submit" message={formError} /> : null}

      <TextField label="Full name" leadingIcon={User} value={fullName} onChangeText={setFullName} error={errors.fullName} helper="As it appears on your registration form." required />
      <TextField
        label="University email"
        leadingIcon={Mail}
        value={studentEmail}
        onChangeText={setStudentEmail}
        error={errors.studentEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        helper={`Accepted domains: ${rules.emailDomains.join(', ')}${rules.isSample ? ' (sample configuration)' : ''}. A valid email alone doesn’t prove enrollment.`}
        required
      />
      <TextField
        label="Student ID"
        leadingIcon={ShieldCheck}
        value={studentId}
        onChangeText={setStudentId}
        error={errors.studentId}
        autoCapitalize="characters"
        helper={`Kept private: never shown on your public profile.${rules.isSample ? ' Format is checked against a sample rule.' : ''}`}
        required
      />
      <SelectField
        label="Academic year"
        value={academicYearId}
        onChange={setAcademicYearId}
        error={errors.academicYearId}
        required
        options={years.map((y) => ({
          value: y.id,
          label: y.label,
          description: y.isCurrent ? 'Current academic year' : rules.allowNonCurrentYear ? 'Allowed by a demo exception' : 'Not accepting submissions',
          disabled: !y.isCurrent && !rules.allowNonCurrentYear,
        }))}
      />
      <View style={styles.roles}>
        <Text variant="subhead" style={styles.label}>How will you use TigRent?</Text>
        <Checkbox label="Borrow equipment" description="Rent items from other students." checked={roles.includes('borrower')} onChange={(v) => toggleRole('borrower', v)} />
        <Checkbox label="Lend my equipment" description="Earn from items you aren’t using." checked={roles.includes('lender')} onChange={(v) => toggleRole('lender', v)} error={errors.roles} />
        <Text variant="footnote" tone="muted">You can enable the other role later without a new account.</Text>
      </View>
      <DocumentField userId={userId} rules={rules} value={doc} onChange={setDoc} error={errors.document} disabled={busy} />
      <Button label="Submit for review" onPress={submit} loading={busy} fullWidth testID="verification-submit" />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg, paddingTop: spacing.sm },
  roles: { gap: spacing.xs },
  label: { fontWeight: '500' },
});
