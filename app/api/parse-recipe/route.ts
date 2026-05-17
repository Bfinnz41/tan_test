import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseRecipeFromText, parseRecipeFromImage, modifyRecipe } from '@/lib/anthropic';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { text?: string; image?: { mediaType: string; data: string }; modificationRequest?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    let parsed;
    if (body.text) {
      parsed = await parseRecipeFromText(body.text);
    } else if (body.image) {
      parsed = await parseRecipeFromImage({
        type: 'base64',
        mediaType: body.image.mediaType,
        data: body.image.data,
      });
    } else {
      return NextResponse.json({ error: 'Provide text or image' }, { status: 400 });
    }

    if (body.modificationRequest && body.modificationRequest.trim()) {
      parsed = await modifyRecipe(parsed, body.modificationRequest);
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error('parse-recipe error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to parse recipe' },
      { status: 500 },
    );
  }
}
