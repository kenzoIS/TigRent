import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { KeyRound, Mail } from 'lucide-react-native';
import { Banner, Button, Icon, PasswordField, Screen, ScreenHeader, Text, TextField, useToast } from '@/components/design-system';
import { authService } from '@/features/auth/auth-service';
import { useSession } from '@/features/auth/session';
import { emailSchema, fieldErrors, newPasswordSchema, otpSchema, PASSWORD_RULES } from '@/features/auth/validation';
import { colors, radii, spacing } from '@/theme';

type Step = 'request' | 'code' | 'new_password';

/** Password reset by emailed code (works in Expo Go without deep links). */
export default function ForgotPassword() {
  const toast = useToast();
  const { setPasswordRecovery, signOut } = useSession();
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async () => {
    const e = emailSchema.safeParse(email);
    if (!e.success) return setErrors({ email: e.error.issues[0]?.message });
    setErrors({});
    setFormError(null);
    setBusy(true);
    const r = await authService.requestPasswordReset(e.data);
    setBusy(false);
    if (!r.ok) return setFormError(r.error.message);
    setStep('code');
  };

  const verify = async () => {
    const c = otpSchema.safeParse(code);
    if (!c.success) return setErrors({ code: c.error.issues[0]?.message });
    setErrors({});
    setFormError(null);
    setBusy(true);
    setPasswordRecovery(true); // keep this screen while the recovery session exists
    const r = await authService.verifyRecoveryCode(email, c.data);
    setBusy(false);
    if (!r.ok) {
      setPasswordRecovery(false);
      return setFormError(r.error.message);
    }
    setStep('new_password');
  };

  const save = async () => {
    const parsed = newPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setFormError(null);
    setBusy(true);
    const r = await authService.updatePassword(parsed.data.password);
    setBusy(false);
    if (!r.ok) return setFormError(r.error.message);
    toast.show({ title: 'Password updated', message: 'You’re signed in with your new password.', tone: 'success' });
    setPasswordRecovery(false); // the guard now continues to the user's home
  };

  const cancelRecovery = async () => {
    await signOut();
    router.replace('/sign-in');
  };

  const footer =
    step === 'request' ? (
      <Button label="Send reset email" onPress={request} loading={busy} fullWidth />
    ) : step === 'code' ? (
      <Button label="Verify code" onPress={verify} loading={busy} fullWidth />
    ) : (
      <>
        <Button label="Save new password" onPress={save} loading={busy} fullWidth />
        <Button label="Cancel" variant="ghost" onPress={cancelRecovery} disabled={busy} fullWidth />
      </>
    );

  return (
    <Screen background="ambient" footer={footer}>
      <ScreenHeader title="Reset password" back={step !== 'new_password'} />
      <View style={styles.form}>
        <View style={styles.icon}>
          <Icon as={KeyRound} size="xl" color={colors.link} />
        </View>
        {formError ? <Banner tone="danger" title="Something needs attention" message={formError} /> : null}
        {step === 'request' ? (
          <>
            <Text variant="callout" tone="muted">Enter your account email. We’ll send a code you can use to set a new password.</Text>
            <TextField label="Email" leadingIcon={Mail} value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          </>
        ) : step === 'code' ? (
          <>
            <Text variant="callout" tone="muted">If an account exists for {email}, a reset email is on its way. Enter the code from it.</Text>
            <TextField
              label="Reset code"
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 10))}
              error={errors.code}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              placeholder="123456"
            />
            <Button label="Use a different email" variant="ghost" size="sm" onPress={() => setStep('request')} />
          </>
        ) : (
          <>
            <Text variant="callout" tone="muted">Choose a new password for {email}.</Text>
            <PasswordField label="New password" value={password} onChangeText={setPassword} error={errors.password} helper={PASSWORD_RULES} autoComplete="new-password" textContentType="newPassword" />
            <PasswordField label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} error={errors.confirmPassword} autoComplete="new-password" textContentType="newPassword" />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg, paddingTop: spacing.sm },
  icon: { width: 64, height: 64, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
