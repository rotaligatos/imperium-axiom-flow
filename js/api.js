// Thin Supabase client (Auth + PostgREST) using only fetch — no build step, no
// dependencies. Every call runs as the signed-in user, so database RLS and the
// checked RPCs (iaf_leave_*) are the real security boundary, not this file.
const cfg = window.IAF_CONFIG || {};
const KEY = "iaf.session.v1";
let session = null;
try { session = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { session = null; }

export const isConfigured = () => !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const save = (s) => { session = s; try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch {} };
export const getSession = () => session;
export const userId = () => session?.user?.id;

async function parse(res) {
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { message: text }; }
  if (!res.ok) {
    const msg = body?.message || body?.msg || body?.error_description || body?.error || `Request failed (${res.status})`;
    const e = new Error(msg); e.status = res.status; e.code = body?.code; throw e;
  }
  return body;
}

function toSession(b) {
  return { access_token: b.access_token, refresh_token: b.refresh_token,
    expires_at: b.expires_at || Math.floor(Date.now() / 1000) + (b.expires_in || 3600),
    user: { id: b.user?.id, email: b.user?.email } };
}

async function authCall(grant, payload) {
  const res = await fetch(`${cfg.SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST", headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload) });
  return toSession(await parse(res));
}

export async function signIn(email, password) {
  try { save(await authCall("password", { email, password })); }
  catch (e) { if (e.status === 400) e.message = "Wrong email or password."; throw e; }
}

export async function signOut() {
  const s = session; save(null);
  if (s) { try { await fetch(`${cfg.SUPABASE_URL}/auth/v1/logout`, { method: "POST",
    headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${s.access_token}` } }); } catch {} }
}

let refreshing = null;
async function refresh() {
  if (!session?.refresh_token) throw new Error("Signed out");
  refreshing ||= authCall("refresh_token", { refresh_token: session.refresh_token })
    .then((s) => { save(s); }).catch((e) => { save(null); throw e; }).finally(() => { refreshing = null; });
  return refreshing;
}

export async function rest(path, { method = "GET", body, headers = {} } = {}, retried = false) {
  if (!session) throw Object.assign(new Error("Please sign in."), { status: 401 });
  if (session.expires_at - Date.now() / 1000 < 60) await refresh();
  const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401 && !retried) { await refresh(); return rest(path, { method, body, headers }, true); }
  return parse(res);
}
export const rpc = (name, args) => rest(`rpc/${name}`, { method: "POST", body: args });
