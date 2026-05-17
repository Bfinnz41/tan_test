import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { consolidateIngredients } from '@/lib/anthropic';
import type { Recipe, Ingredient } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { recipeIds, items } = (await req.json()) as {
    recipeIds?: string[];
    items?: Ingredient[];
  };

  if (!recipeIds?.length && !items?.length) {
    return NextResponse.json({ error: 'Provide recipeIds or items' }, { status: 400 });
  }

  const { data: list } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('id', params.id)
    .single();
  if (!list) return NextResponse.json({ error: 'List not found' }, { status: 404 });

  let toInsert: Ingredient[] = items || [];
  let recipeIdsForItems: string[] = [];

  if (recipeIds?.length) {
    const { data: recipes } = await supabase
      .from('recipes')
      .select('*')
      .in('id', recipeIds);
    if (!recipes) return NextResponse.json({ error: 'Recipes not found' }, { status: 404 });

    recipeIdsForItems = recipes.map((r) => r.id);

    const groups = (recipes as Recipe[]).map((r) => ({
      recipeTitle: r.title,
      ingredients: r.ingredients,
    }));

    try {
      toInsert = await consolidateIngredients(groups);
    } catch (err) {
      console.error('consolidate error, falling back to flat list', err);
      toInsert = groups.flatMap((g) => g.ingredients);
    }
  }

  const rows = toInsert
    .filter((i) => i.name?.trim())
    .map((i) => ({
      list_id: params.id,
      name: i.name.trim(),
      quantity: i.quantity?.trim() || null,
      unit: i.unit?.trim() || null,
      category: i.category?.trim().toLowerCase() || 'other',
      notes: i.notes?.trim() || null,
      added_by: user.id,
      recipe_ids: recipeIdsForItems,
    }));

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  const { error: insertError } = await supabase.from('shopping_list_items').insert(rows);
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: rows.length });
}
