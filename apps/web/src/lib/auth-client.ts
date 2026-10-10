'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { browserSupabase } from './supabase';

export function useSessionToken() {
  const [token, setToken] = useState<string | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);

  useEffect(() => {
    const client = browserSupabase();
    setSupabase(client);

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

  return { token, supabase };
}
