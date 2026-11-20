import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Settings } from 'lucide-react-native';
import { Icon } from '@/components/design-system/Icon';
import { Text } from '@/components/design-system/Text';
import { colors, gutter, radii, spacing } from '@/theme';

/** Shown instead of the app when required configuration is missing or unsafe (plan Phase 2). */
export function ConfigErrorScreen({ issues }: { issues: string[] }) {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.icon}>
        <Icon as={Settings} size="xl" color={colors.danger} />
      </View>
      <Text variant="title">TigRent isn’t configured</Text>
      <Text variant="callout" tone="muted">
        The app can’t start because its configuration is missing or unsafe. Copy .env.example to .env, fill in the values, and restart the dev server.
      </Text>
      <View style={styles.list} accessibilityRole="alert">
        {issues.map((i) => (
          <Text key={i} variant="subhead" tone="danger">• {i}</Text>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: gutter, justifyContent: 'center', gap: spacing.md },
  icon: { width: 64, height: 64, borderRadius: radii.md, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  list: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
});
