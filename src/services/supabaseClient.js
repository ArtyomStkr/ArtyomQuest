import { createClient } from '@supabase/supabase-js';

// These are public browser credentials. Authorization is enforced by RLS and RPCs.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://qcslmpbgsysbvhcofpqa.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_e4J6DPz5hwkeev3SuhDQtA_C22sgP2U';

export const supabase = createClient(url, key, {
  auth: {
    storage: sessionStorage,
    storageKey: 'rest-arena:auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
