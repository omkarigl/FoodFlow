import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, serverError } from '@/lib/api-helpers';
import { getAuthContext } from '@/lib/server-auth';
import { serviceSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext();
    if (!auth.userId) return unauthorized();

    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');
    const supabase = serviceSupabase();

    const query = supabase
      .from('orders')
      .select('id,status,payment_status,total_paise,created_at,tracking_token')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false });

    if (from) query.gte('created_at', from);
    if (to) query.lte('created_at', to);

    const { data, error } = await query;
    if (error) return serverError('Unable to fetch order history');

    return NextResponse.json({ orders: data ?? [] });
  } catch {
    return serverError();
  }
}
