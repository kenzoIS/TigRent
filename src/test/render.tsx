import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { ToastProvider } from '@/components/design-system/Toast';
import { MotionProvider } from '@/lib/motion';

export function TestProviders({ children, reducedMotion = false }: { children: ReactNode; reducedMotion?: boolean }) {
  return (
    <MotionProvider forceReduced={reducedMotion}>
      <ToastProvider>{children}</ToastProvider>
    </MotionProvider>
  );
}

export function renderWithProviders(ui: ReactElement, opts: { reducedMotion?: boolean } = {}) {
  return render(ui, { wrapper: ({ children }) => <TestProviders reducedMotion={opts.reducedMotion}>{children}</TestProviders> });
}
