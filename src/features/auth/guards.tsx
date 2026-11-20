/**
 * Route guards (plan Phase 3). They decide navigation from SERVER-loaded session facts; every
 * protected action is still enforced by RLS/RPCs, so a bypassed guard exposes nothing (plan §6.5).
 */
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { BootScreen } from '@/components/shared/BootScreen';
import { canEnterArea, resolveHome } from './route-resolver';
import { useSession } from './session';

/** Borrower / lender / admin areas: requires the role (and verification for marketplace areas). */
export function AreaGuard({ area, children }: { area: 'borrower' | 'lender' | 'admin'; children: ReactNode }) {
  const { state } = useSession();
  if (state.kind === 'loading' || state.kind === 'error') return <BootScreen />;
  if (!canEnterArea(state, area)) return <Redirect href={resolveHome(state)} />;
  return <>{children}</>;
}

/** Any signed-in member (onboarding, notifications, settings, restricted/appeal). */
export function RequireSignedIn({ children }: { children: ReactNode }) {
  const { state } = useSession();
  if (state.kind === 'loading' || state.kind === 'error') return <BootScreen />;
  if (state.kind !== 'signed_in') return <Redirect href="/welcome" />;
  return <>{children}</>;
}

/** Welcome / sign-in / sign-up: signed-in users are sent to their home. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { state, passwordRecovery } = useSession();
  if (state.kind === 'signed_in' && !passwordRecovery) return <Redirect href={resolveHome(state)} />;
  return <>{children}</>;
}
