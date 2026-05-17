import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { ShoppingListView } from '@/components/ShoppingListView';
import type { ShoppingList, ShoppingListItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ListPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: list } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('id', params.id)
    .single();
  if (!list) notFound();

  const { data: items } = await supabase
    .from('shopping_list_items')
    .select('*')
    .eq('list_id', params.id)
    .order('category', { ascending: true })
    .order('created_at', { ascending: true });

  const { data: shares } = await supabase
    .from('list_shares')
    .select('user_id, permission, profiles!list_shares_user_id_fkey(email, display_name)')
    .eq('list_id', params.id);

  return (
    <ShoppingListView
      list={list as ShoppingList}
      initialItems={(items || []) as ShoppingListItem[]}
      isOwner={list.owner_id === user?.id}
      shares={(shares || []).map((s) => {
        const profile = Array.isArray(s.profiles) ? s.profiles[0] : s.profiles;
        return {
          user_id: s.user_id as string,
          permission: s.permission as 'edit' | 'view',
          email: profile?.email ?? '',
          display_name: profile?.display_name ?? null,
        };
      })}
      currentUserId={user?.id ?? null}
    />
  );
}
