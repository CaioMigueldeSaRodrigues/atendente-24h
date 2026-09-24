import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.js";

export type SupabaseClientOptions = {
  url: string;
  key: string;
};

export function createSupabaseClient({ url, key }: SupabaseClientOptions) {
  return createClient<Database>(url, key);
}
