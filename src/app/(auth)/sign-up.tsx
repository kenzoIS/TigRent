import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Mail, User } from 'lucide-react-native';
import { Banner, Button, PasswordField, Screen, ScreenHeader, Text, TextField } from '@/components/design-system';
import { authService } from '@/features/auth/auth-service';
import { fieldErrors, PASSWORD_RULES, signUpSchema, type FieldErrors } from '@/features/auth/validation';
import { spacing } from '@/theme';

type Field = 'fullName' | 'email' | 'password' | 'confirmPassword';

export default function SignUp() {
  const [values, setValues] = useState<Record<Field, string>>({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<{ message: string; existing: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: Field) => (v: string) => setValues((s) => ({ ...s, [k]: v }));

  const submit = async () => {
    const parsed = signUpSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    const r = await authService.signUp({ email: parsed.data.email, password: parsed.data.password, fullName: parsed.data.fullName });
    if (!r.ok) {
      setBusy(false);
      setFormError({ message: r.error.message, existing: r.error.kind === 'conflict' && r.error.code === 'user_already_exists' });
      return;
    }
    if (r.data.needsEmailConfirmation) {
      router.replace({ pathname: '/check-email', params: { email: parsed.data.email } });
    }
    // Otherwise a session was created and the guard moves on to onboarding.
  };

  return (
    <Screen background="ambient" footer={<Button label="Create account" onPress={submit} loading={busy} fullWidth testID="sign-up-submit" />}>
      <ScreenHeader title="Create your account" subtitle="One account lets you borrow, lend, or both." back />
      <View style={styles.form}>
        {formError ? (
          <Banner
            tone="danger"
            title="Couldn’t create your account"
            message={formError.message}
            action={formError.existing ? { label: 'Go to sign in', onPress: () => router.replace('/sign-in') } : undefined}
            testID="sign-up-error"
          />
        ) : null}
        <TextField label="Full name" leadingIcon={User} value={values.fullName} onChangeText={set('fullName')} error={errors.fullName} autoComplete="name" textContentType="name" />
        <TextField
          label="Email"
          leadingIcon={Mail}
          value={values.email}
          onChangeText={set('email')}
          error={errors.email}
          helper="Use an address you can open now. You’ll confirm it with a code."
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <PasswordField label="Password" value={values.password} onChangeText={set('password')} error={errors.password} helper={PASSWORD_RULES} autoComplete="new-password" textContentType="newPassword" />
        <PasswordField label="Confirm password" value={values.confirmPassword} onChangeText={set('confirmPassword')} error={errors.confirmPassword} autoComplete="new-password" textContentType="newPassword" />
        <Banner
          tone="info"
          title="Student verification is a separate step"
          message="After you confirm your email and accept the Terms, you’ll submit your UST details and registration form for manual review. Signing in alone doesn’t verify you as a student."
        />
      </View>
      <View style={styles.alt}>
        <Text variant="subhead" tone="muted">Already have an account?</Text>
        <Button label="Sign in" variant="ghost" size="sm" onPress={() => router.replace('/sign-in')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg, paddingTop: spacing.sm },
  alt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.xxl },
});
