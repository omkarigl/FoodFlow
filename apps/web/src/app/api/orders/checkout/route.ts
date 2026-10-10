import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { badRequest, serverError } from '@/lib/api-helpers';
import { checkoutSchema } from '@/lib/schema';
import { priceCart } from '@/lib/pricing';
import { getAuthContext } from '@/lib/server-auth';
import { serviceSupabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const payload = checkoutSchema.parse(await request.json());
    const auth = await getAuthContext();
    const supabase = serviceSupabase();

    const { data: existing } = await supabase
      .from('orders')
      .select('id,tracking_token,total_paise,payment_status,status')
      .eq('idempotency_key', payload.idempotencyKey)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        id: existing.id,
        trackingToken: existing.tracking_token,
        totalPaise: existing.total_paise,
        paymentStatus: existing.payment_status,
        status: existing.status,
        duplicate: true,
      });
    }

    const itemIds = payload.lines.map((line) => line.itemId);
    const { data: items, error: itemsError } = await supabase
      .from('menu_items')
      .select('id,name,price_paise,is_available')
      .in('id', itemIds);

    if (itemsError || !items) return serverError('Unable to validate cart');

    const { priced, subtotalPaise } = priceCart(
      payload.lines,
      items.map((i) => ({
        id: i.id,
        name: i.name,
        pricePaise: i.price_paise,
        isAvailable: i.is_available,
      }))
    );

    if (!priced.length) return badRequest('No valid available items in cart');

    const trackingToken = crypto.randomBytes(16).toString('hex');

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: auth.userId,
        guest_name: auth.userId ? null : payload.guestName ?? null,
        guest_phone: auth.userId ? null : payload.guestPhone ?? null,
        note: payload.note ?? null,
        total_paise: subtotalPaise,
        payment_status: 'pending',
        status: 'pending',
        tracking_token: trackingToken,
        idempotency_key: payload.idempotencyKey,
      })
      .select('id,status,payment_status,total_paise,tracking_token')
      .single();

    if (orderError || !order) return serverError('Unable to create order');

    const lineRows = priced.map((line) => ({
      order_id: order.id,
      menu_item_id: line.itemId,
      quantity: line.quantity,
      unit_price_paise: line.unitPricePaise,
      line_total_paise: line.lineTotalPaise,
    }));

    const { error: linesError } = await supabase.from('order_lines').insert(lineRows);
    if (linesError) return serverError('Unable to persist order lines');

    return NextResponse.json({
      id: order.id,
      status: order.status,
      paymentStatus: order.payment_status,
      totalPaise: order.total_paise,
      trackingToken: order.tracking_token,
      duplicate: false,
    });
  } catch {
    return badRequest('Invalid checkout payload');
  }
}
