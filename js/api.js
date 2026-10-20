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

// Employees without an email sign in with a username (e.g. juan.delacruz), stored as username@LOGIN_DOMAIN (see js/logins.js).
const LOGIN_DOMAIN = "login.worldclasslaminate.com.ph";
export const loginEmail = (id) => { const s = String(id || "").trim().toLowerCase(); return s.includes("@") ? s : `${s}@${LOGIN_DOMAIN}`; };
export async function signIn(email, password) {
  try { save(await authCall("password", { email: loginEmail(email), password })); }
  catch (e) { if (e.status === 400) e.message = "Wrong username / email or password."; throw e; }
}
// the signed-in person sets a new password
export async function changePassword(password) {
  if (!session) throw new Error("Please sign in.");
  if (session.expires_at - Date.now() / 1000 < 60) await refresh();
  const res = await fetch(`${cfg.SUPABASE_URL}/auth/v1/user`, { method: "PUT",
    headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  try { await parse(res); } catch (e) { if (/same|different/i.test(e.message)) e.message = "Choose a password different from the first-time one."; else if (/weak|short|characters/i.test(e.message)) e.message = "That password is too weak: use at least 8 characters with letters and numbers."; throw e; }
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
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 25000);   // a stuck request becomes an error instead of an endless spinner
  const res = await fetch(`${cfg.SUPABASE_URL}/rest/v1/${path}`, { signal: ac.signal,
    method, headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) }).catch((e) => { throw e.name === "AbortError" ? new Error("The server took too long to answer. Please try again.") : e; }).finally(() => clearTimeout(timer));
  if (res.status === 401 && !retried) { await refresh(); return rest(path, { method, body, headers }, true); }
  return parse(res);
}
export const rpc = (name, args) => rest(`rpc/${name}`, { method: "POST", body: args });

// ---- private file storage (memo PDFs). Reads/writes are checked by storage policies in the database. ----
async function storageCall(path, init = {}) {
  if (!session) throw Object.assign(new Error("Please sign in."), { status: 401 });
  if (session.expires_at - Date.now() / 1000 < 60) await refresh();
  const res = await fetch(`${cfg.SUPABASE_URL}/storage/v1/${path}`, { ...init, headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, ...(init.headers || {}) } });
  if (!res.ok) { let m = `Request failed (${res.status})`; try { const b = await res.json(); m = b.message || b.error || m; } catch {} throw Object.assign(new Error(m), { status: res.status }); }
  return res;
}
// Uploads retry on server hiccups (5xx, e.g. 520) or dropped connections: 3 tries, 2s then 5s apart.
export async function storageUpload(bucket, path, file) {
  const waits = [2000, 5000];
  for (let i = 0; ; i++) {
    try { return await storageCall(`object/${bucket}/${path}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" }, body: file }); }
    catch (e) {
      const transient = e.status >= 500 || e instanceof TypeError; // TypeError = network failure in fetch
      if (!transient || i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}
export const storageBlob = async (bucket, path) => (await storageCall(`object/authenticated/${bucket}/${path}`)).blob();
// Opens a stored file safely: only PDFs and real photos (checked by their first bytes) open in a tab, with a fixed type.
// Anything else is downloaded, never shown inside the app (an uploaded HTML / SVG file could otherwise run code).
export async function openStoredFile(bucket, path, name) {
  const blob = await storageBlob(bucket, path), head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const is = (...b) => b.every((v, i) => v === null || head[i] === v);
  const type = is(0x25, 0x50, 0x44, 0x46) ? "application/pdf" : is(0xff, 0xd8, 0xff) ? "image/jpeg" : is(0x89, 0x50, 0x4e, 0x47) ? "image/png"
    : is(0x47, 0x49, 0x46, 0x38) ? "image/gif" : is(0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50) ? "image/webp" : null;
  const url = URL.createObjectURL(new Blob([blob], { type: type || "application/octet-stream" }));
  if (type && window.open(url, "_blank")) { setTimeout(() => URL.revokeObjectURL(url), 60000); return; }
  const a = document.createElement("a"); a.href = url; a.download = name || path.split("/").pop(); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---- Edge Functions (server-side helpers such as the AI memo reader). Runs as the signed-in user. ----
export async function fnCall(name, body, timeoutMs = 120000) {
  if (!session) throw Object.assign(new Error("Please sign in."), { status: 401 });
  if (session.expires_at - Date.now() / 1000 < 60) await refresh();
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${name}`, { method: "POST", signal: ac.signal,
    headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body) }).catch((e) => { throw e.name === "AbortError" ? new Error("This is taking too long. Please try again.") : e; }).finally(() => clearTimeout(timer));
  let out = null; try { out = await res.json(); } catch {}
  if (!res.ok) throw new Error(out?.error || `Request failed (${res.status})`);
  return out;
}
