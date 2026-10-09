import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, authApi, tokenStore } from '../lib/api';
import type { Role, User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, role: Role) => Promise<User>;
  register: (body: { name: string; email: string; password: string; phone?: string; studentId?: string }) => Promise<User>;
  logout: () => Promise<void>;
  updateProfile: (body: { name?: string; phone?: string; studentId?: string }) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    if (!tokenStore.get()) {
      setUser(null);
      return;
    }
    try {
      const { user: me } = await authApi.me();
      setUser(me);
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError) {
        tokenStore.clear();
        setUser(null);
      } else {
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await loadSession();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [loadSession]);

  const login = useCallback(async (email: string, password: string, role: Role) => {
    const result = await authApi.login(email, password, role);
    tokenStore.set(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const register = useCallback(
    async (body: { name: string; email: string; password: string; phone?: string; studentId?: string }) => {
      const result = await authApi.register(body);
      tokenStore.set(result.token);
      setUser(result.user);
      return result.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Signing out locally matters more than the round trip.
    }
    tokenStore.clear();
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (body: { name?: string; phone?: string; studentId?: string }) => {
    const { user: updated } = await authApi.updateProfile(body);
    setUser(updated);
  }, []);

  const refresh = useCallback(async () => {
    await loadSession();
  }, [loadSession]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, register, logout, updateProfile, refresh }),
    [user, loading, login, register, logout, updateProfile, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}