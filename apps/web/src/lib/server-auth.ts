import { headers } from 'next/headers';
import { serviceSupabase } from './supabase';

export type AuthContext = {
  userId: string | null;
  role: 'student' | 'admin' | null;
};

export async function getAuthContext(): Promise<AuthContext> {
  const authHeader = (await headers()).get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return { userId: null, role: null };

  const token = authHeader.slice(7);
  const supabase = serviceSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) return { userId: null, role: null };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  return { userId: user.id, role: (profile?.role as 'student' | 'admin' | undefined) ?? 'student' };
}
