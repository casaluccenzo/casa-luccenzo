import { createClient } from "@supabase/supabase-js";

// Same Supabase project the POS system (js/supabase.js) already talks to --
// this is the public anon/publishable key, meant to be client-visible and
// protected by RLS, not a secret.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://xttpaqokeyywjaajvjyu.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_ZkI5REhQ3HMJFat15ENjsQ_fyd66_TX";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Location = {
  id: string;
  slug: string;
  name: string;
};

export type Product = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  stock: number;
};

export async function getLocation(slug: string): Promise<Location | null> {
  const { data, error } = await supabase
    .from("locations")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error("Error fetching location:", error.message);
    return null;
  }
  return data;
}

export async function getMenu(locationId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, price, category, stock")
    .eq("location_id", locationId)
    .order("category")
    .order("name");
  if (error) {
    console.error("Error fetching menu:", error.message);
    return [];
  }
  return data ?? [];
}
