import { router, usePathname, useSegments } from 'expo-router';
import { Store, User } from 'lucide-react-native';
import { SegmentedControl } from '@/components/design-system';
import type { MarketplaceRole } from '@/domain/entities';
import { useSession } from './session';

export type RoleSwitcherProps = {
  current: MarketplaceRole;
  /**
   * Explicit target screen/tab to preserve (e.g. 'profile' or 'messages').
   * If omitted, it automatically infers from active route segments.
   */
  screen?: 'profile' | 'messages' | 'index' | string;
};

/**
 * Borrower/Lender switcher. Rendered only when BOTH roles are enabled (plan §2.1). The active role
 * is a UI preference; each area still checks the enabled roles from the server.
 */
export function RoleSwitcher({ current, screen: explicitScreen }: RoleSwitcherProps) {
  const { context, setActiveRole } = useSession();
  const segments = useSegments();
  const pathname = usePathname();
  const roles = context?.roles ?? [];

  if (!(roles.includes('borrower') && roles.includes('lender'))) return null;

  const resolveTargetRoute = (targetRole: MarketplaceRole) => {
    // 1. Explicit screen prop if provided
    if (explicitScreen) {
      return explicitScreen === 'index' ? `/${targetRole}` : `/${targetRole}/${explicitScreen}`;
    }

    // 2. Infer from current segments: if on 'profile' or 'messages', preserve that tab
    const lastSegment = segments[segments.length - 1];
    if (lastSegment === 'profile' || lastSegment === 'messages') {
      return `/${targetRole}/${lastSegment}`;
    }

    // 3. Fallback check on pathname string
    if (pathname && pathname.includes('/profile')) {
      return `/${targetRole}/profile`;
    }
    if (pathname && pathname.includes('/messages')) {
      return `/${targetRole}/messages`;
    }

    // Default to the target role's dashboard/root
    return `/${targetRole}`;
  };

  return (
    <SegmentedControl
      testID="role-switcher"
      accessibilityLabel="Switch between borrowing and lending"
      value={current}
      onChange={(role) => {
        void setActiveRole(role);
        const destination = resolveTargetRoute(role);
        router.navigate(destination as any);
      }}
      segments={[
        { value: 'borrower', label: 'Borrowing', icon: User },
        { value: 'lender', label: 'Lending', icon: Store },
      ]}
    />
  );
}
