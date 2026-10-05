// Picks the storage backend. Both expose the same methods, so the rest of the
// app never needs to know which one is in use.

import { createLocalStore } from './store-local.js';
import { createSupabaseStore } from './store-supabase.js';

export function createStore(config) {
  if (config.backend === 'supabase') {
    return createSupabaseStore({ url: config.supabase.url, key: config.supabase.key, workshop: config.id });
  }
  return createLocalStore(config.id);
}
