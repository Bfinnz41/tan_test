'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function NewListButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function create() {
    setLoading(true);
    try {
      const res = await fetch('/api/lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.id) router.push(`/lists/${data.id}`);
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + New list
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="List name"
        className="input w-48"
        onKeyDown={(e) => {
          if (e.key === 'Enter') create();
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button onClick={create} disabled={loading} className="btn-primary">
        Create
      </button>
      <button onClick={() => setOpen(false)} className="btn-ghost">
        ✕
      </button>
    </div>
  );
}
