/**
 * Session + catalog context: who is signed in, and the module/skill catalog.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CatalogResponse, ModuleInfo, UserView } from '../../../shared/api.ts';
import type { ScenarioTemplate, SkillDef } from '../../../shared/types.ts';
import { api } from '../api.ts';

interface SessionValue {
  user: UserView | null;
  loading: boolean;
  catalog: CatalogResponse | null;
  setUser: (u: UserView | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  module: (id: string) => ModuleInfo | undefined;
  skill: (id: string) => SkillDef | undefined;
  template: (id: string) => ScenarioTemplate | undefined;
  mistakeTitle: (code: string) => string;
  strengthTitle: (code: string) => string;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserView | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [me, cat] = await Promise.all([api.me(), api.catalog()]);
      setUser(me.user);
      setCatalog(cat);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<SessionValue>(() => {
    const modules = catalog?.modules ?? [];
    const skills = new Map(modules.flatMap((m) => m.skills.map((s) => [s.id, s] as const)));
    const templates = new Map(modules.flatMap((m) => m.templates.map((t) => [t.id, t] as const)));
    const mistakes = Object.assign({}, ...modules.map((m) => m.mistakes)) as ModuleInfo['mistakes'];
    const strengths = Object.assign({}, ...modules.map((m) => m.strengths)) as ModuleInfo['strengths'];
    return {
      user,
      loading,
      catalog,
      setUser,
      refresh,
      logout,
      module: (id) => modules.find((m) => m.id === id),
      skill: (id) => skills.get(id),
      template: (id) => templates.get(id),
      mistakeTitle: (code) => mistakes[code]?.title ?? code,
      strengthTitle: (code) => strengths[code]?.title ?? code,
    };
  }, [user, loading, catalog, refresh, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Small data-loading hook with reload support. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loader()
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
