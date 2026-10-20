// Logins (administrator): make a login for one employee or many at once, reset a forgotten password.
// The server (edge function iaf-admin-login) creates the login, links it to the employee record and gives a first-time password
// that is shown here only once. The employee must change it when they first sign in.
// An employee without an email gets a username (e.g. juan.delacruz) that they type on the sign-in screen.
export const LOGIN_DOMAIN = "login.worldclasslaminate.com.ph";
let st = { co: null, show: "none", q: "", dept: "", results: null, sel: new Set(), names: {} };

const clean = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ñ/g, "n")
  .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, "").replace(/[^a-z0-9 ]/g, " ").trim();
// first.last from the employee's name (first given name + last surname word), made unique
export function suggestUsername(e, taken) {
  const first = clean(e.first_name || (e.name || "").split(/\s+/)[0]).split(/\s+/)[0] || "user";
  const lastWords = clean(e.last_name || (e.name || "").split(/\s+/).slice(-1)[0]).split(/\s+/).filter(Boolean);
  const last = lastWords.join("") || "x";
  let base = `${first}.${last}`.slice(0, 36), u = base, i = 2;
  while (taken.has(u)) u = `${base}${i++}`;
  taken.add(u); return u;
}
export const shownLogin = (email) => (email && email.endsWith("@" + LOGIN_DOMAIN) ? email.split("@")[0] : email || "");

export async function renderLogins(el, ctx) {
  const { rpc, fnCall, esc, toast, errBox, state } = ctx;
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let companies, rows;
  try { companies = await rpc("iaf_my_companies"); } catch (e) { el.innerHTML = errBox(e); return; }
  const cur = companies.find((c) => c.id === st.co) || companies.find((c) => c.id === state.empCompany) || companies[0];
  if (st.co !== cur.id) { st.sel = new Set(); st.names = {}; } st.co = cur.id;
  try { rows = await rpc("iaf_login_list", { p_company: cur.id }); } catch (e) { el.innerHTML = errBox(e); return; }
  const reload = () => renderLogins(el, ctx);
  const taken = new Set(rows.map((r) => shownLogin(r.login)).filter(Boolean));
  rows.forEach((r) => { if (!r.user_id && !st.names[r.employee_id]) st.names[r.employee_id] = suggestUsername(r, taken); });
  const has = rows.filter((r) => r.user_id).length, ready = rows.filter((r) => !r.user_id && r.ready).length, notReady = rows.filter((r) => !r.user_id && !r.ready).length;
  const depts = [...new Set(rows.map((r) => r.dept).filter(Boolean))].sort();
  const q = st.q.trim().toLowerCase();
  const list = rows.filter((r) => (st.show === "all" || (st.show === "has" ? r.user_id : !r.user_id)) && (!st.dept || r.dept === st.dept)
    && (!q || `${r.name} ${r.login || ""} ${r.dept || ""}`.toLowerCase().includes(q)));
  const selCount = [...st.sel].filter((id) => rows.some((r) => r.employee_id === id && !r.user_id && r.ready)).length;
  const when = (t) => (t ? new Date(t).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "");
  el.innerHTML = `<div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === cur.id ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>
    ${st.results ? resultsHtml(st.results, rows, esc, cur) : ""}
    <div class="card"><p class="s">A login lets the employee sign in and file leave, OB and shift changes. Type their email, or keep the suggested <b>username</b> if they have no email. The app makes a first-time password, shown once on this page, to hand to the employee; they choose their own password when they first sign in.</p>
      <p><b>${has}</b> with a login · <b>${ready}</b> ready for a login · <b>${notReady}</b> need a department and job title first (<a href="#/employees">Employees &amp; 201</a>)</p>
      <div class="rvbar"><label>Show<select id="lgs">${[["none", "Without a login"], ["has", "With a login"], ["all", "Everyone"]].map(([k, t]) => `<option value="${k}"${st.show === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <label>Department<select id="lgd"><option value="">All departments</option>${depts.map((d) => `<option${st.dept === d ? " selected" : ""}>${esc(d)}</option>`).join("")}</select></label>
        <label>Search<input id="lgq" type="search" value="${esc(st.q)}" placeholder="Name"></label></div>
      ${st.show !== "has" ? `<div class="btns"><button class="btn sm" id="lgall">Select all ready (${list.filter((r) => !r.user_id && r.ready).length})</button><button class="btn sm" id="lgnone">Clear</button>
        <button class="btn primary" id="lgbulk" ${selCount ? "" : "disabled"}>Create ${selCount || ""} login${selCount === 1 ? "" : "s"}</button></div>` : ""}
      <div class="eerr"></div>
      <div class="tscroll"><table class="dtab lgtab"><tr><th></th><th>Employee</th><th>Login (email or username)</th><th>Status</th><th></th></tr>
      ${list.map((r) => `<tr data-id="${esc(r.employee_id)}"><td>${!r.user_id && r.ready ? `<input type="checkbox" data-pick ${st.sel.has(r.employee_id) ? "checked" : ""} aria-label="Select ${esc(r.name)}">` : ""}</td>
        <td><b>${esc(r.name)}</b><br><small>${esc([r.dept, r.title].filter(Boolean).join(" · ") || "no department / job title")}</small></td>
        <td>${r.user_id ? `<code>${esc(shownLogin(r.login) || "(linked earlier)")}</code>` : r.ready ? `<input data-name value="${esc(st.names[r.employee_id] || "")}" maxlength="120" autocomplete="off" spellcheck="false">` : "—"}</td>
        <td>${r.user_id ? `<span class="chip ok">has login</span>${r.must_change ? '<br><small class="warnt">first password not changed yet</small>' : r.last_sign_in ? `<br><small>last sign-in ${esc(when(r.last_sign_in))}</small>` : ""}${r.manager ? "" : '<br><small class="warnt">no superior set (Admin)</small>'}`
          : r.ready ? '<span class="chip wait">ready</span>' : '<span class="chip mute">needs department &amp; job title</span>'}</td>
        <td>${r.user_id ? (r.user_id === state.me?.id ? "" : `<button class="btn sm" data-reset>Reset password</button>`) : r.ready ? `<button class="btn sm primary" data-one>Create login</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5">Nobody here.</td></tr>`}</table></div></div>`;

  el.querySelectorAll("[data-co]").forEach((b) => (b.onclick = () => { st.co = b.dataset.co; st.results = null; reload(); }));
  el.querySelector("#lgs").onchange = (ev) => { st.show = ev.target.value; reload(); };
  el.querySelector("#lgd").onchange = (ev) => { st.dept = ev.target.value; reload(); };
  let qt; el.querySelector("#lgq").oninput = (ev) => { clearTimeout(qt); qt = setTimeout(() => { st.q = ev.target.value; reload(); }, 350); };
  el.querySelectorAll("[data-name]").forEach((i) => (i.oninput = () => { st.names[i.closest("tr").dataset.id] = i.value.trim(); }));
  el.querySelectorAll("[data-pick]").forEach((c) => (c.onchange = () => { const id = c.closest("tr").dataset.id; c.checked ? st.sel.add(id) : st.sel.delete(id); reload(); }));
  const all = el.querySelector("#lgall"); if (all) all.onclick = () => { list.filter((r) => !r.user_id && r.ready).forEach((r) => st.sel.add(r.employee_id)); reload(); };
  const none = el.querySelector("#lgnone"); if (none) none.onclick = () => { st.sel = new Set(); reload(); };
  const create = async (ids, btn) => {
    const items = ids.map((id) => ({ employee_id: id, login: st.names[id] || "" }));
    if (!confirm(`Create ${items.length} login${items.length > 1 ? "s" : ""}? The first-time password${items.length > 1 ? "s" : ""} will be shown once.`)) return;
    btn.disabled = true; btn.textContent = "Creating…";
    try {
      const out = await fnCall("iaf-admin-login", { action: "create", items }, 300000);
      st.results = (out.results || []).map((x) => ({ ...x, name: (rows.find((r) => r.employee_id === x.employee_id) || {}).name }));
      st.results.filter((x) => x.ok).forEach((x) => st.sel.delete(x.employee_id));
      const okN = st.results.filter((x) => x.ok).length; toast(`${okN} login${okN === 1 ? "" : "s"} created ✔`, okN < st.results.length); reload();
    } catch (e) { el.querySelector(".eerr").innerHTML = errBox(e); btn.disabled = false; btn.textContent = "Try again"; }
  };
  el.querySelectorAll("[data-one]").forEach((b) => (b.onclick = () => create([b.closest("tr").dataset.id], b)));
  const bulk = el.querySelector("#lgbulk"); if (bulk) bulk.onclick = () => create([...st.sel].filter((id) => rows.some((r) => r.employee_id === id && !r.user_id && r.ready)), bulk);
  el.querySelectorAll("[data-reset]").forEach((b) => (b.onclick = async () => {
    const r = rows.find((x) => x.employee_id === b.closest("tr").dataset.id);
    if (!confirm(`Give ${r.name} a new first-time password? Their old password stops working.`)) return;
    b.disabled = true;
    try { const out = await fnCall("iaf-admin-login", { action: "reset", employee_id: r.employee_id }); st.results = [{ ...out, employee_id: r.employee_id, name: r.name, reset: true }]; toast("New password made ✔"); reload(); }
    catch (e) { toast(e.message, true); b.disabled = false; }
  }));
  const rb = el.querySelector("#lgres");
  if (rb) {
    rb.querySelector("[data-csv]").onclick = () => downloadCsv(st.results, cur);
    rb.querySelector("[data-print]").onclick = () => printSlips(st.results, cur);
    rb.querySelector("[data-done]").onclick = () => { if (confirm("Close this list? The passwords cannot be shown again (you can reset a password later).")) { st.results = null; reload(); } };
  }
}

function resultsHtml(res, rows, esc, cur) {
  const ok = res.filter((x) => x.ok), bad = res.filter((x) => !x.ok);
  return `<div class="card" id="lgres"><h3>${res[0]?.reset ? "New first-time password" : `Logins created · ${esc(cur.short_code)}`}</h3>
    <div class="alert warn"><b>Shown only now.</b> Print the slips or download the list before you leave this page, and hand each slip to the employee. They choose their own password when they first sign in.</div>
    ${ok.length ? `<div class="tscroll"><table class="dtab"><tr><th>Employee</th><th>Sign in with</th><th>First-time password</th></tr>
      ${ok.map((x) => `<tr><td>${esc(x.name || "")}</td><td><code>${esc(x.username || x.login)}</code></td><td><code class="pw">${esc(x.password)}</code></td></tr>`).join("")}</table></div>` : ""}
    ${bad.length ? `<div class="alert bad"><b>Not created:</b><br>${bad.map((x) => `${esc(x.name || "")}: ${esc(x.error || "")}`).join("<br>")}</div>` : ""}
    <div class="btns">${ok.length ? `<button class="btn primary" data-print>Print slips</button><button class="btn" data-csv>Download list (CSV)</button>` : ""}<button class="btn" data-done>Done</button></div></div>`;
}
const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");
function downloadCsv(res, cur) {
  const q = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [["Employee", "Sign in with", "First-time password", "App"].join(","), ...res.filter((x) => x.ok).map((x) => [x.name, x.username || x.login, x.password, appUrl()].map(q).join(","))];
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }));
  a.download = `IAF_logins_${cur.short_code}_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
function printSlips(res, cur) {
  const e = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const w = window.open("", "_blank"); if (!w) { alert("Allow pop-ups to print the slips."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>IAF login slips ${e(cur.short_code)}</title><style>
    body{font:14px system-ui,sans-serif;margin:16px}.s{border:1px dashed #888;padding:12px 14px;margin:0 0 12px;break-inside:avoid;border-radius:6px}
    .s h3{margin:0 0 6px;font-size:15px}.s code{font-size:16px;font-weight:700}.s p{margin:4px 0}@media print{button{display:none}}</style></head><body>
    <button onclick="print()">Print</button>
    ${res.filter((x) => x.ok).map((x) => `<div class="s"><h3>Imperium Axiom Flow — ${e(cur.short_code)}</h3><p><b>${e(x.name)}</b></p>
      <p>Open: ${e(appUrl())}</p><p>Sign in with: <code>${e(x.username || x.login)}</code></p><p>First-time password: <code>${e(x.password)}</code></p>
      <p><small>You will be asked to choose your own password. Keep it secret. Lost it? Ask HR / IT for a new one.</small></p></div>`).join("")}
    </body></html>`);
  w.document.close();
}
