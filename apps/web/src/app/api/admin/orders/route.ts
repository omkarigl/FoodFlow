import { NextResponse } from 'next/server';
import { forbidden, serverError } from '@/lib/api-helpers';
import { getAuthContext } from '@/lib/server-auth';
import { serviceSupabase } from '@/lib/supabase';

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (auth.role !== 'admin') return forbidden();

    const supabase = serviceSupabase();
    const { data, error } = await supabase
      .from('orders')
      .select('id,status,payment_status,total_paise,created_at,user_id,guest_name')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) return serverError('Unable to fetch orders');
    return NextResponse.json({ orders: data ?? [] });
  } catch {
    return serverError();
  }
}
