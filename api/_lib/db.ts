// Call — the database, behind one door.
//
// Ported from Charlie `api/_lib/db.ts` (client creation only; Charlie's file is
// 1,800 lines of queries, and Call's queries live next to the code that uses
// them); the why-comments are kept.
//
// Every query in the product goes through the service role, never an anon key:
// db/0007 turns RLS on for every table and gives only products,
// product_categories and disclosures a public SELECT policy, so the publishable
// key cannot read or write a client, a call or a quotation at all. That is the
// point — a client's data is reachable only through this backend, and the
// dashboard scopes every query by the broker_id of the logged-in session, never
// by anything in the request (SPEC §13).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { required } from "./env.js";

/** The longest any one database request may take. Supabase answers in milliseconds. */
export const DB_TIMEOUT_MS = 20_000;

/** fetch, with a timeout added to whatever signal the caller already passed. */
export function fetchWithTimeout(ms: number): typeof fetch {
  return (input, init = {}) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
}

let client: SupabaseClient | null = null;

/**
 * Created on first use, not at import. Vercel imports every function module
 * during a build, and a build must not fail because a secret is not set.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
      // Charlie round 13: two jobs sat "running", last_error null, for 9-13
      // minutes. A database call with no timeout that hangs holds the job
      // until the platform kills the function, and nothing records why.
      global: { headers: { "x-call": "backend" }, fetch: fetchWithTimeout(DB_TIMEOUT_MS) },
    });
  }
  return client;
}

/** Test seam: swap in a fake client. Returns a restore function. */
export function __setClient(fake: SupabaseClient | null): () => void {
  const prev = client;
  client = fake;
  return () => {
    client = prev;
  };
}
