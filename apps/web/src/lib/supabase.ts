import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { optionalEnv, requireEnv } from './env';

let browserClient: SupabaseClient | null = null;

export const browserSupabase = () => {
  if (!browserClient) {
    browserClient = createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return browserClient;
};

export const serviceSupabase = () => {
  const serviceRole = optionalEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRole) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server routes.');
  }

  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};
