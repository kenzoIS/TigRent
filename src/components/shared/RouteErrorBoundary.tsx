import { View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';
import { ErrorState } from '@/components/design-system/States';
import { colors } from '@/theme';

/** Route-level error boundary: shows a recoverable error instead of a blank screen. */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  if (__DEV__) console.error('[route error]', error);
  return (
    <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
      <ErrorState
        title="This screen couldn’t load"
        message={__DEV__ ? error.message : 'Please try again. If it keeps happening, contact TigRent support.'}
        onRetry={retry}
      />
    </View>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
