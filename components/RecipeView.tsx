'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Recipe } from '@/lib/types';

export function RecipeView({
  recipe,
  lists,
}: {
  recipe: Recipe;
  lists: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [isFav, setIsFav] = useState(recipe.is_favorite);
  const [pending, startTransition] = useTransition();

  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyText, setModifyText] = useState('');
  const [modifying, setModifying] = useState(false);
  const [modifyError, setModifyError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [selectedListId, setSelectedListId] = useState(lists[0]?.id || '');
  const [newListName, setNewListName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedToListId, setAddedToListId] = useState<string | null>(null);

  async function toggleFavorite() {
    const next = !isFav;
    setIsFav(next);
    const { error } = await supabase
      .from('recipes')
      .update({ is_favorite: next })
      .eq('id', recipe.id);
    if (error) setIsFav(!next);
  }

  async function deleteRecipe() {
    if (!confirm('Delete this recipe?')) return;
    startTransition(async () => {
      await supabase.from('recipes').delete().eq('id', recipe.id);
      router.push('/recipes');
      router.refresh();
    });
  }

  async function applyModification() {
    if (!modifyText.trim()) return;
    setModifying(true);
    setModifyError(null);
    try {
      const res = await fetch('/api/modify-recipe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeId: recipe.id, request: modifyText }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const { recipeId } = (await res.json()) as { recipeId: string };
      router.push(`/recipes/${recipeId}`);
      router.refresh();
    } catch (e) {
      setModifyError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setModifying(false);
    }
  }

  async function addToList() {
    setAdding(true);
    setAddError(null);
    setAddedToListId(null);
    try {
      let listId = selectedListId;
      if (!listId) {
        const res = await fetch('/api/lists', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: newListName || 'Shopping List' }),
        });
        if (!res.ok) throw new Error('Could not create list');
        listId = (await res.json()).id;
      }
      const res = await fetch(`/api/lists/${listId}/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeIds: [recipe.id] }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Could not add items');
      setAddedToListId(listId);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{recipe.title}</h1>
          {recipe.description && <p className="mt-2 text-stone-600">{recipe.description}</p>}
          {recipe.servings && <p className="mt-1 text-sm text-stone-500">Serves {recipe.servings}</p>}
          {recipe.parent_recipe_id && (
            <p className="mt-1 text-xs text-stone-500">
              Modified from{' '}
              <Link href={`/recipes/${recipe.parent_recipe_id}`} className="underline">
                another recipe
              </Link>
              {recipe.modification_request && ` — "${recipe.modification_request}"`}
            </p>
          )}
        </div>
        <button
          onClick={toggleFavorite}
          className="text-2xl"
          aria-label={isFav ? 'Remove from favorites' : 'Save to favorites'}
        >
          {isFav ? '★' : '☆'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => setAddOpen(true)} className="btn-primary">
          Add to shopping list
        </button>
        <button onClick={() => setModifyOpen(true)} className="btn-secondary">
          Modify with AI
        </button>
        <button onClick={deleteRecipe} disabled={pending} className="btn-ghost text-red-600">
          Delete
        </button>
      </div>

      {modifyOpen && (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5">
          <h3 className="font-medium">Modify recipe</h3>
          <p className="mt-1 text-xs text-stone-500">
            Examples: &ldquo;make it dairy-free&rdquo;, &ldquo;serve 8 instead of 4&rdquo;, &ldquo;swap salmon for chicken&rdquo;
          </p>
          <input
            value={modifyText}
            onChange={(e) => setModifyText(e.target.value)}
            placeholder="What should change?"
            className="input mt-3"
            autoFocus
          />
          {modifyError && <p className="mt-2 text-sm text-red-600">{modifyError}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={applyModification} disabled={modifying} className="btn-primary">
              {modifying ? 'Modifying…' : 'Create modified version'}
            </button>
            <button
              onClick={() => {
                setModifyOpen(false);
                setModifyText('');
              }}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {addOpen && (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5">
          <h3 className="font-medium">Add ingredients to a shopping list</h3>
          {lists.length > 0 ? (
            <select
              value={selectedListId}
              onChange={(e) => setSelectedListId(e.target.value)}
              className="input mt-3"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="">+ New list…</option>
            </select>
          ) : (
            <p className="mt-2 text-sm text-stone-500">No lists yet — we&apos;ll create one.</p>
          )}
          {(!selectedListId || lists.length === 0) && (
            <input
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              placeholder="New list name"
              className="input mt-3"
            />
          )}
          {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
          {addedToListId && (
            <p className="mt-2 text-sm text-emerald-700">
              Added!{' '}
              <Link href={`/lists/${addedToListId}`} className="underline">
                Open list
              </Link>
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={addToList} disabled={adding} className="btn-primary">
              {adding ? 'Adding…' : 'Add'}
            </button>
            <button onClick={() => setAddOpen(false)} className="btn-secondary">
              Close
            </button>
          </div>
        </div>
      )}

      <section className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="font-semibold">Ingredients</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-stone-500 min-w-fit">
                  {[ing.quantity, ing.unit].filter(Boolean).join(' ')}
                </span>
                <span>
                  {ing.name}
                  {ing.notes && <span className="text-stone-500"> — {ing.notes}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="font-semibold">Instructions</h2>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
            {recipe.instructions || <span className="text-stone-400">No instructions.</span>}
          </div>
        </div>
      </section>
    </div>
  );
}
