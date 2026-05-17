import { NextResponse, type NextRequest } from 'next/server';

/**
 * Alexa Shopping List integration — stub.
 *
 * Wiring this up requires:
 *   1. Register an Alexa Skill in the Amazon Developer Console.
 *   2. Configure Account Linking (OAuth) so users connect their Amazon account.
 *   3. Store the user's Amazon access token (one per Pantry user) and refresh it on expiry.
 *   4. POST items to the Household List API:
 *        https://api.amazonalexa.com/v2/householdlists/<listId>/items
 *      using the Shopping List ID returned from GET /v2/householdlists.
 *
 * For now this endpoint just acknowledges the request so the UI can show a stub flow.
 */
export async function POST(req: NextRequest) {
  const { listId, items } = (await req.json().catch(() => ({}))) as {
    listId?: string;
    items?: { name: string; quantity?: string }[];
  };

  return NextResponse.json({
    ok: false,
    stub: true,
    message:
      'Alexa Shopping List integration is not wired up yet. See app/api/alexa/route.ts for the setup steps.',
    received: { listId, itemCount: items?.length || 0 },
  });
}
