import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function JoinListPage({ params }: { params: { token: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Middleware would normally redirect to /login already, but double-check.
  if (!user) {
    redirect(`/login?next=/lists/join/${params.token}`);
  }

  const { data, error } = await supabase.rpc('claim_list_share', { token: params.token });

  if (error || !data || data.length === 0) {
    return (
      <div className="mx-auto max-w-md pt-12 text-center">
        <h1 className="text-2xl font-semibold">Invite link is invalid</h1>
        <p className="mt-2 text-stone-600">
          The link may have been revoked, or the URL was copied incorrectly. Ask whoever shared it for a fresh link.
        </p>
        <Link href="/lists" className="btn-primary mt-6 inline-flex">
          Back to my lists
        </Link>
      </div>
    );
  }

  const listId = data[0].list_id as string;
  redirect(`/lists/${listId}`);
}
