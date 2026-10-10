'use client';

import { useEffect, useState } from 'react';
import { browserSupabase } from './supabase';

export function useSessionToken() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const client = browserSupabase();

    client.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { token };
}
