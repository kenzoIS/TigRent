import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Banner, Button, Checkbox, ErrorState, LoadingRows, Screen, ScreenHeader, StatusPill, Text } from '@/components/design-system';
import type { TermsDocument } from '@/domain/entities';
import { useSession } from '@/features/auth/session';
import type { Result } from '@/lib/errors';
import { sessionRepository, termsRepository } from '@/repositories';
import { colors, radii, spacing } from '@/theme';

/** Terms of Service + Privacy Notice acceptance, recorded per version on the server (Journey A.4). */
export default function TermsScreen() {
  const { context, applyContext, signOut } = useSession();
  const [docs, setDocs] = useState<TermsDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyResult = useCallback((r: Result<TermsDocument[]>) => {
    if (r.ok) {
      setLoadError(null);
      setDocs(r.data.filter((d) => d.docType === 'tos' || d.docType === 'privacy'));
    } else {
      setLoadError(r.error.message);
    }
  }, []);

  const load = useCallback(async () => applyResult(await termsRepository.listActive()), [applyResult]);

  useEffect(() => {
    let active = true;
    termsRepository.listActive().then((r) => active && applyResult(r));
    return () => {
      active = false;
    };
  }, [applyResult]);

  const alreadyAccepted = context?.pendingTerms.length === 0;

  const accept = async () => {
    if (!docs) return;
    if (!accepted) {
      setCheckError('Please confirm that you have read and accept both documents.');
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const r = await sessionRepository.acceptTerms(docs.map((d) => d.id));
    setBusy(false);
    if (!r.ok) {
      setSubmitError(r.error.message);
      if (r.error.code === 'terms_outdated') void load();
      return;
    }
    applyContext(r.data);
    router.replace('/');
  };

  return (
    <Screen
      footer={
        alreadyAccepted ? (
          <Button label="Continue" onPress={() => router.replace('/')} fullWidth />
        ) : (
          <>
            <Button label="Accept and continue" onPress={accept} loading={busy} disabled={!docs} fullWidth testID="terms-accept" />
            <Button label="Sign out" variant="ghost" onPress={() => void signOut()} fullWidth />
          </>
        )
      }
    >
      <ScreenHeader title="Terms & Privacy" subtitle="Please read how TigRent works and how we handle your information." />
      {alreadyAccepted ? <Banner tone="success" title="You’ve accepted the current versions." /> : null}
      {loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : !docs ? (
        <LoadingRows rows={2} label="Loading documents" />
      ) : (
        <View style={styles.docs}>
          {docs.map((d) => (
            <View key={d.id} style={styles.doc}>
              <View style={styles.docHeader}>
                <Text variant="headline" style={styles.flex}>{d.title}</Text>
                <StatusPill label={`Version ${d.version}`} />
              </View>
              {d.isSample ? <StatusPill label="Prototype text, not legally reviewed" tone="warning" /> : null}
              <Text variant="callout">{d.content}</Text>
            </View>
          ))}
          {submitError ? <Banner tone="danger" title="Couldn’t record your acceptance" message={submitError} /> : null}
          {!alreadyAccepted ? (
            <Checkbox
              label="I have read and accept the Terms of Service and Privacy Notice."
              checked={accepted}
              onChange={(v) => {
                setAccepted(v);
                if (v) setCheckError(null);
              }}
              error={checkError}
              testID="terms-checkbox"
            />
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  docs: { gap: spacing.lg, paddingTop: spacing.sm },
  doc: { gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg },
  docHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
