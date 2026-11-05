import {supabase,sendDeparture} from './supabaseClient.js';
import {createRoomService} from './roomServiceCore.js';

// Session storage isolates the host and guest identities in different tabs.
// Both Supabase Auth and the room descriptor survive a page refresh.
export const roomService=createRoomService(supabase,sessionStorage,{window,document,sendDeparture});
