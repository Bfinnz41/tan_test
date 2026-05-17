export type Ingredient = {
  name: string;
  quantity?: string;
  unit?: string;
  notes?: string;
  category?: string;
};

export type Recipe = {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  ingredients: Ingredient[];
  instructions?: string | null;
  servings?: string | null;
  notes?: string | null;
  is_favorite: boolean;
  source_url?: string | null;
  parent_recipe_id?: string | null;
  modification_request?: string | null;
  created_at: string;
  updated_at: string;
};

export type ShoppingList = {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
};

export type ShoppingListItem = {
  id: string;
  list_id: string;
  name: string;
  quantity?: string | null;
  unit?: string | null;
  category?: string | null;
  notes?: string | null;
  checked: boolean;
  checked_by?: string | null;
  checked_at?: string | null;
  recipe_ids: string[];
  added_by?: string | null;
  created_at: string;
};

export type ListShare = {
  list_id: string;
  user_id: string;
  permission: 'edit' | 'view';
  created_at: string;
};

export type ParsedRecipe = {
  title: string;
  description?: string;
  servings?: string;
  ingredients: Ingredient[];
  instructions: string;
};
