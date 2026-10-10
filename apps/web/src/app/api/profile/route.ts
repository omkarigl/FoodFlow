import { NextRequest, NextResponse } from 'next/server';
import { badRequest, unauthorized, serverError } from '@/lib/api-helpers';
import { getAuthContext } from '@/lib/server-auth';
import { serviceSupabase } from '@/lib/supabase';

export async function GET() {
  try {
    const auth = await getAuthContext();
    if (!auth.userId) return unauthorized();

    const supabase = serviceSupabase();
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,role,student_id,created_at')
      .eq('id', auth.userId)
      .single();

    if (error) return serverError('Unable to fetch profile');
    return NextResponse.json({ profile: data });
  } catch {
    return serverError();
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthContext();
    if (!auth.userId) return unauthorized();

    const { studentId } = await request.json();
    if (typeof studentId !== 'string' || studentId.length > 50) return badRequest('Invalid studentId');

    const supabase = serviceSupabase();
    const { data, error } = await supabase
      .from('profiles')
      .update({ student_id: studentId.trim() || null })
      .eq('id', auth.userId)
      .select('id,student_id')
      .single();

    if (error) return serverError('Unable to update profile');
    return NextResponse.json({ profile: data });
  } catch {
    return serverError();
  }
}
