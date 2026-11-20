import { Redirect, Stack } from 'expo-router';
import { colors } from '@/theme';

/** Developer-only tools. Unreachable in production builds (plan §0.1.7, Phase 2 reset rules). */
export default function DevLayout() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
