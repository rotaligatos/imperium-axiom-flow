// One menu definition for the whole app, plus the admin-only "View by role" page.
// Each item: [hash, label, icon, key, access(flags)]. flags: role, approver, late, coc, people, admin.
// access = the person has the right to the page (decided by the server). The administrator can hide any item, per role or per person,
// and can show "open" items (access true for everyone) to a role or person that does not have them by default.
export const NAV_GROUPS = [
  { title: "My requests", items: [["#/file", "File leave", "➕", "file", () => true], ["#/requests", "My requests", "📄", "requests", () => true],
    ["#/ob", "Official business", "📍", "ob", () => true], ["#/shift", "Change shift", "🔄", "shift", () => true], ["#/time", "Half-day / Undertime", "⏱️", "time", () => true]] },
  { title: "Approvals", items: [["#/approvals", "Leave & OB approvals", "✅", "approvals", (f) => f.approver], ["#/late", "Late leave filings", "⏰", "late", (f) => f.late]] },
  { title: "Workplace", items: [["#/calendar", "Who's out", "📅", "calendar", () => true], ["#/ir", "Incident reports", "📝", "ir", () => true],
    ["#/coc", "Code of Conduct", "⚖️", "coc", (f) => f.coc], ["#/policies", "Policies & Memos", "📚", "policies", () => true]] },
  { title: "HR", items: [["#/employees", "Employees & 201", "👥", "employees", (f) => f.people], ["#/org", "Org chart", "🗂️", "org", (f) => f.people],
    ["#/schedules", "Schedules", "🕒", "schedules", (f) => f.people], ["#/credits", "Leave credits", "🧮", "credits", (f) => f.people], ["#/review", "For HR review", "🔎", "review", (f) => f.people],
    ["#/holidays", "Holidays", "🎌", "holidays", (f) => f.people], ["#/notices", "Notices", "📢", "notices", (f) => f.people]] },
  { title: "Admin", items: [["#/admin", "People & access", "⚙️", "admin", (f) => f.admin], ["#/roles", "View by role", "🔍", "roles", (f) => f.admin]] },
];
// items open to everyone (the administrator may give them to anyone); the others need access given elsewhere
export const OPEN_ITEMS = ["file", "requests", "ob", "shift", "time", "calendar", "ir", "policies"];
const NEEDS = { approvals: "people who approve leave (org chart)", late: "supervisors, managers and HR", coc: "supervisors and up, HR",
  employees: "HR staff access (People & access)", org: "HR staff access (People & access)", schedules: "HR staff access (People & access)", credits: "HR staff access (People & access)",
  review: "HR staff access (People & access)", holidays: "HR staff access (People & access)", notices: "HR staff access (People & access)", admin: "administrators", roles: "administrators" };
const LOCKED = (role, key) => role === "admin" && (key === "admin" || key === "roles");
// built-in default (same as the server iaf_nav_default)
export const navDefault = (role, key) => (key === "calendar" ? !["staff", "it"].includes(role) : true);
const findItem = (key) => NAV_GROUPS.flatMap((g) => g.items).find((it) => it[3] === key);
// is the item in the menu: needs access, then the person's / role's setting, else the default
export function itemOn(key, f, ov = {}) {
  const it = findItem(key); if (!it || !it[4](f)) return false;
  if (LOCKED(f.role, key)) return true;
  return key in ov ? !!ov[key] : navDefault(f.role, key);
}
export const visibleGroups = (f, ov = {}) => NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => itemOn(it[3], f, ov)) })).filter((g) => g.items.length);

// Roles as the app treats them today (server rules). Admin reviews this to decide what each position should have.
export const ROLES = [
  { k: "staff", name: "Staff / rank and file", who: "Nobody reports to them on the org chart.", f: { role: "", approver: false, late: false, coc: false, people: false, admin: false } },
  { k: "supervisor", name: "Supervisor / team leader", who: "Job level Supervisor, or people report to them on the org chart.", f: { role: "", approver: true, late: true, coc: true, people: false, admin: false } },
  { k: "manager", name: "Manager / department head", who: "Job level Manager or higher, or primary approver of a department.", f: { role: "", approver: true, late: true, coc: true, people: false, admin: false } },
  { k: "head", name: "Head of Plant Operation", who: "Holds the Head of Plant Operation position on the org chart.", f: { role: "", approver: true, late: true, coc: true, people: false, admin: false } },
  { k: "it", name: "IT staff", who: "In the IT department or with an IT title. The IT Manager is on the org chart.", f: { role: "", approver: false, late: false, coc: false, people: false, admin: false } },
  { k: "hr", name: "HR staff / HR supervisor", who: "Given HR staff access on the Admin page.", f: { role: "", approver: false, late: true, coc: true, people: true, admin: false } },
  { k: "hrm", name: "HR Manager", who: "Holds the HR Manager position on the org chart (and HR staff access).", f: { role: "", approver: true, late: true, coc: true, people: true, admin: false } },
  { k: "admin", name: "Administrator", who: "Listed as administrator (IT).", f: { role: "", approver: true, late: true, coc: true, people: true, admin: true } },
];
// What each role can do, by area. Keys follow ROLES; missing = same as staff.
const ALL = (v) => Object.fromEntries(ROLES.map((r) => [r.k, v]));
ROLES.forEach((r) => (r.f.role = r.k));
export const FEATURES = [
  ["Leave, OB, change shift, half-day / undertime", { ...ALL("Own requests"), supervisor: "Own + shift / half-day for their team", manager: "Own + shift / half-day for their team or department", head: "Own + for their area",
    hr: "Own + anyone (recorded at once)", hrm: "Own + anyone (recorded at once)", admin: "Own + anyone (recorded at once)" }],
  ["Approve leave and OB", { ...ALL("—"), supervisor: "Their team (first step)", manager: "Their department", head: "If on the route; final approver of shift changes",
    hr: "Cases handed to them (confidential leave)", hrm: "VL covering SL, confidential leave", admin: "If on the route" }],
  ["For HR review (employee record items)", { ...ALL("—"), hr: "Whole company: resolve, dismiss, add", hrm: "Whole company: resolve, dismiss, add", admin: "Whole company: resolve, dismiss, add" }],
  ["Medical certificate (Sick Leave over 2 days)", { ...ALL("Own: reminded until HR receives it"), supervisor: "Alerted for people under them; mark received or waive", manager: "Alerted for people under them; mark received or waive", head: "Alerted for people under them; mark received or waive", hr: "Whole company: mark received or waive", hrm: "Whole company: mark received or waive", admin: "Whole company: mark received or waive" }],
  ["Late leave filings list", { ...ALL("—"), supervisor: "People under them", manager: "People under them", head: "People under them", hr: "Whole company", hrm: "Whole company", admin: "Whole company" }],
  ["Who's out calendar", { ...ALL("Yes"), staff: "— (the administrator can turn it on)", it: "— (the administrator can turn it on)" }],
  ["Incident reports", { ...ALL("File; see own reports; reports about them after a Notice to Explain"), supervisor: "File; note reports on the route; recommend lighter penalty (Manager level)",
    manager: "File; note; recommend a lighter penalty", head: "Sees all; acts when asked; signs decisions; IT Manager closes IT reports",
    it: "File; assess IT incident reports", hr: "Receive, IR status, Notice to Explain, decide, sign, restrict", hrm: "Same as HR staff", admin: "Reports they file or are on the route of" }],
  ["Code of Conduct guide + AI", { ...ALL("—"), supervisor: "Yes", manager: "Yes", head: "Yes", hr: "Yes, add notes", hrm: "Yes, add notes", admin: "Yes, add notes" }],
  ["Policies & memos", { ...ALL("Read memos for everyone"), supervisor: "Also memos for supervisors and up", manager: "Also publish for own department", head: "Also publish plant-wide",
    hr: "Publish all, incl. HR-only", hrm: "Publish all, incl. HR-only", admin: "Publish all" }],
  ["Employees, 201, org chart, schedules, leave credits, holidays, notices", { ...ALL("—"), hr: "Yes (computer)", hrm: "Yes (computer); chooses who gets confidential leave", admin: "Yes (computer)" }],
  ["Admin: logins, HR access, view by role", { ...ALL("—"), admin: "Yes" }],
];

let cfg = null;
export async function renderRoles(el, ctx) {
  const { esc, state, onPreview, rpc, toast, errBox } = ctx;
  if (!cfg || ctx.reload) { try { cfg = (await rpc("iaf_nav_config")) || { roles: {}, people: [] }; } catch (e) { el.innerHTML = errBox(e); return; } ctx.reload = false; }
  const sel = state.rolesSel || "staff", r = ROLES.find((x) => x.k === sel);
  const rov = (cfg.roles || {})[sel] || {};
  const again = () => { ctx.reload = true; return renderRoles(el, ctx); };
  const people = cfg.people || [];
  const pSel = people.find((x) => x.id === state.navPerson) || null;
  const custom = people.filter((x) => Object.keys(x.items || {}).length);
  const roleName = (k) => (ROLES.find((x) => x.k === k) || { name: k }).name;
  const changed = Object.keys(rov).length;
  const row = ([, t, ic, key, acc]) => {
    const has = acc(r.f), lock = LOCKED(sel, key), on = itemOn(key, r.f, rov), def = navDefault(sel, key);
    if (!has && !OPEN_ITEMS.includes(key)) return `<div class="navrow off"><span>${ic} ${esc(t)}</span><small>needs ${esc(NEEDS[key] || "access")}</small></div>`;
    return `<label class="navrow${key in rov ? " chg" : ""}"><span>${ic} ${esc(t)}</span><small>${lock ? "always" : key in rov ? `changed (default: ${def ? "shown" : "hidden"})` : "default"}</small>
      <input type="checkbox" data-ritem="${key}" ${on ? "checked" : ""} ${lock ? "disabled" : ""}></label>`;
  };
  const pRow = ([, t, ic, key, acc]) => {
    const pf = (ROLES.find((x) => x.k === pSel.role) || ROLES[0]).f, prov = (cfg.roles || {})[pSel.role] || {};
    const has = acc(pf) || OPEN_ITEMS.includes(key);
    if (!has) return "";
    const roleOn = itemOn(key, pf, prov) || (!acc(pf) && false), cur = key in pSel.items ? (pSel.items[key] ? "show" : "hide") : "";
    if (LOCKED(pSel.role, key)) return "";
    return `<div class="navrow${cur ? " chg" : ""}"><span>${ic} ${esc(t)}</span>
      <select data-pitem="${key}"><option value="">Role setting (${roleOn ? "shown" : "hidden"})</option><option value="show"${cur === "show" ? " selected" : ""}>Show</option><option value="hide"${cur === "hide" ? " selected" : ""}>Hide</option></select>
      ${cur ? `<small class="pnote">${esc((pSel.notes || {})[key] || "")}</small>` : ""}</div>`;
  };
  el.innerHTML = `<div class="card"><p class="s">How the app treats each position. Pick a role to change its menu: untick to hide a page, tick to show it. Hidden pages are also taken off Home and cannot be opened. Pages that need access (approvals, HR pages) can be hidden here; to give that access use People &amp; access or the org chart.</p>
      <div class="cotabs">${ROLES.map((x) => `<button class="cotab${x.k === sel ? " on" : ""}" data-role="${x.k}">${esc(x.name)}${Object.keys((cfg.roles || {})[x.k] || {}).length ? " ✎" : ""}</button>`).join("")}</div></div>
    <div class="split2"><div class="card"><h3>Menu of ${esc(r.name)}</h3><p class="s">${esc(r.who)}</p>
      <div class="menuprev"><div class="navrow off"><span>🏠 Home</span><small>always</small></div>${NAV_GROUPS.map((g) => `<div class="ngroup"><div class="nh">${esc(g.title)}</div>${g.items.map(row).join("")}</div>`).join("")}<div class="navrow off"><span>👤 Account</span><small>always</small></div></div>
      <div class="btns"><button class="btn primary" data-try="${r.k}">Try this menu</button>${changed ? `<button class="btn" data-reset="${r.k}">Back to default (${changed} change${changed > 1 ? "s" : ""})</button>` : ""}</div>
      <p class="s">Changes apply the next time each person opens the app.</p></div>
      <div class="card"><h3>What ${esc(r.name)} can do</h3><dl class="stack">${FEATURES.map(([area, m]) => `<dt>${esc(area)}</dt><dd>${esc(m[r.k] || "—")}</dd>`).join("")}</dl></div></div>
    <div class="card" id="navperson"><h3>One person's menu</h3><p class="s">For a special case, show or hide a page for one person only. This wins over the role setting.</p>
      <label>Person<input id="npq" list="npl" autocomplete="off" placeholder="Type a name" value="${pSel ? esc(pSel.name) : ""}"><datalist id="npl">${people.map((x) => `<option value="${esc(x.name)}">${esc(x.company || "")} · ${esc(roleName(x.role))}</option>`).join("")}</datalist></label>
      ${custom.length ? `<p class="s">With their own menu: ${custom.map((x) => `<button class="link" data-pick="${esc(x.id)}">${esc(x.name)} (${Object.keys(x.items).length})</button>`).join(", ")}</p>` : ""}
      ${pSel ? `<p><b>${esc(pSel.name)}</b> · ${esc(pSel.company || "")} · treated as <b>${esc(roleName(pSel.role))}</b></p>
        <label>Reason <span class="opt">(kept with each change)</span><input id="npnote" maxlength="300" placeholder="e.g. covers the front desk schedule"></label>
        <div class="menuprev">${NAV_GROUPS.map((g) => { const rows = g.items.map(pRow).join(""); return rows ? `<div class="ngroup"><div class="nh">${esc(g.title)}</div>${rows}</div>` : ""; }).join("")}</div>` : ""}</div>
    <details class="card only-desktop"><summary><b>All roles side by side</b></summary><div class="tscroll"><table class="dtab"><tr><th>Area</th>${ROLES.map((x) => `<th>${esc(x.name)}</th>`).join("")}</tr>
      ${FEATURES.map(([area, m]) => `<tr><td><b>${esc(area)}</b></td>${ROLES.map((x) => `<td><small>${esc(m[x.k] || "—")}</small></td>`).join("")}</tr>`).join("")}</table></div></details>`;
  el.onclick = async (ev) => {
    const b = ev.target.closest("[data-role]"); if (b) { state.rolesSel = b.dataset.role; return renderRoles(el, ctx); }
    const t = ev.target.closest("[data-try]"); if (t) { const role = ROLES.find((x) => x.k === t.dataset.try); return onPreview({ ...role, ov: (cfg.roles || {})[role.k] || {} }); }
    const pk = ev.target.closest("[data-pick]"); if (pk) { state.navPerson = pk.dataset.pick; return renderRoles(el, ctx); }
    const rs = ev.target.closest("[data-reset]");
    if (rs) { if (!confirm(`Put the ${r.name} menu back to the default?`)) return; rs.disabled = true;
      try { for (const k of Object.keys(rov)) await rpc("iaf_nav_role_set", { p_role: sel, p_item: k, p_visible: null }); toast("Back to default ✔"); again(); }
      catch (e) { toast(e.message, true); rs.disabled = false; } }
  };
  el.onchange = async (ev) => {
    const ri = ev.target.closest("[data-ritem]");
    if (ri) { const key = ri.dataset.ritem, v = ri.checked, def = navDefault(sel, key);
      try { await rpc("iaf_nav_role_set", { p_role: sel, p_item: key, p_visible: v === def ? null : v }); toast(`${v ? "Shown" : "Hidden"} for ${r.name} ✔`); again(); }
      catch (e) { toast(e.message, true); ri.checked = !v; } return; }
    const pi = ev.target.closest("[data-pitem]");
    if (pi) { const v = pi.value === "" ? null : pi.value === "show";
      try { await rpc("iaf_nav_person_set", { p_user: pSel.id, p_item: pi.dataset.pitem, p_visible: v, p_note: el.querySelector("#npnote")?.value || null }); toast(`Saved for ${pSel.name} ✔`); again(); }
      catch (e) { toast(e.message, true); } return; }
    if (ev.target.id === "npq") { const x = people.find((p) => p.name === ev.target.value.trim()); if (x) { state.navPerson = x.id; renderRoles(el, ctx); } }
  };
}
