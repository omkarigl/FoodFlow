import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { badRequest, serverError } from '@/lib/api-helpers';
import { optionalEnv } from '@/lib/env';
import { serviceSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = await request.json();

    if (!orderId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return badRequest('Payment verification payload is incomplete');
    }

    const keySecret = optionalEnv('RAZORPAY_KEY_SECRET');
    if (!keySecret) return serverError('Razorpay verification key missing');

    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const supabase = serviceSupabase();
    if (expected !== razorpaySignature) {
      await supabase
        .from('payments')
        .update({ status: 'failed' })
        .eq('provider_order_id', razorpayOrderId)
        .eq('order_id', orderId);
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    await supabase.from('payments').upsert(
      {
        order_id: orderId,
        provider: 'razorpay',
        provider_order_id: razorpayOrderId,
        provider_payment_id: razorpayPaymentId,
        status: 'verified',
      },
      { onConflict: 'provider_order_id' }
    );

    await supabase.from('orders').update({ payment_status: 'verified', status: 'confirmed' }).eq('id', orderId);

    return NextResponse.json({ verified: true });
  } catch {
    return serverError('Unable to verify payment');
  }
}
