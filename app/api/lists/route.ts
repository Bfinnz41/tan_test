import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = (await req.json().catch(() => ({}))) as { name?: string };

  const { data, error } = await supabase
    .from('shopping_lists')
    .insert({ owner_id: user.id, name: name?.trim() || 'Shopping List' })
    .select('id, name')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
