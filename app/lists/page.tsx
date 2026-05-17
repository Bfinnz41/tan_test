import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { NewListButton } from '@/components/NewListButton';

export const dynamic = 'force-dynamic';

export default async function ListsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: lists } = await supabase
    .from('shopping_lists')
    .select('id, name, owner_id, created_at')
    .order('created_at', { ascending: false });

  // Item counts in one query
  const ids = (lists || []).map((l) => l.id);
  const counts: Record<string, { total: number; checked: number }> = {};
  if (ids.length) {
    const { data: items } = await supabase
      .from('shopping_list_items')
      .select('list_id, checked')
      .in('list_id', ids);
    for (const it of items || []) {
      counts[it.list_id] = counts[it.list_id] || { total: 0, checked: 0 };
      counts[it.list_id].total++;
      if (it.checked) counts[it.list_id].checked++;
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shopping lists</h1>
        <NewListButton />
      </div>

      {!lists || lists.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center text-stone-600">
          No lists yet. Add a recipe and then click <span className="font-medium">Add to shopping list</span>.
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {lists.map((l) => {
            const c = counts[l.id] || { total: 0, checked: 0 };
            const shared = l.owner_id !== user?.id;
            return (
              <li key={l.id}>
                <Link
                  href={`/lists/${l.id}`}
                  className="block rounded-2xl border border-stone-200 bg-white p-4 hover:border-stone-400"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{l.name}</h3>
                    {shared && (
                      <span className="text-xs text-stone-500 bg-stone-100 rounded-full px-2 py-0.5">
                        Shared with me
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-stone-500">
                    {c.checked}/{c.total} checked
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
