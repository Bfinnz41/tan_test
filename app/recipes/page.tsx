import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Recipe } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: { favorites?: string };
}) {
  const supabase = createClient();
  let query = supabase
    .from('recipes')
    .select('*')
    .order('created_at', { ascending: false });

  if (searchParams.favorites) query = query.eq('is_favorite', true);

  const { data: recipes } = await query;

  const onlyFavs = !!searchParams.favorites;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{onlyFavs ? 'Favorite recipes' : 'My recipes'}</h1>
        <Link href="/recipes/new" className="btn-primary">
          + New recipe
        </Link>
      </div>

      <div className="mt-4 flex gap-2 text-sm">
        <Link
          href="/recipes"
          className={`rounded-full px-3 py-1 ${!onlyFavs ? 'bg-stone-900 text-white' : 'bg-white border border-stone-300'}`}
        >
          All
        </Link>
        <Link
          href="/recipes?favorites=1"
          className={`rounded-full px-3 py-1 ${onlyFavs ? 'bg-stone-900 text-white' : 'bg-white border border-stone-300'}`}
        >
          ★ Favorites
        </Link>
      </div>

      {!recipes || recipes.length === 0 ? (
        <div className="mt-12 rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center">
          <p className="text-stone-600">No recipes yet.</p>
          <Link href="/recipes/new" className="btn-primary mt-4">
            Add your first recipe
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {(recipes as Recipe[]).map((r) => (
            <li key={r.id}>
              <Link
                href={`/recipes/${r.id}`}
                className="block rounded-2xl border border-stone-200 bg-white p-4 hover:border-stone-400"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium">{r.title}</h3>
                  {r.is_favorite && <span title="Favorite">★</span>}
                </div>
                {r.description && (
                  <p className="mt-1 text-sm text-stone-600 line-clamp-2">{r.description}</p>
                )}
                <p className="mt-2 text-xs text-stone-500">
                  {r.ingredients.length} ingredients
                  {r.parent_recipe_id && ' · modified'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
