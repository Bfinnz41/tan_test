import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { email, permission } = (await req.json()) as {
    email?: string;
    permission?: 'edit' | 'view';
  };
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

  // Make sure caller owns the list (RLS will also enforce this on insert).
  const { data: list } = await supabase
    .from('shopping_lists')
    .select('id, owner_id')
    .eq('id', params.id)
    .single();
  if (!list || list.owner_id !== user.id) {
    return NextResponse.json({ error: 'Only the owner can share this list' }, { status: 403 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  if (!profile) {
    return NextResponse.json(
      { error: `No Pantry account found for ${email}. Ask them to sign up first.` },
      { status: 404 },
    );
  }

  const { error } = await supabase.from('list_shares').insert({
    list_id: params.id,
    user_id: profile.id,
    permission: permission === 'view' ? 'view' : 'edit',
  });
  if (error && !error.message.includes('duplicate')) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId } = (await req.json()) as { userId: string };
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const { error } = await supabase
    .from('list_shares')
    .delete()
    .eq('list_id', params.id)
    .eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
