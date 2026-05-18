import Anthropic from '@anthropic-ai/sdk';
import type { Ingredient, ParsedRecipe, Recipe } from './types';

const client = new Anthropic();

const MODEL = 'claude-opus-4-7';

const RECIPE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Recipe title' },
    description: { type: 'string', description: 'Short summary of the recipe' },
    servings: { type: 'string', description: 'Servings or yield, e.g. "4 servings"' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Ingredient name only, e.g. "flour"' },
          quantity: { type: 'string', description: 'Numeric or fractional quantity, e.g. "2" or "1/2"' },
          unit: { type: 'string', description: 'Unit of measure, e.g. "cup", "tsp", "g"' },
          notes: { type: 'string', description: 'Prep notes, e.g. "diced", "room temperature"' },
          category: {
            type: 'string',
            description: 'Grocery aisle category: produce, meat, dairy, pantry, frozen, bakery, deli, beverages, household, other',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    instructions: { type: 'string', description: 'Numbered or paragraph cooking instructions' },
  },
  required: ['title', 'ingredients', 'instructions'],
  additionalProperties: false,
} as const;

type ImageInput = { type: 'base64'; mediaType: string; data: string };

const PARSE_SYSTEM = `You are a recipe parser. Extract the recipe from the input and return a structured JSON object.

Rules:
- Split each ingredient into name, quantity, unit, and any prep notes ("diced", "softened", etc.).
- Use the bare ingredient name (e.g. "yellow onion", not "1 yellow onion, diced").
- Tag each ingredient with a grocery category: produce, meat, dairy, pantry, frozen, bakery, deli, beverages, household, other.
- Preserve the original instructions verbatim where possible; renumber if helpful.
- If a quantity or unit is missing, leave that field empty.`;

const MODIFY_SYSTEM = `You are a recipe assistant. Modify the given recipe per the user's request and return the full updated recipe as JSON.

Rules:
- Keep the same structure.
- Adjust ingredient quantities, swap items, or rewrite instructions as needed.
- Update the title only if the modification changes the dish substantially (e.g. "dairy-free version").
- Re-categorize swapped ingredients.
- If the request is ambiguous or unsafe, return the recipe unchanged and put a note in the title.

ARITHMETIC: When the request involves math (scaling, halving, doubling, unit conversion, percentage changes), USE the code_execution tool to do the arithmetic in Python. Do not eyeball fractions or mental math — it's error-prone. Write a short script that computes the new quantities, then put the results in the final JSON.`;

export async function parseRecipeFromText(text: string): Promise<ParsedRecipe> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [
      { type: 'text', text: PARSE_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      format: { type: 'json_schema', schema: RECIPE_JSON_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Parse this recipe:\n\n${text}`,
      },
    ],
  });

  return extractParsedRecipe(response);
}

export async function parseRecipeFromImage(image: ImageInput): Promise<ParsedRecipe> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [
      { type: 'text', text: PARSE_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      format: { type: 'json_schema', schema: RECIPE_JSON_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: image.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: image.data,
            },
          },
          { type: 'text', text: 'Parse the recipe shown in this image.' },
        ],
      },
    ],
  });

  return extractParsedRecipe(response);
}

export async function parseRecipeFromPdf(pdfBase64: string): Promise<ParsedRecipe> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [
      { type: 'text', text: PARSE_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      format: { type: 'json_schema', schema: RECIPE_JSON_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: 'Parse the recipe in this PDF.' },
        ],
      },
    ],
  });

  return extractParsedRecipe(response);
}

export async function fetchRecipePage(
  url: string,
  cookies?: string,
): Promise<{ text: string; title?: string }> {
  const headers: Record<string, string> = {
    // Pretend to be a normal browser
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
  };
  if (cookies?.trim()) headers.cookie = cookies.trim();

  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Could not fetch page (${res.status}). For paywalled sites, paste your browser cookies or save the page as PDF instead.`);
  }
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.trim();

  // Strip non-content tags
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ');

  // Decode the most common HTML entities
  const text = stripped
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // Cap to ~120K chars (~30K tokens) to keep cost reasonable
  return { text: text.slice(0, 120_000), title };
}

export async function parseRecipeFromUrl(url: string, cookies?: string): Promise<ParsedRecipe> {
  const { text, title } = await fetchRecipePage(url, cookies);
  return parseRecipeFromText(
    `Source URL: ${url}${title ? `\nPage title: ${title}` : ''}\n\nPage content:\n${text}`,
  );
}

export async function modifyRecipe(
  recipe: Pick<Recipe, 'title' | 'description' | 'servings' | 'ingredients' | 'instructions'>,
  request: string,
): Promise<ParsedRecipe> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    tools: [{ type: 'code_execution_20260120', name: 'code_execution' }],
    system: [
      { type: 'text', text: MODIFY_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Original recipe:\n\n${JSON.stringify(
          {
            title: recipe.title,
            description: recipe.description,
            servings: recipe.servings,
            ingredients: recipe.ingredients,
            instructions: recipe.instructions,
          },
          null,
          2,
        )}\n\nModification request:\n${request}\n\nReturn the full modified recipe as JSON matching the response schema.`,
      },
    ],
  });

  return extractParsedRecipe(response);
}

const CONSOLIDATE_SYSTEM = `You consolidate shopping list ingredients from multiple recipes.

Rules:
- Combine same-ingredient entries with compatible units (e.g. "2 cup flour" + "1 cup flour" = "3 cup flour").
- If units differ and can't be safely combined, keep separate entries.
- Use the bare ingredient name.
- Tag each entry with a grocery category: produce, meat, dairy, pantry, frozen, bakery, deli, beverages, household, other.
- Keep prep notes in the "notes" field only when relevant for shopping (e.g. "low-sodium").

ARITHMETIC: USE the code_execution tool for ALL quantity math. Fractions, decimals, unit conversions — run them in Python. Don't do mental math, it's error-prone. Then put the computed totals in the final JSON output.`;

const SHOPPING_LIST_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string' },
          unit: { type: 'string' },
          category: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

export async function consolidateIngredients(
  ingredientGroups: { recipeTitle: string; ingredients: Ingredient[] }[],
): Promise<Ingredient[]> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    tools: [{ type: 'code_execution_20260120', name: 'code_execution' }],
    system: [
      { type: 'text', text: CONSOLIDATE_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      format: { type: 'json_schema', schema: SHOPPING_LIST_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `Consolidate ingredients from these recipes into a single shopping list:\n\n${JSON.stringify(
          ingredientGroups,
          null,
          2,
        )}`,
      },
    ],
  });

  const textBlock = lastTextBlock(response);
  if (!textBlock) throw new Error('No consolidated list returned');
  const parsed = JSON.parse(textBlock);
  return (parsed.items as Ingredient[]).map(cleanIngredient);
}

function lastTextBlock(response: Anthropic.Message): string | null {
  for (let i = response.content.length - 1; i >= 0; i--) {
    const b = response.content[i];
    if (b.type === 'text' && b.text.trim()) return b.text;
  }
  return null;
}

function extractParsedRecipe(response: Anthropic.Message): ParsedRecipe {
  const text = lastTextBlock(response);
  if (!text) throw new Error('No recipe returned from model');
  return normalizeParsed(JSON.parse(text));
}

function cleanIngredient(i: Partial<Ingredient>): Ingredient {
  return {
    name: (i.name || '').trim(),
    quantity: i.quantity?.trim() || undefined,
    unit: i.unit?.trim() || undefined,
    notes: i.notes?.trim() || undefined,
    category: i.category?.trim().toLowerCase() || 'other',
  };
}

function normalizeParsed(raw: unknown): ParsedRecipe {
  const r = raw as {
    title?: string;
    description?: string;
    servings?: string;
    ingredients?: Partial<Ingredient>[];
    instructions?: string;
  };
  return {
    title: (r.title || 'Untitled Recipe').trim(),
    description: r.description?.trim() || undefined,
    servings: r.servings?.trim() || undefined,
    ingredients: (r.ingredients || []).map(cleanIngredient).filter((i) => i.name),
    instructions: (r.instructions || '').trim(),
  };
}
