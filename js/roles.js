// One menu definition for the whole app, plus the admin-only "View by role" page.
// Each item: [hash, label, icon, key, visible(flags)]. flags: approver, late, coc, people, admin.
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
export const visibleGroups = (f) => NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => it[4](f)) })).filter((g) => g.items.length);

// Roles as the app treats them today (server rules). Admin reviews this to decide what each position should have.
export const ROLES = [
  { k: "staff", name: "Staff / rank and file", who: "Nobody reports to them on the org chart.", f: { approver: false, late: false, coc: false, people: false, admin: false } },
  { k: "supervisor", name: "Supervisor / team leader", who: "Job level Supervisor, or people report to them on the org chart.", f: { approver: true, late: true, coc: true, people: false, admin: false } },
  { k: "manager", name: "Manager / department head", who: "Job level Manager or higher, or primary approver of a department.", f: { approver: true, late: true, coc: true, people: false, admin: false } },
  { k: "head", name: "Head of Plant Operation", who: "Holds the Head of Plant Operation position on the org chart.", f: { approver: true, late: true, coc: true, people: false, admin: false } },
  { k: "it", name: "IT staff", who: "In the IT department or with an IT title. The IT Manager is on the org chart.", f: { approver: false, late: false, coc: false, people: false, admin: false } },
  { k: "hr", name: "HR staff / HR supervisor", who: "Given HR staff access on the Admin page.", f: { approver: false, late: true, coc: true, people: true, admin: false } },
  { k: "hrm", name: "HR Manager", who: "Holds the HR Manager position on the org chart (and HR staff access).", f: { approver: true, late: true, coc: true, people: true, admin: false } },
  { k: "admin", name: "Administrator", who: "Listed as administrator (IT).", f: { approver: true, late: true, coc: true, people: true, admin: true } },
];
// What each role can do, by area. Keys follow ROLES; missing = same as staff.
const ALL = (v) => Object.fromEntries(ROLES.map((r) => [r.k, v]));
export const FEATURES = [
  ["Leave, OB, change shift, half-day / undertime", { ...ALL("Own requests"), supervisor: "Own + shift / half-day for their team", manager: "Own + shift / half-day for their team or department", head: "Own + for their area",
    hr: "Own + anyone (recorded at once)", hrm: "Own + anyone (recorded at once)", admin: "Own + anyone (recorded at once)" }],
  ["Approve leave and OB", { ...ALL("—"), supervisor: "Their team (first step)", manager: "Their department", head: "If on the route; final approver of shift changes",
    hr: "Cases handed to them (confidential leave)", hrm: "VL covering SL, confidential leave", admin: "If on the route" }],
  ["For HR review (employee record items)", { ...ALL("—"), hr: "Whole company: resolve, dismiss, add", hrm: "Whole company: resolve, dismiss, add", admin: "Whole company: resolve, dismiss, add" }],
  ["Medical certificate (Sick Leave over 2 days)", { ...ALL("Own: reminded until HR receives it"), supervisor: "Alerted for people under them; mark received or waive", manager: "Alerted for people under them; mark received or waive", head: "Alerted for people under them; mark received or waive", hr: "Whole company: mark received or waive", hrm: "Whole company: mark received or waive", admin: "Whole company: mark received or waive" }],
  ["Late leave filings list", { ...ALL("—"), supervisor: "People under them", manager: "People under them", head: "People under them", hr: "Whole company", hrm: "Whole company", admin: "Whole company" }],
  ["Who's out calendar", ALL("Yes")],
  ["Incident reports", { ...ALL("File; see own reports; reports about them after a Notice to Explain"), supervisor: "File; note reports on the route; recommend lighter penalty (Manager level)",
    manager: "File; note; recommend a lighter penalty", head: "Sees all; acts when asked; signs decisions; IT Manager closes IT reports",
    it: "File; assess IT incident reports", hr: "Receive, IR status, Notice to Explain, decide, sign, restrict", hrm: "Same as HR staff", admin: "Reports they file or are on the route of" }],
  ["Code of Conduct guide + AI", { ...ALL("—"), supervisor: "Yes", manager: "Yes", head: "Yes", hr: "Yes, add notes", hrm: "Yes, add notes", admin: "Yes, add notes" }],
  ["Policies & memos", { ...ALL("Read memos for everyone"), supervisor: "Also memos for supervisors and up", manager: "Also publish for own department", head: "Also publish plant-wide",
    hr: "Publish all, incl. HR-only", hrm: "Publish all, incl. HR-only", admin: "Publish all" }],
  ["Employees, 201, org chart, schedules, leave credits, holidays, notices", { ...ALL("—"), hr: "Yes (computer)", hrm: "Yes (computer); chooses who gets confidential leave", admin: "Yes (computer)" }],
  ["Admin: logins, HR access, view by role", { ...ALL("—"), admin: "Yes" }],
];

export function renderRoles(el, { esc, state, onPreview }) {
  const sel = state.rolesSel || "staff", r = ROLES.find((x) => x.k === sel);
  const groups = visibleGroups(r.f);
  el.innerHTML = `<div class="card"><p class="s">How the app treats each position today. Pick a role to see its menu, or try the menu yourself. Tell IT what should change.</p>
      <div class="cotabs">${ROLES.map((x) => `<button class="cotab${x.k === sel ? " on" : ""}" data-role="${x.k}">${esc(x.name)}</button>`).join("")}</div></div>
    <div class="split2"><div class="card"><h3>${esc(r.name)}</h3><p class="s">${esc(r.who)}</p>
      <div class="menuprev"><div class="ngroup"><a class="mi">🏠 Home</a></div>${groups.map((g) => `<div class="ngroup"><div class="nh">${esc(g.title)}</div>${g.items.map(([, t, ic]) => `<a class="mi">${ic} ${esc(t)}</a>`).join("")}</div>`).join("")}<div class="ngroup"><a class="mi">👤 Account</a></div></div>
      <button class="btn primary" data-try="${r.k}">Try this menu</button><p class="s">The menu changes to this role. Pages still open with your own access.</p></div>
      <div class="card"><h3>What ${esc(r.name)} can do</h3><dl class="stack">${FEATURES.map(([area, m]) => `<dt>${esc(area)}</dt><dd>${esc(m[r.k] || "—")}</dd>`).join("")}</dl></div></div>
    <details class="card only-desktop"><summary><b>All roles side by side</b></summary><div class="tscroll"><table class="dtab"><tr><th>Area</th>${ROLES.map((x) => `<th>${esc(x.name)}</th>`).join("")}</tr>
      ${FEATURES.map(([area, m]) => `<tr><td><b>${esc(area)}</b></td>${ROLES.map((x) => `<td><small>${esc(m[x.k] || "—")}</small></td>`).join("")}</tr>`).join("")}</table></div></details>`;
  el.onclick = (ev) => {
    const b = ev.target.closest("[data-role]"); if (b) { state.rolesSel = b.dataset.role; return renderRoles(el, { esc, state, onPreview }); }
    const t = ev.target.closest("[data-try]"); if (t) onPreview(ROLES.find((x) => x.k === t.dataset.try));
  };
}
