import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { RecipeView } from '@/components/RecipeView';
import type { Recipe } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RecipePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: recipe } = await supabase
    .from('recipes')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!recipe) notFound();

  const { data: lists } = await supabase
    .from('shopping_lists')
    .select('id, name')
    .order('created_at', { ascending: false });

  return <RecipeView recipe={recipe as Recipe} lists={lists || []} />;
}
