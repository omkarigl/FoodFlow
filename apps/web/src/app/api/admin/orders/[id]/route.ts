import { NextRequest, NextResponse } from 'next/server';
import { badRequest, forbidden, serverError } from '@/lib/api-helpers';
import { orderStatusSchema } from '@/lib/schema';
import { getAuthContext } from '@/lib/server-auth';
import { serviceSupabase } from '@/lib/supabase';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthContext();
    if (auth.role !== 'admin') return forbidden();

    const { status } = orderStatusSchema.parse(await request.json());
    const { id } = await params;

    const supabase = serviceSupabase();
    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', id)
      .select('id,status,payment_status')
      .single();

    if (error) return serverError('Unable to update order status');
    return NextResponse.json({ order: data });
  } catch {
    return badRequest('Invalid status payload');
  }
}
