import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { Banner, Button, PasswordField, Screen, ScreenHeader, Text, TextField, type TextFieldHandle } from '@/components/design-system';
import { authService } from '@/features/auth/auth-service';
import { useSession } from '@/features/auth/session';
import { fieldErrors, signInSchema, type FieldErrors } from '@/features/auth/validation';
import { spacing } from '@/theme';

export default function SignIn() {
  const { notice, clearNotice } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors<'email' | 'password'>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextFieldHandle>(null);

  const submit = async () => {
    const parsed = signInSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setFormError(null);
    clearNotice();
    setBusy(true);
    const r = await authService.signIn(parsed.data.email, parsed.data.password);
    // On success the session guard routes the user; keep the button busy until then.
    if (!r.ok) {
      setBusy(false);
      setFormError(r.error.message);
    }
  };

  return (
    <Screen
      background="ambient"
      footer={<Button label="Sign in" onPress={submit} loading={busy} fullWidth testID="sign-in-submit" />}
    >
      <ScreenHeader title="Welcome back" subtitle="Sign in to rent and lend within the TigRent student community." back />
      <View style={styles.form}>
        {notice ? <Banner tone="warning" title={notice} onDismiss={clearNotice} /> : null}
        {formError ? <Banner tone="danger" title="Couldn’t sign in" message={formError} testID="sign-in-error" /> : null}
        <TextField
          label="Email"
          leadingIcon={Mail}
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <PasswordField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <Button label="Forgot password?" variant="ghost" size="sm" onPress={() => router.push('/forgot-password')} style={styles.forgot} />
      </View>
      <View style={styles.alt}>
        <Text variant="subhead" tone="muted">New to TigRent?</Text>
        <Button label="Create an account" variant="ghost" size="sm" onPress={() => router.replace('/sign-up')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg, paddingTop: spacing.sm },
  forgot: { alignSelf: 'flex-end' },
  alt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.xxl },
});
