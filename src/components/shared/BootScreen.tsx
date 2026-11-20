import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from '@/components/design-system/Button';
import { ErrorState } from '@/components/design-system/States';
import { AmbientBackground } from '@/components/shared/AmbientBackground';
import { Wordmark } from '@/components/shared/Wordmark';
import { useSession } from '@/features/auth/session';
import { colors, gutter, spacing } from '@/theme';

/** Session restore / bootstrap screen, including the offline-at-launch retry state. */
export function BootScreen() {
  const { state, refresh, signOut } = useSession();
  if (state.kind === 'error') {
    return (
      <View style={styles.root}>
        <AmbientBackground />
        <ErrorState offline={state.offline} title="We couldn’t load your account" message={state.message} onRetry={() => void refresh()} />
        <Button label="Sign out" variant="ghost" onPress={() => void signOut()} />
      </View>
    );
  }
  return (
    <View style={styles.root} accessibilityLabel="Loading TigRent" accessibilityState={{ busy: true }}>
      <AmbientBackground />
      <Wordmark size="lg" />
      <ActivityIndicator color={colors.link} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl, padding: gutter, backgroundColor: colors.background },
});
