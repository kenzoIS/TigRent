import { Redirect } from 'expo-router';
import { resolveHome } from '@/features/auth/route-resolver';
import { useSession } from '@/features/auth/session';

/** App bootstrap: send the session to the right area. */
export default function Index() {
  const { state } = useSession();
  return <Redirect href={resolveHome(state)} />;
}
