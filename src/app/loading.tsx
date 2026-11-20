import { Redirect } from 'expo-router';
import { BootScreen } from '@/components/shared/BootScreen';
import { resolveHome } from '@/features/auth/route-resolver';
import { useSession } from '@/features/auth/session';

/** Shown while the session is restored; moves on as soon as the server context is known. */
export default function Loading() {
  const { state } = useSession();
  if (state.kind === 'loading' || state.kind === 'error') return <BootScreen />;
  return <Redirect href={resolveHome(state)} />;
}
