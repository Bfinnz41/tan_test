import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  parseRecipeFromText,
  parseRecipeFromImage,
  parseRecipeFromPdf,
  parseRecipeFromUrl,
  modifyRecipe,
} from '@/lib/anthropic';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  text?: string;
  image?: { mediaType: string; data: string };
  pdf?: { data: string };
  url?: { url: string; cookies?: string };
  modificationRequest?: string;
};

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Body;
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
    } else if (body.pdf) {
      parsed = await parseRecipeFromPdf(body.pdf.data);
    } else if (body.url) {
      try {
        new URL(body.url.url);
      } catch {
        return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
      }
      parsed = await parseRecipeFromUrl(body.url.url, body.url.cookies);
    } else {
      return NextResponse.json({ error: 'Provide text, image, pdf, or url' }, { status: 400 });
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
