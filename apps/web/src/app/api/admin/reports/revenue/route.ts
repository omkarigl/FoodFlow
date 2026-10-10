import { NextRequest, NextResponse } from 'next/server';
import { forbidden, serverError } from '@/lib/api-helpers';
import { getAuthContext } from '@/lib/server-auth';
import { serviceSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext();
    if (auth.role !== 'admin') return forbidden();

    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');

    const supabase = serviceSupabase();
    const query = supabase
      .from('orders')
      .select('id,total_paise,payment_status,created_at,status')
      .eq('payment_status', 'verified')
      .order('created_at', { ascending: false });

    if (from) query.gte('created_at', from);
    if (to) query.lte('created_at', to);

    const { data, error } = await query;
    if (error) return serverError('Unable to load revenue report');

    const rows = data ?? [];
    const grossPaise = rows.reduce((sum, row) => sum + row.total_paise, 0);

    return NextResponse.json({
      grossPaise,
      ordersCount: rows.length,
      rows,
    });
  } catch {
    return serverError();
  }
}
