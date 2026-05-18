'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { ParsedRecipe } from '@/lib/types';

type Tab = 'paste' | 'url' | 'image' | 'pdf';

export default function NewRecipePage() {
  const router = useRouter();

  const [step, setStep] = useState<'input' | 'review'>('input');
  const [tab, setTab] = useState<Tab>('paste');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [cookies, setCookies] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [modificationRequest, setModificationRequest] = useState('');
  const [parsed, setParsed] = useState<ParsedRecipe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    setError(null);
    setLoading(true);
    try {
      let payload: Record<string, unknown>;
      if (tab === 'paste') {
        if (!text.trim()) throw new Error('Paste a recipe first.');
        payload = { text };
      } else if (tab === 'url') {
        if (!url.trim()) throw new Error('Enter a URL.');
        payload = { url: { url: url.trim(), cookies: cookies.trim() || undefined } };
      } else if (tab === 'image') {
        if (!imageFile) throw new Error('Choose an image first.');
        const data = await fileToBase64(imageFile);
        payload = { image: { mediaType: imageFile.type, data } };
      } else {
        if (!pdfFile) throw new Error('Choose a PDF first.');
        const data = await fileToBase64(pdfFile);
        payload = { pdf: { data } };
      }
      if (modificationRequest.trim()) payload.modificationRequest = modificationRequest;

      const res = await fetch('/api/parse-recipe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
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
          source_url: tab === 'url' ? url : null,
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
        Paste text, link a URL, or upload a photo or PDF. Optionally ask Claude to modify it.
      </p>

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {(['paste', 'url', 'pdf', 'image'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 ${tab === t ? 'bg-stone-900 text-white' : 'bg-white border border-stone-300'}`}
          >
            {t === 'paste' && 'Paste text'}
            {t === 'url' && 'From URL'}
            {t === 'pdf' && 'Upload PDF'}
            {t === 'image' && 'Photo'}
          </button>
        ))}
      </div>

      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5">
        {tab === 'paste' && (
          <textarea
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your recipe here — ingredients, instructions, everything."
            className="input font-mono text-sm"
          />
        )}

        {tab === 'url' && (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Recipe URL</span>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://cooking.example.com/some-recipe"
                className="input mt-1"
              />
            </label>

            <p className="text-xs text-stone-500">
              <button
                type="button"
                onClick={() => setShowAdvanced((s) => !s)}
                className="underline hover:text-stone-900"
              >
                Behind a paywall or login wall?
              </button>
            </p>

            {showAdvanced && (
              <div className="rounded-lg bg-stone-50 p-3 border border-stone-200">
                <p className="text-xs text-stone-600">
                  <strong>Best option:</strong> open the page in your browser (where you&apos;re already logged in), use <em>Print &rarr; Save as PDF</em>, and upload the PDF in the &ldquo;Upload PDF&rdquo; tab instead. That avoids us touching your account.
                </p>
                <p className="mt-2 text-xs text-stone-600">
                  <strong>Or:</strong> paste your session cookies for that site below. Open DevTools (F12) on the recipe page, go to Application → Cookies, and copy the <code>cookie</code> request header value (looks like <code>name1=value1; name2=value2</code>).
                </p>
                <p className="mt-2 text-xs text-amber-700">
                  ⚠️ Cookies grant access to your account. Only paste them if you trust this app, and only for sites where you understand the risk. Session cookies are sent to the recipe site server-side and not stored anywhere.
                </p>
                <textarea
                  rows={3}
                  value={cookies}
                  onChange={(e) => setCookies(e.target.value)}
                  placeholder="session=abc123; auth=xyz; ..."
                  className="input mt-2 font-mono text-xs"
                />
              </div>
            )}
          </div>
        )}

        {tab === 'pdf' && (
          <div>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
              className="block w-full text-sm"
            />
            <p className="mt-2 text-xs text-stone-500">
              Tip: from any recipe website, use <em>Print → Save as PDF</em> and upload the result here. Works for paywalled sites too.
            </p>
          </div>
        )}

        {tab === 'image' && (
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
