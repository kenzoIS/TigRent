import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Mail, MailCheck } from 'lucide-react-native';
import { Banner, Button, Icon, Screen, ScreenHeader, Text, TextField, useToast } from '@/components/design-system';
import { authService } from '@/features/auth/auth-service';
import { emailSchema, otpSchema } from '@/features/auth/validation';
import { colors, radii, spacing } from '@/theme';

const RESEND_COOLDOWN_S = 60;

/** Email-confirmation pending state (plan Phase 3). Confirms with the emailed code; no deep link needed. */
export default function CheckEmail() {
  const params = useLocalSearchParams<{ email?: string }>();
  const toast = useToast();
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<{ email?: string; code?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const validEmail = () => {
    const e = emailSchema.safeParse(email);
    if (!e.success) setErrors((s) => ({ ...s, email: e.error.issues[0]?.message }));
    return e.success ? e.data : null;
  };

  const verify = async () => {
    const e = validEmail();
    const c = otpSchema.safeParse(code);
    setErrors({ email: e ? undefined : errors.email, code: c.success ? undefined : c.error.issues[0]?.message });
    if (!e || !c.success) return;
    setFormError(null);
    setBusy(true);
    const r = await authService.confirmSignUpCode(e, c.data);
    if (!r.ok) {
      setBusy(false);
      setFormError(r.error.message);
    }
    // Success creates a session; the guard continues to onboarding.
  };

  const resend = async () => {
    const e = validEmail();
    if (!e) return;
    setResending(true);
    const r = await authService.resendConfirmation(e);
    setResending(false);
    if (r.ok) {
      setCooldown(RESEND_COOLDOWN_S);
      toast.show({ title: 'Confirmation email sent', message: `Check ${e}, including the spam folder.`, tone: 'success' });
    } else {
      setFormError(r.error.message);
    }
  };

  return (
    <Screen background="ambient" footer={<Button label="Confirm email" onPress={verify} loading={busy} fullWidth testID="confirm-submit" />}>
      <ScreenHeader title="Confirm your email" back />
      <View style={styles.form}>
        <View style={styles.icon}>
          <Icon as={MailCheck} size="xl" color={colors.link} />
        </View>
        <Text variant="callout" tone="muted">
          We sent a confirmation email{params.email ? ` to ${params.email}` : ''}. Enter the code from that email, or open its link and then sign in here.
        </Text>
        {formError ? <Banner tone="danger" title="Couldn’t confirm" message={formError} /> : null}
        {!params.email ? (
          <TextField label="Email" leadingIcon={Mail} value={email} onChangeText={setEmail} error={errors.email} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        ) : null}
        <TextField
          label="Confirmation code"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 10))}
          error={errors.code}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={10}
          placeholder="123456"
        />
        <Button
          label={cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend email'}
          variant="secondary"
          onPress={resend}
          loading={resending}
          disabled={cooldown > 0}
          disabledReason={cooldown > 0 ? 'You can request another email after the countdown.' : undefined}
        />
        <Button label="I confirmed with the link. Sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg, paddingTop: spacing.sm },
  icon: { width: 64, height: 64, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
