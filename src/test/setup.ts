import { setUpTests } from 'react-native-reanimated';

setUpTests();

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories must be synchronous
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

// Test-only public config (never real credentials).
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_key_for_jest_only';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories must be synchronous
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// UI tests share CPU with the PGlite database suite; give async queries headroom so a slow
// first render under parallel load doesn't flake. Passing tests still resolve immediately.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- configure before any test runs
require('@testing-library/react-native').configure({ asyncUtilTimeout: 5000 });

// UI tests must never reach the network (or the live Supabase project). Anything not mocked fails fast.
global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed (blocked in tests)'))) as unknown as typeof fetch;
