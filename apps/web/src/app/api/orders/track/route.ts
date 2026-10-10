import { NextRequest, NextResponse } from 'next/server';
import { badRequest, forbidden, serverError } from '@/lib/api-helpers';
import { getAuthContext } from '@/lib/server-auth';
import { serviceSupabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    if (!token) return badRequest('Tracking token is required');

    const auth = await getAuthContext();
    const supabase = serviceSupabase();

    const { data: order, error } = await supabase
      .from('orders')
      .select('id,user_id,guest_name,status,payment_status,total_paise,created_at,tracking_token')
      .eq('tracking_token', token)
      .maybeSingle();

    if (error) return serverError('Unable to fetch order');
    if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    if (order.user_id && auth.userId !== order.user_id && auth.role !== 'admin') return forbidden();

    return NextResponse.json({
      id: order.id,
      guestName: order.guest_name,
      status: order.status,
      paymentStatus: order.payment_status,
      totalPaise: order.total_paise,
      createdAt: order.created_at,
      trackingToken: order.tracking_token,
    });
  } catch {
    return serverError();
  }
}
