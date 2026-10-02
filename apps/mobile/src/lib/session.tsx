import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setApiToken, type Role, type SessionUser } from './api';
import { getItem, setItem } from './storage';

const TOKEN_KEY = 'schoolsyncer.token';

interface Session {
  user: SessionUser | null;
  loading: boolean;
  signIn: (schoolSlug: string, login: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const saved = await getItem(TOKEN_KEY);
      if (saved) {
        setApiToken(saved);
        try {
          setUser(await api<SessionUser>('/auth/me'));
        } catch (e) {
          // An expired or revoked token signs the user out; a network error keeps them signed in for a retry.
          if (e instanceof ApiError && e.status === 401) {
            setApiToken(null);
            await setItem(TOKEN_KEY, null);
          }
        }
      }
      setLoading(false);
    })();
  }, []);

  const signIn = useCallback(async (schoolSlug: string, login: string, password: string) => {
    const res = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: { schoolSlug: schoolSlug.trim().toLowerCase(), login: login.trim(), password },
    });
    setApiToken(res.accessToken);
    await setItem(TOKEN_KEY, res.accessToken);
    setUser(await api<SessionUser>('/auth/me'));
  }, []);

  const signOut = useCallback(async () => {
    setApiToken(null);
    await setItem(TOKEN_KEY, null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}

export const TEACHING: Role[] = ['OWNER', 'PRINCIPAL', 'ADMIN', 'TEACHER', 'CLASS_TEACHER'];
export const hasRole = (user: SessionUser | null, roles: Role[]) =>
  Boolean(user?.roles.some((r) => roles.includes(r.role)));
