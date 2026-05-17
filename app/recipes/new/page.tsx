'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { ParsedRecipe } from '@/lib/types';

export default function NewRecipePage() {
  const router = useRouter();

  const [step, setStep] = useState<'input' | 'review'>('input');
  const [tab, setTab] = useState<'paste' | 'image'>('paste');
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [modificationRequest, setModificationRequest] = useState('');
  const [parsed, setParsed] = useState<ParsedRecipe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    setError(null);
    setLoading(true);
    try {
      let res: Response;
      if (tab === 'paste') {
        if (!text.trim()) throw new Error('Paste a recipe first.');
        res = await fetch('/api/parse-recipe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, modificationRequest: modificationRequest || undefined }),
        });
      } else {
        if (!imageFile) throw new Error('Choose an image first.');
        const data = await fileToBase64(imageFile);
        res = await fetch('/api/parse-recipe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            image: { mediaType: imageFile.type, data },
            modificationRequest: modificationRequest || undefined,
          }),
        });
      }
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to parse recipe');
      const data = (await res.json()) as ParsedRecipe;
      setParsed(data);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!parsed) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('recipes')
        .insert({
          user_id: user.id,
          title: parsed.title,
          description: parsed.description,
          servings: parsed.servings,
          ingredients: parsed.ingredients,
          instructions: parsed.instructions,
          modification_request: modificationRequest || null,
        })
        .select('id')
        .single();
      if (error) throw error;
      router.push(`/recipes/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'review' && parsed) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Review parsed recipe</h1>
        <p className="mt-1 text-sm text-stone-600">Edit anything that doesn&apos;t look right, then save.</p>

        <div className="mt-6 space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
          <label className="block">
            <span className="text-sm font-medium">Title</span>
            <input
              value={parsed.title}
              onChange={(e) => setParsed({ ...parsed, title: e.target.value })}
              className="input mt-1"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Servings</span>
            <input
              value={parsed.servings || ''}
              onChange={(e) => setParsed({ ...parsed, servings: e.target.value })}
              className="input mt-1"
            />
          </label>

          <div>
            <span className="text-sm font-medium">Ingredients</span>
            <ul className="mt-2 space-y-2">
              {parsed.ingredients.map((ing, i) => (
                <li key={i} className="flex gap-2 items-center">
                  <input
                    placeholder="qty"
                    value={ing.quantity || ''}
                    onChange={(e) => {
                      const copy = [...parsed.ingredients];
                      copy[i] = { ...copy[i], quantity: e.target.value };
                      setParsed({ ...parsed, ingredients: copy });
                    }}
                    className="input w-20"
                  />
                  <input
                    placeholder="unit"
                    value={ing.unit || ''}
                    onChange={(e) => {
                      const copy = [...parsed.ingredients];
                      copy[i] = { ...copy[i], unit: e.target.value };
                      setParsed({ ...parsed, ingredients: copy });
                    }}
                    className="input w-24"
                  />
                  <input
                    placeholder="ingredient"
                    value={ing.name}
                    onChange={(e) => {
                      const copy = [...parsed.ingredients];
                      copy[i] = { ...copy[i], name: e.target.value };
                      setParsed({ ...parsed, ingredients: copy });
                    }}
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const copy = parsed.ingredients.filter((_, j) => j !== i);
                      setParsed({ ...parsed, ingredients: copy });
                    }}
                    className="text-stone-400 hover:text-red-600 px-2"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                setParsed({
                  ...parsed,
                  ingredients: [...parsed.ingredients, { name: '', quantity: '', unit: '' }],
                })
              }
              className="mt-2 text-sm text-stone-700 hover:underline"
            >
              + Add ingredient
            </button>
          </div>

          <label className="block">
            <span className="text-sm font-medium">Instructions</span>
            <textarea
              rows={10}
              value={parsed.instructions}
              onChange={(e) => setParsed({ ...parsed, instructions: e.target.value })}
              className="input mt-1 font-mono text-sm"
            />
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button onClick={save} disabled={loading} className="btn-primary">
            {loading ? 'Saving…' : 'Save recipe'}
          </button>
          <button onClick={() => setStep('input')} className="btn-secondary">
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">New recipe</h1>
      <p className="mt-1 text-sm text-stone-600">
        Paste a recipe or upload a photo. Optionally ask Claude to modify it (e.g. &ldquo;make it dairy-free&rdquo;).
      </p>

      <div className="mt-4 flex gap-2 text-sm">
        <button
          onClick={() => setTab('paste')}
          className={`rounded-full px-3 py-1 ${tab === 'paste' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-300'}`}
        >
          Paste text
        </button>
        <button
          onClick={() => setTab('image')}
          className={`rounded-full px-3 py-1 ${tab === 'image' ? 'bg-stone-900 text-white' : 'bg-white border border-stone-300'}`}
        >
          Upload photo
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5">
        {tab === 'paste' ? (
          <textarea
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your recipe here — ingredients, instructions, everything."
            className="input font-mono text-sm"
          />
        ) : (
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(e) => setImageFile(e.target.files?.[0] || null)}
            className="block w-full text-sm"
          />
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5">
        <label className="block">
          <span className="text-sm font-medium">Modification request (optional)</span>
          <p className="mt-0.5 text-xs text-stone-500">
            e.g. &ldquo;make it dairy-free&rdquo;, &ldquo;halve the sugar&rdquo;, &ldquo;serve 8 instead of 4&rdquo;
          </p>
          <input
            value={modificationRequest}
            onChange={(e) => setModificationRequest(e.target.value)}
            className="input mt-2"
            placeholder="Leave blank to save as-is"
          />
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4">
        <button onClick={parse} disabled={loading} className="btn-primary">
          {loading ? 'Parsing with Claude…' : 'Parse recipe'}
        </button>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
