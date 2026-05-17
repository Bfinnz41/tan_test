import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { modifyRecipe } from '@/lib/anthropic';
import type { Recipe } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { recipeId, request } = await req.json();
  if (!recipeId || !request) {
    return NextResponse.json({ error: 'recipeId and request are required' }, { status: 400 });
  }

  const { data: recipe, error } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', recipeId)
    .single();
  if (error || !recipe) return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });

  const r = recipe as Recipe;

  try {
    const modified = await modifyRecipe(
      {
        title: r.title,
        description: r.description,
        servings: r.servings,
        ingredients: r.ingredients,
        instructions: r.instructions,
      },
      request,
    );

    const { data: inserted, error: insertError } = await supabase
      .from('recipes')
      .insert({
        user_id: user.id,
        title: modified.title,
        description: modified.description,
        servings: modified.servings,
        ingredients: modified.ingredients,
        instructions: modified.instructions,
        parent_recipe_id: r.id,
        modification_request: request,
      })
      .select('id')
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ recipeId: inserted.id });
  } catch (err) {
    console.error('modify-recipe error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
