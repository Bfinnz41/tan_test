# Pantry

A recipe and shared-shopping-list web app. Paste a recipe (or upload a photo), ask Claude to modify it (dairy-free, fewer carbs, more servings…), then build shopping lists that sync in real time with whoever you share them with.

## Features

- **Recipe upload** — four input modes:
  - Paste recipe text
  - Link a URL (Claude fetches and parses the page)
  - Upload a PDF (great for paywalled sites — Print → Save as PDF in the browser)
  - Upload a photo
- **AI modification** — say what you want changed; Claude rewrites the recipe and saves it as a new version linked to the original. Math (scaling, halving, unit conversion) is done via Claude's code execution tool, so the arithmetic is deterministic.
- **Shopping lists** — add one or many recipes to a list. Duplicate ingredients are consolidated by Claude with code-execution math (e.g. "2 cup flour" + "1 cup flour" → "3 cup flour") and grouped by store aisle.
- **Real-time sharing** — share a list two ways:
  - Generate a link, send via WhatsApp/text/anything. Recipient signs up once, then auto-joins.
  - Invite an existing Pantry user by email.
  - Check-offs sync live across all devices via Supabase Realtime.
- **Favorites** — tap the ★ on a recipe you loved to find it again later.
- **Alexa Shopping List integration** — stub endpoint (`app/api/alexa/route.ts`) ready to be wired up.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (auth, Postgres, Realtime, row-level security)
- Anthropic Claude (`claude-opus-4-7`) — recipe parsing (text + vision), modification, ingredient consolidation

## Setup

### 1. Supabase project

1. Create a project at https://supabase.com.
2. In the SQL editor, paste and run `supabase/schema.sql`.
3. (Optional, for faster local dev) **Authentication → Providers → Email**: turn off "Confirm email" so signups don't need a verification click.
4. Copy `Project URL` and `anon` key from **Project Settings → API**.

### 2. Anthropic API key

Get one at https://console.anthropic.com.

### 3. Environment

```bash
cp .env.example .env.local
```

Fill in:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ANTHROPIC_API_KEY`

### 4. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## How sharing works

1. Both users sign up (each needs a Pantry account).
2. Owner opens a list → **Share** → enters partner's email.
3. The partner sees the list under **Lists** in their nav.
4. Check-offs propagate in real time via Supabase Realtime (`shopping_list_items` channel).

Row-level security ensures only the owner and explicitly shared users can read or edit a list.

## Wiring up Alexa

The `app/api/alexa/route.ts` endpoint is a stub. To make it real:

1. Register an Alexa Skill in the [Amazon Developer Console](https://developer.amazon.com/alexa).
2. Enable **Account Linking** (Login with Amazon, OAuth).
3. Persist each user's Amazon access token (one row per Pantry user) and refresh on expiry.
4. Replace the stub body with calls to `https://api.amazonalexa.com/v2/householdlists/{listId}/items` using the Shopping List ID from `GET /v2/householdlists`.

## Notes

- `claude-opus-4-7` was picked for the best vision quality (recipe photos) and best instruction following on modifications. For higher volume / lower cost, switch the `MODEL` constant in `lib/anthropic.ts` to `claude-sonnet-4-6`.
- Recipe parsing and modification use **structured outputs** (`output_config.format`) so responses are guaranteed to parse as the expected JSON shape.
- Ingredient consolidation runs through Claude rather than a rules-based unit converter — it handles fuzzy cases ("salt" vs "kosher salt", "1 cup butter" vs "2 sticks butter") much better.
