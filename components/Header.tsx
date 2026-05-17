import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from './SignOutButton';

export async function Header() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href={user ? '/recipes' : '/'} className="font-semibold text-lg">
          Pantry
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/recipes" className="hover:text-stone-700">Recipes</Link>
              <Link href="/lists" className="hover:text-stone-700">Lists</Link>
              <span className="hidden sm:inline text-stone-500">{user.email}</span>
              <SignOutButton />
            </>
          ) : (
            <Link href="/login" className="hover:text-stone-700">Sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
