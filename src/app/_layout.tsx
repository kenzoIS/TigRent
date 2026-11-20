import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { ToastProvider } from '@/components/design-system';
import { ConfigErrorScreen } from '@/components/shared/ConfigErrorScreen';
import { validateEnv } from '@/lib/env';
import { SessionProvider } from '@/features/auth/session';
import { MotionProvider } from '@/lib/motion';
import { colors } from '@/theme';

export { ErrorBoundary } from '@/components/shared/RouteErrorBoundary';

const envCheck = validateEnv();

export default function RootLayout() {
  if (!envCheck.ok) {
    return (
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ConfigErrorScreen issues={envCheck.issues} />
      </SafeAreaProvider>
    );
  }
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <MotionProvider>
        <SessionProvider>
          <ToastProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
              <Stack.Screen name="borrower" options={{ animation: 'fade' }} />
              <Stack.Screen name="lender" options={{ animation: 'fade' }} />
              <Stack.Screen name="admin" options={{ animation: 'fade' }} />
            </Stack>
          </ToastProvider>
        </SessionProvider>
      </MotionProvider>
    </SafeAreaProvider>
  );
}
