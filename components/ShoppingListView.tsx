'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { ShoppingList, ShoppingListItem } from '@/lib/types';

const CATEGORY_ORDER = [
  'produce',
  'meat',
  'deli',
  'dairy',
  'bakery',
  'frozen',
  'pantry',
  'beverages',
  'household',
  'other',
];

type Share = {
  user_id: string;
  permission: 'edit' | 'view';
  email: string;
  display_name: string | null;
};

export function ShoppingListView({
  list,
  initialItems,
  isOwner,
  shares,
  currentUserId,
}: {
  list: ShoppingList;
  initialItems: ShoppingListItem[];
  isOwner: boolean;
  shares: Share[];
  currentUserId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [items, setItems] = useState(initialItems);
  const [addingItem, setAddingItem] = useState('');
  const [shareEmail, setShareEmail] = useState('');
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareInfo, setShareInfo] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [alexaResult, setAlexaResult] = useState<string | null>(null);

  // Real-time sync
  useEffect(() => {
    const channel = supabase
      .channel(`list:${list.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_list_items', filter: `list_id=eq.${list.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setItems((cur) => {
              const next = payload.new as ShoppingListItem;
              if (cur.some((i) => i.id === next.id)) return cur;
              return [...cur, next];
            });
          } else if (payload.eventType === 'UPDATE') {
            const next = payload.new as ShoppingListItem;
            setItems((cur) => cur.map((i) => (i.id === next.id ? next : i)));
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as ShoppingListItem;
            setItems((cur) => cur.filter((i) => i.id !== old.id));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [list.id, supabase]);

  async function toggle(item: ShoppingListItem) {
    const next = !item.checked;
    setItems((cur) =>
      cur.map((i) =>
        i.id === item.id
          ? { ...i, checked: next, checked_by: currentUserId, checked_at: new Date().toISOString() }
          : i,
      ),
    );
    await supabase
      .from('shopping_list_items')
      .update({
        checked: next,
        checked_by: next ? currentUserId : null,
        checked_at: next ? new Date().toISOString() : null,
      })
      .eq('id', item.id);
  }

  async function deleteItem(item: ShoppingListItem) {
    setItems((cur) => cur.filter((i) => i.id !== item.id));
    await supabase.from('shopping_list_items').delete().eq('id', item.id);
  }

  async function addManual() {
    if (!addingItem.trim()) return;
    const name = addingItem.trim();
    setAddingItem('');
    const { data, error } = await supabase
      .from('shopping_list_items')
      .insert({
        list_id: list.id,
        name,
        category: 'other',
        added_by: currentUserId,
      })
      .select('*')
      .single();
    if (error) {
      console.error(error);
      return;
    }
    setItems((cur) => (cur.some((i) => i.id === data.id) ? cur : [...cur, data as ShoppingListItem]));
  }

  async function clearChecked() {
    const ids = items.filter((i) => i.checked).map((i) => i.id);
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} checked item${ids.length === 1 ? '' : 's'}?`)) return;
    await supabase.from('shopping_list_items').delete().in('id', ids);
    setItems((cur) => cur.filter((i) => !i.checked));
  }

  async function share() {
    setShareError(null);
    setShareInfo(null);
    const res = await fetch(`/api/lists/${list.id}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: shareEmail }),
    });
    const data = await res.json();
    if (!res.ok) {
      setShareError(data.error || 'Failed');
      return;
    }
    setShareInfo(`Shared with ${shareEmail}`);
    setShareEmail('');
    router.refresh();
  }

  async function getOrCreateShareLink(rotate = false) {
    setShareError(null);
    const res = await fetch(`/api/lists/${list.id}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rotate }),
    });
    const data = await res.json();
    if (!res.ok) {
      setShareError(data.error || 'Failed to create link');
      return;
    }
    setShareLink(`${window.location.origin}/lists/join/${data.token}`);
    setLinkCopied(false);
  }

  async function revokeLink() {
    if (!confirm('Anyone with the existing link will lose access. Continue?')) return;
    await fetch(`/api/lists/${list.id}/invite`, { method: 'DELETE' });
    setShareLink(null);
  }

  async function copyLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard may be blocked; user can copy manually
    }
  }

  function whatsappShare() {
    if (!shareLink) return;
    const text = `I shared my Pantry shopping list "${list.name}" with you: ${shareLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }

  async function unshare(userId: string) {
    if (!confirm('Remove this person from the list?')) return;
    await fetch(`/api/lists/${list.id}/share`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    router.refresh();
  }

  async function sendToAlexa() {
    setAlexaResult(null);
    const res = await fetch('/api/alexa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        listId: list.id,
        items: items.filter((i) => !i.checked).map((i) => ({ name: i.name, quantity: i.quantity || '' })),
      }),
    });
    const data = await res.json();
    setAlexaResult(data.message || (data.ok ? 'Sent to Alexa' : 'Failed'));
  }

  // Group by category
  const grouped: Record<string, ShoppingListItem[]> = {};
  for (const it of items) {
    const cat = (it.category || 'other').toLowerCase();
    (grouped[cat] = grouped[cat] || []).push(it);
  }
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const checkedCount = items.filter((i) => i.checked).length;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{list.name}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {checkedCount}/{items.length} checked
            {shares.length > 0 && ` · shared with ${shares.length}`}
          </p>
        </div>
        {isOwner && (
          <button onClick={() => setShowShare((s) => !s)} className="btn-secondary">
            Share
          </button>
        )}
      </div>

      {showShare && isOwner && (
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 space-y-5">
          <div>
            <h3 className="font-medium">Share with a link</h3>
            <p className="mt-1 text-xs text-stone-500">
              Anyone who opens this link will be added to the list. They sign up once with their email, then everything syncs in real time. Send via WhatsApp, text, anything.
            </p>
            {shareLink ? (
              <>
                <div className="mt-3 flex gap-2">
                  <input readOnly value={shareLink} className="input font-mono text-xs flex-1" />
                  <button onClick={copyLink} className="btn-secondary">
                    {linkCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <button onClick={whatsappShare} className="rounded-full bg-emerald-600 text-white px-3 py-1 hover:bg-emerald-700">
                    Send via WhatsApp
                  </button>
                  <button onClick={() => getOrCreateShareLink(true)} className="rounded-full border border-stone-300 px-3 py-1 hover:bg-stone-100">
                    Generate new link
                  </button>
                  <button onClick={revokeLink} className="rounded-full border border-stone-300 px-3 py-1 hover:bg-stone-100 text-red-600">
                    Revoke link
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => getOrCreateShareLink(false)} className="btn-primary mt-3">
                Create share link
              </button>
            )}
          </div>

          <div className="border-t border-stone-200 pt-5">
            <h3 className="font-medium">Or invite by email</h3>
            <p className="mt-1 text-xs text-stone-500">
              For someone who already has a Pantry account.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="email"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                placeholder="partner@example.com"
                className="input flex-1"
              />
              <button onClick={share} className="btn-secondary">
                Add
              </button>
            </div>
            {shareError && <p className="mt-2 text-sm text-red-600">{shareError}</p>}
            {shareInfo && <p className="mt-2 text-sm text-emerald-700">{shareInfo}</p>}
          </div>

          {shares.length > 0 && (
            <div className="border-t border-stone-200 pt-5">
              <h3 className="font-medium text-sm">People with access</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {shares.map((s) => (
                  <li key={s.user_id} className="flex items-center justify-between">
                    <span>{s.display_name || s.email}</span>
                    <button onClick={() => unshare(s.user_id)} className="text-stone-500 hover:text-red-600 text-xs">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <input
          value={addingItem}
          onChange={(e) => setAddingItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addManual();
          }}
          placeholder="Add an item (e.g. milk)"
          className="input flex-1"
        />
        <button onClick={addManual} className="btn-primary">
          Add
        </button>
      </div>

      <div className="mt-6 space-y-5">
        {sortedCategories.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center text-stone-500">
            List is empty. Add items above, or go to a recipe and tap &ldquo;Add to shopping list&rdquo;.
          </div>
        ) : (
          sortedCategories.map((cat) => (
            <section key={cat}>
              <h2 className="text-xs uppercase tracking-wide text-stone-500 mb-2">{cat}</h2>
              <ul className="overflow-hidden rounded-2xl border border-stone-200 bg-white divide-y divide-stone-100">
                {grouped[cat].map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={() => toggle(item)}
                      className="h-5 w-5 rounded border-stone-300"
                    />
                    <div className={`flex-1 ${item.checked ? 'line-through text-stone-400' : ''}`}>
                      <div className="text-sm">
                        {item.quantity && <span className="text-stone-500">{item.quantity}</span>}
                        {item.unit && <span className="text-stone-500"> {item.unit}</span>}
                        {(item.quantity || item.unit) && ' '}
                        {item.name}
                      </div>
                      {item.notes && <div className="text-xs text-stone-500">{item.notes}</div>}
                    </div>
                    <button
                      onClick={() => deleteItem(item)}
                      className="text-stone-400 hover:text-red-600"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {items.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {checkedCount > 0 && (
            <button onClick={clearChecked} className="btn-ghost text-red-600">
              Clear {checkedCount} checked
            </button>
          )}
          <button onClick={sendToAlexa} className="btn-secondary" title="Stub — see app/api/alexa/route.ts">
            Send to Alexa
          </button>
          {alexaResult && <span className="text-xs text-stone-500 self-center">{alexaResult}</span>}
        </div>
      )}
    </div>
  );
}
