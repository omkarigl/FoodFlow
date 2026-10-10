import { NextRequest, NextResponse } from 'next/server';
import { serviceSupabase } from '@/lib/supabase';
import { serverError } from '@/lib/api-helpers';

export async function GET(request: NextRequest) {
  try {
    const category = request.nextUrl.searchParams.get('category');
    const includeUnavailable = request.nextUrl.searchParams.get('includeUnavailable') === 'true';
    const supabase = serviceSupabase();

    const categoriesQuery = supabase
      .from('menu_categories')
      .select('id,name,sort_order')
      .order('sort_order', { ascending: true });

    const itemsQuery = supabase
      .from('menu_items')
      .select('id,name,description,price_paise,is_available,category_id')
      .order('name', { ascending: true });

    if (category) itemsQuery.eq('category_id', category);
    if (!includeUnavailable) itemsQuery.eq('is_available', true);

    const [{ data: categories, error: catError }, { data: items, error: itemError }] = await Promise.all([
      categoriesQuery,
      itemsQuery,
    ]);

    if (catError || itemError) {
      return serverError('Unable to load menu');
    }

    return NextResponse.json({
      categories: (categories ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sort_order,
      })),
      items: (items ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        pricePaise: i.price_paise,
        isAvailable: i.is_available,
        categoryId: i.category_id,
      })),
    });
  } catch {
    return serverError('Menu API unavailable. Check Supabase configuration.');
  }
}
