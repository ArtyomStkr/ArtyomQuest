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

// Only the current tab's token is used, in memory. No secrets in URLs or logs.
export function sendDeparture({roomId,connectionId,accessToken}){
  void fetch(`${url}/rest/v1/rpc/arena_command`,{
    method:'POST',keepalive:true,
    headers:{apikey:key,Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},
    body:JSON.stringify({action:'depart',payload:{roomId,connectionId,clientVersion:4,flowVersion:2,bankVersion:4}}),
  }).catch(()=>{});
}
