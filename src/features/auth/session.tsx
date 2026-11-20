/**
 * Session state for the whole app (plan Phase 3). Auth comes from Supabase Auth; roles, verification,
 * account status and terms come from the server (get_my_session_context), never from local state.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { MarketplaceRole } from '@/domain/entities';
import { authService } from '@/features/auth/auth-service';
import type { Result } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';
import { profilesRepository, sessionRepository, type SessionContext } from '@/repositories';
import type { SessionState } from './route-resolver';

export type SessionApi = {
  state: SessionState;
  context: SessionContext | null;
  email: string | null;
  /** Shown once on the welcome/sign-in screen (e.g. "Your session expired"). */
  notice: string | null;
  clearNotice: () => void;
  /** Keeps the auth screens mounted while a password-recovery session sets a new password. */
  passwordRecovery: boolean;
  setPasswordRecovery: (v: boolean) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  setActiveRole: (role: MarketplaceRole) => Promise<void>;
  /** Apply a context returned by an RPC (e.g. after accepting terms) without another round trip. */
  applyContext: (ctx: SessionContext) => void;
};

const SessionContextReact = createContext<SessionApi | null>(null);

export function toSessionState(ctx: SessionContext): SessionState {
  return {
    kind: 'signed_in',
    roles: ctx.roles,
    verification: ctx.verificationStatus,
    accountStatus: ctx.accountStatus,
    termsAccepted: ctx.pendingTerms.length === 0,
    activeRole: ctx.activeRolePref,
  };
}

// ── Test seam: render the app with a fixed session (no Supabase) ─────────────
let testSession: SessionApi | null = null;
export function __setSessionForTests(state: SessionState | null, extra: Partial<SessionApi> = {}) {
  testSession = state
    ? {
        state,
        context: null,
        email: 'test@example.com',
        notice: null,
        clearNotice: () => undefined,
        passwordRecovery: false,
        setPasswordRecovery: () => undefined,
        refresh: async () => undefined,
        signOut: async () => undefined,
        setActiveRole: async () => undefined,
        applyContext: () => undefined,
        ...extra,
      }
    : null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  if (testSession) return <TestSessionProvider initial={testSession}>{children}</TestSessionProvider>;
  return <LiveSessionProvider>{children}</LiveSessionProvider>;
}

/** Test seam that behaves like the live provider: applying a context updates the session state. */
function TestSessionProvider({ initial, children }: { initial: SessionApi; children: ReactNode }) {
  const [current, setCurrent] = useState<{ state: SessionState; context: SessionContext | null }>({ state: initial.state, context: initial.context });
  const value = useMemo<SessionApi>(
    () => ({
      ...initial,
      ...current,
      applyContext: (ctx: SessionContext) => {
        initial.applyContext(ctx);
        setCurrent({ state: toSessionState(ctx), context: ctx });
      },
    }),
    [initial, current],
  );
  return <SessionContextReact.Provider value={value}>{children}</SessionContextReact.Provider>;
}

function LiveSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ kind: 'loading' });
  const [context, setContext] = useState<SessionContext | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const userSignedOut = useRef(false);
  const hadSession = useRef(false);

  const applyContext = useCallback((ctx: SessionContext) => {
    setContext(ctx);
    setState(toSessionState(ctx));
  }, []);

  const loadContext = useCallback(async () => {
    const r: Result<SessionContext> = await sessionRepository.getContext();
    if (r.ok) {
      applyContext(r.data);
      return;
    }
    if (r.error.kind === 'unauthenticated') {
      await getSupabase().auth.signOut({ scope: 'local' }).catch(() => undefined);
      setContext(null);
      setState({ kind: 'signed_out' });
      setNotice('Your session has expired. Please sign in again.');
      return;
    }
    setState({ kind: 'error', message: r.error.message, offline: r.error.kind === 'network' });
  }, [applyContext]);

  useEffect(() => {
    const supabase = getSupabase();
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        if (data.session) {
          hadSession.current = true;
          setEmail(data.session.user.email ?? null);
          void loadContext();
        } else {
          setState({ kind: 'signed_out' });
        }
      })
      .catch(() => !cancelled && setState({ kind: 'signed_out' }));

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Don't call Supabase synchronously inside this callback (supabase-js guidance); defer instead.
      setTimeout(() => {
        if (cancelled) return;
        if (event === 'SIGNED_OUT' || !session) {
          if (hadSession.current && !userSignedOut.current) setNotice('Your session has expired. Please sign in again.');
          hadSession.current = false;
          userSignedOut.current = false;
          setContext(null);
          setEmail(null);
          setState({ kind: 'signed_out' });
          return;
        }
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
          const firstSignIn = !hadSession.current;
          hadSession.current = true;
          setEmail(session.user.email ?? null);
          if (firstSignIn) setState({ kind: 'loading' });
          void loadContext();
        }
      }, 0);
    });

    // Refresh tokens only while the app is in the foreground (supabase-js React Native guidance).
    const appState = Platform.OS === 'web'
      ? null
      : AppState.addEventListener('change', (s) => (s === 'active' ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh()));
    if (Platform.OS !== 'web') supabase.auth.startAutoRefresh();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      appState?.remove();
      if (Platform.OS !== 'web') supabase.auth.stopAutoRefresh();
    };
  }, [loadContext]);

  const signOut = useCallback(async () => {
    userSignedOut.current = true;
    setPasswordRecovery(false);
    const r = await authService.signOut();
    if (!r.ok) {
      // Even if the server call fails (offline), end the session on this device.
      await getSupabase().auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  }, []);

  const setActiveRole = useCallback(
    async (role: MarketplaceRole) => {
      if (!context) return;
      // Optimistic: the active role is only a UI preference (plan §2.1).
      applyContext({ ...context, activeRolePref: role });
      await profilesRepository.updateMine(context.userId, { activeRolePref: role });
    },
    [applyContext, context],
  );

  const value = useMemo<SessionApi>(
    () => ({
      state,
      context,
      email,
      notice,
      clearNotice: () => setNotice(null),
      passwordRecovery,
      setPasswordRecovery,
      refresh: loadContext,
      signOut,
      setActiveRole,
      applyContext,
    }),
    [state, context, email, notice, passwordRecovery, loadContext, signOut, setActiveRole, applyContext],
  );

  return <SessionContextReact.Provider value={value}>{children}</SessionContextReact.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContextReact);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
