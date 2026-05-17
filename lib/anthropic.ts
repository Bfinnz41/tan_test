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
- If the request is ambiguous or unsafe, return the recipe unchanged and put a note in the title.`;

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

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No recipe returned from model');
  return normalizeParsed(JSON.parse(block.text));
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

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No recipe returned from model');
  return normalizeParsed(JSON.parse(block.text));
}

export async function modifyRecipe(
  recipe: Pick<Recipe, 'title' | 'description' | 'servings' | 'ingredients' | 'instructions'>,
  request: string,
): Promise<ParsedRecipe> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: [
      { type: 'text', text: MODIFY_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      format: { type: 'json_schema', schema: RECIPE_JSON_SCHEMA },
    },
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
        )}\n\nModification request:\n${request}`,
      },
    ],
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No modified recipe returned');
  return normalizeParsed(JSON.parse(block.text));
}

const CONSOLIDATE_SYSTEM = `You consolidate shopping list ingredients from multiple recipes.

Rules:
- Combine same-ingredient entries with compatible units (e.g. "2 cup flour" + "1 cup flour" = "3 cup flour").
- If units differ and can't be safely combined, keep separate entries.
- Use the bare ingredient name.
- Tag each entry with a grocery category: produce, meat, dairy, pantry, frozen, bakery, deli, beverages, household, other.
- Keep prep notes in the "notes" field only when relevant for shopping (e.g. "low-sodium").`;

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

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No consolidated list returned');
  const parsed = JSON.parse(block.text);
  return (parsed.items as Ingredient[]).map(cleanIngredient);
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
