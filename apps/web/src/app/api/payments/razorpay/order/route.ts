import Razorpay from 'razorpay';
import { NextRequest, NextResponse } from 'next/server';
import { badRequest, serverError } from '@/lib/api-helpers';
import { getAuthContext } from '@/lib/server-auth';
import { optionalEnv } from '@/lib/env';
import { serviceSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orderId = body.orderId as string | undefined;
    if (!orderId) return badRequest('orderId is required');

    const keyId = optionalEnv('RAZORPAY_KEY_ID');
    const keySecret = optionalEnv('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) {
      return serverError('Razorpay configuration is missing');
    }

    const auth = await getAuthContext();
    const supabase = serviceSupabase();

    const { data: order, error } = await supabase
      .from('orders')
      .select('id,user_id,total_paise,payment_status')
      .eq('id', orderId)
      .single();

    if (error || !order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    if (order.user_id && auth.userId !== order.user_id && auth.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const rpOrder = await razorpay.orders.create({
      amount: order.total_paise,
      currency: 'INR',
      receipt: order.id,
      notes: { foodflowOrderId: order.id },
    });

    await supabase
      .from('payments')
      .insert({ order_id: order.id, provider: 'razorpay', provider_order_id: rpOrder.id, status: 'pending' });

    return NextResponse.json({
      keyId,
      razorpayOrderId: rpOrder.id,
      amount: rpOrder.amount,
      currency: rpOrder.currency,
    });
  } catch {
    return serverError('Unable to create Razorpay order');
  }
}
