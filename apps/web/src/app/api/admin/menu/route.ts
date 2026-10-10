import { NextRequest, NextResponse } from 'next/server';
import { badRequest, forbidden, serverError } from '@/lib/api-helpers';
import { adminMenuSchema } from '@/lib/schema';
import { getAuthContext } from '@/lib/server-auth';
import { serviceSupabase } from '@/lib/supabase';

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (auth.role !== 'admin') return forbidden();

    const supabase = serviceSupabase();
    const { data, error } = await supabase
      .from('menu_items')
      .select('id,name,description,price_paise,is_available,category_id,created_at')
      .order('created_at', { ascending: false });

    if (error) return serverError('Unable to fetch menu items');
    return NextResponse.json({ items: data ?? [] });
  } catch {
    return serverError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext();
    if (auth.role !== 'admin') return forbidden();

    const payload = adminMenuSchema.parse(await request.json());
    const supabase = serviceSupabase();

    const { data, error } = await supabase
      .from('menu_items')
      .insert({
        name: payload.name,
        category_id: payload.categoryId,
        description: payload.description ?? null,
        price_paise: payload.pricePaise,
        is_available: payload.isAvailable ?? true,
      })
      .select('id,name,category_id,price_paise,is_available')
      .single();

    if (error) return serverError('Unable to create menu item');
    return NextResponse.json({ item: data }, { status: 201 });
  } catch {
    return badRequest('Invalid menu payload');
  }
}
