import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';

// Generate (or rotate) the share_token on a list.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { rotate } = (await req.json().catch(() => ({}))) as { rotate?: boolean };

  // Make sure caller owns the list (RLS would block update otherwise; check explicitly for a nicer error)
  const { data: list } = await supabase
    .from('shopping_lists')
    .select('id, owner_id, share_token')
    .eq('id', params.id)
    .single();
  if (!list || list.owner_id !== user.id) {
    return NextResponse.json({ error: 'Only the owner can create a share link' }, { status: 403 });
  }

  let token = list.share_token as string | null;
  if (!token || rotate) {
    token = randomUUID();
    const { error } = await supabase
      .from('shopping_lists')
      .update({ share_token: token })
      .eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ token });
}

// Revoke the share token (anyone with the old link loses access).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: list } = await supabase
    .from('shopping_lists')
    .select('id, owner_id')
    .eq('id', params.id)
    .single();
  if (!list || list.owner_id !== user.id) {
    return NextResponse.json({ error: 'Only the owner can revoke the share link' }, { status: 403 });
  }

  const { error } = await supabase
    .from('shopping_lists')
    .update({ share_token: null })
    .eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
