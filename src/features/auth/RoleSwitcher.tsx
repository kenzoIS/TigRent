import { router } from 'expo-router';
import { Store, User } from 'lucide-react-native';
import { SegmentedControl } from '@/components/design-system';
import type { MarketplaceRole } from '@/domain/entities';
import { useSession } from './session';

/**
 * Borrower/Lender switcher. Rendered only when BOTH roles are enabled (plan §2.1). The active role
 * is a UI preference; each area still checks the enabled roles from the server.
 */
export function RoleSwitcher({ current }: { current: MarketplaceRole }) {
  const { context, setActiveRole } = useSession();
  const roles = context?.roles ?? [];
  if (!(roles.includes('borrower') && roles.includes('lender'))) return null;
  return (
    <SegmentedControl
      testID="role-switcher"
      accessibilityLabel="Switch between borrowing and lending"
      value={current}
      onChange={(role) => {
        void setActiveRole(role);
        // navigate (not replace) returns to the other area's existing screen state when it's already open.
        router.navigate(role === 'lender' ? '/lender' : '/borrower');
      }}
      segments={[
        { value: 'borrower', label: 'Borrowing', icon: User },
        { value: 'lender', label: 'Lending', icon: Store },
      ]}
    />
  );
}
