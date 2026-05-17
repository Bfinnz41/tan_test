import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    redirect('/recipes');
  }

  return (
    <div className="mx-auto max-w-2xl pt-12">
      <h1 className="text-4xl font-semibold tracking-tight">Pantry</h1>
      <p className="mt-3 text-lg text-stone-600">
        Save recipes, ask AI to modify them (dairy-free, half sugar, double the spice), then build shopping lists you can share and check off with someone else in real time.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Feature title="Upload & modify">
          Paste a recipe or upload a photo. Ask Claude to adjust it — fewer carbs, more servings, swap an ingredient.
        </Feature>
        <Feature title="Smart shopping lists">
          Add multiple recipes to a list. Duplicates get consolidated. Items are grouped by store aisle.
        </Feature>
        <Feature title="Share & sync">
          Invite your partner. Check items off at the store; the other phone updates instantly.
        </Feature>
        <Feature title="Save favorites">
          Click the heart after a meal you loved. Easy to find next time.
        </Feature>
      </div>

      <div className="mt-10 flex gap-3">
        <Link
          href="/login"
          className="rounded-full bg-stone-900 px-6 py-3 text-white font-medium hover:bg-stone-700"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-stone-300 px-6 py-3 font-medium hover:bg-stone-100"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

function Feature({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-stone-600">{children}</p>
    </div>
  );
}
