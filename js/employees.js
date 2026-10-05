// Employees page (Administrator / HR): the company's people list, Excel/CSV upload with a preview, add or edit one person.
// Salary figures found in an uploaded file are sent to the server and kept in a table only HR can read; this page never shows them.
import { readAnyFile, mapEmployeeRows, suggestDeptMap } from "./xlsxread.js";

const LEVELS = { 1: "Staff", 2: "Supervisor", 3: "Manager", 4: "HR / Director", 5: "Managing Director" };
const STATUS = ["active", "inactive", "separated"];
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—");
const TEMPLATE = "Name,Position,Department,Hire Date,Employee No\n\"Dela Cruz, Juan\",Forklift Operator,Warehouse,2024-03-15,\n\"Reyes, Maria\",QA Inspector,QA,2023-07-01,\n";

export async function renderEmployees(el, { rpc, esc, toast, errBox, state }) {
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let companies;
  try { companies = await rpc("iaf_my_companies"); } catch (e) { el.innerHTML = errBox(e); return; }
  if (!companies.length) { el.innerHTML = `<div class="empty">No company available.</div>`; return; }
  const cur = companies.find((c) => c.id === state.empCompany) || companies[0]; state.empCompany = cur.id;
  let dir, lk, extras;
  try { [dir, lk, extras] = await Promise.all([rpc("iaf_employee_directory", { p_company: cur.id }), rpc("iaf_org_lookups", { p_company: cur.id }), rpc("iaf_employee_extras", { p_company: cur.id })]); } catch (e) { el.innerHTML = errBox(e); return; }
  const xcache = {};   // lookups of other companies, loaded only when someone opens "add another position"
  const extrasOf = (id) => extras.filter((x) => x.employee_id === id);
  const visitors = extras.filter((x) => x.company_id === cur.id && x.home_company_id !== cur.id);
  const canLevels = state.isAdmin;
  const opt = (rows, val, label, sel, none) => `${none ? `<option value="">${esc(none)}</option>` : ""}${rows.map((r) => `<option value="${esc(r[val])}"${r[val] === sel ? " selected" : ""}>${esc(label(r))}</option>`).join("")}`;
  const roleLabel = (r) => `${r.title} (level ${r.level})`;
  const q = (state.empQuery || "").toLowerCase();
  const shown = dir.filter((p) => !q || `${p.full_name} ${p.role_title || ""} ${p.dept_name || ""}`.toLowerCase().includes(q));
  const groups = {}; shown.forEach((p) => (groups[p.dept_name || "No department"] ||= []).push(p));
  const active = dir.filter((p) => p.status === "active").length;

  const personCard = (p) => `<div class="card person" data-id="${esc(p.id)}">
      <div class="between"><div><b>${esc(p.full_name)}</b>${p.has_login ? ` <span class="chip ok">has login</span>` : ""}<br>
        <small>${esc(p.role_title || "No job title")}${p.role_level ? ` · level ${p.role_level}` : ""} · hired ${esc(fmtD(p.hire_date))}</small></div>
        <span class="chip ${p.status === "active" ? "ok" : "mute"}">${esc(p.status)}</span></div>
      ${extrasOf(p.id).map((x) => `<div class="between xpos"><small>➕ <b>${esc(x.company_code)}</b> · ${esc(x.dept_name)} · ${esc(x.role_title)}${x.note ? ` — ${esc(x.note)}` : ""}</small><button class="link" data-delpos="${esc(x.position_id)}">Remove</button></div>`).join("")}
      <button class="link" data-edit>Edit</button> <button class="link" data-addpos>+ Another position</button>
      <form class="form" data-eform hidden>${personFields(p)}<div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Save</button></div></form>
      <form class="form" data-pform hidden><p class="s">Main position: <b>${esc(cur.short_code)}</b> · ${esc(p.dept_name || "—")} · ${esc(p.role_title || "—")}. Leave and the login always stay with the main company. This adds a second department or company.</p>
        <label>Company<select name="pco">${companies.map((c) => `<option value="${esc(c.id)}">${esc(c.short_code)}</option>`).join("")}</select></label>
        <div data-pbody><small>Loading…</small></div><div class="eerr"></div>
        <div class="btns"><button class="btn primary" type="submit">Add position</button></div></form></div>`;
  function personFields(p) {
    p = p || {};
    return `<label>Full name<input name="name" required maxlength="80" value="${esc(p.full_name || "")}"></label>
      <div class="two"><label>Department<select name="dept">${opt(lk.departments, "id", (d) => d.name, p.dept_id, "— none —")}</select></label>
        <label>Job title<select name="role">${opt(lk.roles, "id", roleLabel, p.role_id, "— none —")}</select></label></div>
      <div class="two"><label>Hire date<input name="hire" type="date" value="${esc(p.hire_date || "")}"></label>
        <label>Employee no. <span class="opt">(optional)</span><input name="no" maxlength="30" value="${esc(p.employee_no || "")}"></label></div>
      <label>Status<select name="status">${STATUS.map((s) => `<option${s === (p.status || "active") ? " selected" : ""}>${s}</option>`).join("")}</select></label>
      <input type="hidden" name="rep" value="${esc(p.reports_to_id || "")}">`;
  }

  el.innerHTML = `
    <div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === cur.id ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>
    <p class="s"><b>${esc(cur.name)}</b> · ${active} active of ${dir.length} people</p>
    <div class="card"><div class="between"><b>Upload employee list</b><button class="link" data-tpl>Download blank template</button></div>
      <p class="s">Upload an Excel (.xlsx) or CSV file. You will see a preview first — nothing is saved until you confirm. Salary columns, if present, are stored for HR only.</p>
      <input type="file" id="empfile" accept=".xlsx,.csv" hidden><button class="btn block" data-pick>Choose Excel / CSV file…</button><div id="imp"></div></div>
    <div class="between"><h2>People</h2><button class="btn" data-addp>+ Add a person</button></div>
    <div id="addbox" hidden><form class="card form" id="addemp">${personFields(null)}<div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Add person</button><button class="btn" type="button" data-canceladd>Cancel</button></div></form></div>
    <input class="search" id="empq" type="search" placeholder="Search name, job title or department" value="${esc(state.empQuery || "")}">
    ${visitors.length ? `<details class="grp" open><summary><b>Also works here (main job elsewhere)</b> <span class="chip mute">${visitors.length}</span></summary>${visitors.map((x) => `<div class="card vperson"><div class="between"><div><b>${esc(x.full_name)}</b> <span class="chip mute">main: ${esc(x.home_code)}</span><br><small>${esc(x.role_title)} · ${esc(x.dept_name)}${x.note ? ` — ${esc(x.note)}` : ""}</small></div><button class="link" data-delpos="${esc(x.position_id)}">Remove</button></div></div>`).join("")}</details>` : ""}
    <div class="list">${Object.keys(groups).sort().map((g) => `<details class="grp" ${q || Object.keys(groups).length < 4 ? "open" : ""}><summary><b>${esc(g)}</b> <span class="chip mute">${groups[g].length}</span></summary>${groups[g].map(personCard).join("")}</details>`).join("") || `<div class="empty">No people yet. Upload a file above or add someone.</div>`}</div>
    <h2>Job titles${canLevels ? " &amp; levels" : ""}</h2>
    <div class="card"><b>Add a job title</b><p class="s">Needed before you can give someone that title. The level decides what the title can do (1 Staff · 2 Supervisor · 3 Manager · 4 Director/Head · 5 MD). Adding a title that already exists changes nothing.</p>
      <form class="form" id="addrole"><div class="two"><label>Job title<input name="title" required maxlength="80"></label>
        <label>Level<select name="level">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n} — ${LEVELS[n]}</option>`).join("")}</select></label></div><div class="eerr"></div>
        <div class="btns"><button class="btn primary" type="submit">Add job title to ${esc(cur.short_code)}</button></div></form></div>
    ${canLevels ? `<div class="card"><p class="s">The level belongs to the job title, so everyone with that title follows it. Level 3+ can approve leave; level 4+ (Directors, Head of Plant Operation) sees everyone's leave in the company. Salary records are separate: only people marked “HR staff” in the Admin tab can read them.</p>
      ${lk.roles.map((r) => `<div class="between lvl" data-role="${esc(r.id)}"><span>${esc(r.title)}</span><select>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${n === r.level ? " selected" : ""}>${n} — ${LEVELS[n]}</option>`).join("")}</select></div>`).join("") || "<small>No job titles yet.</small>"}</div>` : ""}`;

  const reload = () => renderEmployees(el, { rpc, esc, toast, errBox, state });
  const nz = (v) => v || null;
  const saveArgs = (f, id) => ({ p_id: id || null, p_company: cur.id, p_full_name: f.name.value.trim(), p_dept_id: nz(f.dept.value), p_role_id: nz(f.role.value), p_hire_date: nz(f.hire.value),
    p_employee_no: nz(f.no.value.trim()), p_status: f.status.value, p_reports_to: nz(f.rep.value) });
  const guard = async (btn, box, fn, ok) => { btn.disabled = true; if (box) box.innerHTML = ""; try { await fn(); toast(ok); await reload(); } catch (e) { if (box) box.innerHTML = errBox(e); else toast(e.message, true); btn.disabled = false; } };

  el.querySelector("#empq").oninput = (ev) => { state.empQuery = ev.target.value; const pos = ev.target.selectionStart; reload().then(() => { const i = el.querySelector("#empq"); i.focus(); i.setSelectionRange(pos, pos); }); };
  el.onclick = (ev) => {
    const co = ev.target.closest("[data-co]"); if (co) { state.empCompany = co.dataset.co; state.empQuery = ""; return reload(); }
    if (ev.target.closest("[data-tpl]")) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" })); a.download = "employee_template.csv"; a.click(); return; }
    if (ev.target.closest("[data-pick]")) return el.querySelector("#empfile").click();
    if (ev.target.closest("[data-addp]")) { el.querySelector("#addbox").hidden = false; return; }
    if (ev.target.closest("[data-canceladd]")) { el.querySelector("#addbox").hidden = true; return; }
    const dp = ev.target.closest("[data-delpos]"); if (dp) { if (!confirm("Remove this additional position?")) return; return guard(dp, null, () => rpc("iaf_position_delete", { p_id: dp.dataset.delpos }), "Position removed ✔"); }
    const c = ev.target.closest(".person"); if (!c) return;
    if (ev.target.closest("[data-edit]")) { const f = c.querySelector("[data-eform]"); f.hidden = !f.hidden; }
    if (ev.target.closest("[data-addpos]")) { const f = c.querySelector("[data-pform]"); f.hidden = !f.hidden; if (!f.hidden) loadPosBody(f, f.pco.value); }
  };
  async function loadPosBody(f, coId) {
    const body = f.querySelector("[data-pbody]"); body.innerHTML = "<small>Loading…</small>";
    try {
      if (!xcache[coId]) { const [l, ppl] = await Promise.all([rpc("iaf_org_lookups", { p_company: coId }), rpc("iaf_company_people", { p_company: coId }).catch(() => [])]); xcache[coId] = { l, ppl }; }
      const { l, ppl } = xcache[coId], pid = f.closest(".person").dataset.id;
      body.innerHTML = `<div class="two"><label>Department<select name="pdept">${opt(l.departments, "id", (d) => d.name, "", "— choose —")}</select></label>
        <label>Job title<select name="prole">${opt(l.roles, "id", roleLabel, "", "— choose —")}</select></label></div>
        <label>Reports to <span class="opt">(optional)</span><select name="prep">${opt(ppl.filter((x) => x.id !== pid), "id", (x) => `${x.full_name} (${x.home_code})`, "", "— nobody / set later in Org chart —")}</select></label>
        <label>Main responsibility there <span class="opt">(optional)</span><input name="pnote" maxlength="120" placeholder="e.g. Oversees plant maintenance"></label>`;
    } catch (e) { body.innerHTML = errBox(e); }
  }
  el.onsubmit = (ev) => {
    ev.preventDefault(); const f = ev.target, btn = f.querySelector("button[type=submit]"), box = f.querySelector(".eerr");
    if (f.id === "addrole") return guard(btn, box, () => rpc("iaf_ensure_role", { p_company: cur.id, p_title: f.title.value.trim(), p_level: Number(f.level.value) }), "Job title added ✔");
    if (f.matches("[data-pform]")) {
      if (!f.pdept || !f.pdept.value || !f.prole.value) { box.innerHTML = errBox(new Error("Choose a department and a job title.")); return; }
      return guard(btn, box, () => rpc("iaf_position_save", { p_id: null, p_employee_id: f.closest(".person").dataset.id, p_company: f.pco.value, p_dept_id: f.pdept.value, p_role_id: f.prole.value, p_reports_to: nz(f.prep.value), p_note: nz(f.pnote.value.trim()) }), "Position added ✔");
    }
    if (f.id === "addemp") return guard(btn, box, () => rpc("iaf_employee_save", saveArgs(f, null)), "Person added ✔");
    if (f.matches("[data-eform]")) { const id = f.closest(".person").dataset.id; return guard(btn, box, () => rpc("iaf_employee_save", saveArgs(f, id)), "Saved ✔"); }
  };
  el.onchange = async (ev) => {
    if (ev.target.name === "pco") return loadPosBody(ev.target.closest("form"), ev.target.value);
    const row = ev.target.closest(".lvl"); if (!row) return;
    try { await rpc("iaf_set_role_level", { p_role_id: row.dataset.role, p_level: Number(ev.target.value) }); toast("Level updated ✔"); await reload(); } catch (e) { toast(e.message, true); }
  };
  el.querySelector("#empfile").onchange = (ev) => { const file = ev.target.files[0]; ev.target.value = ""; if (file) startImport(file); };

  // ------------------------------------------------------------------ import flow
  async function startImport(file) {
    const box = el.querySelector("#imp"); box.innerHTML = `<div class="empty small">Reading ${esc(file.name)}…</div>`;
    let rows = [], salary = 0;
    try {
      const sheets = await readAnyFile(file), got = [];
      for (const s of sheets) {
        let m; try { m = mapEmployeeRows(s.rows); } catch (e) { if (sheets.length > 1) continue; throw e; }
        // "department per tab": when a sheet has no department column, the tab name is the department
        m.rows.forEach((r) => { if (!r.department && sheets.length > 1) r.department = s.name.trim(); });
        got.push(...m.rows);
      }
      rows = got; salary = rows.filter((r) => r.basic != null || r.new_basic != null).length;
      if (!rows.length) throw new Error("No people found in that file.");
    } catch (e) { box.innerHTML = errBox(e); return; }
    const guess = (/\b(MSSI|WCLI|CWLI)\b/i.exec(file.name) || [])[1];
    const coPick = companies.find((c) => c.short_code === (guess || "").toUpperCase()) || cur;
    const deptCounts = {}; rows.forEach((r) => { if (r.department) deptCounts[r.department] = (deptCounts[r.department] || 0) + 1; });
    const imp = { rows, company: coPick.short_code, deptMap: suggestDeptMap(deptCounts), levels: {}, salary };
    await preview(imp, box);
  }
  async function preview(imp, box) {
    box.innerHTML = `<div class="empty small">Checking…</div>`;
    let res;
    try { res = await rpc("iaf_import_employees", { p_company_code: imp.company, p_rows: imp.rows, p_commit: false, p_dept_map: imp.deptMap, p_title_levels: imp.levels }); }
    catch (e) { box.innerHTML = errBox(e); return; }
    const s = res.summary, warns = res.rows.filter((r) => r.warnings && r.warnings.length);
    const rawDepts = Object.keys(imp.rows.reduce((a, r) => (r.department ? ((a[r.department] = 1), a) : a), {}));
    const levelOf = (t) => imp.levels[t.title] ?? t.level;
    box.innerHTML = `<div class="imp">
      <label>Import into company<select id="impco">${companies.map((c) => `<option value="${esc(c.short_code)}"${c.short_code === imp.company ? " selected" : ""}>${esc(c.short_code)} — ${esc(c.name)}</option>`).join("")}</select></label>
      <div class="alert ok"><b>${rows2(imp.rows.length)} found.</b> ${s.create} new · ${s.update} already in the list (will be updated) · ${s.skip} skipped${imp.salary ? ` · salary records for ${imp.salary} (stored for HR only)` : ""}.</div>
      <h3>Departments</h3><p class="s">Fix spelling here if needed. Names that match an existing department are joined to it.</p>
      ${rawDepts.map((d) => `<div class="between deptmap"><span>${esc(d)}</span><input data-d="${esc(d)}" value="${esc(imp.deptMap[d] || d)}" maxlength="60"></div>`).join("")}
      ${res.new_titles.length ? `<h3>New job titles — set the level</h3><p class="s">${res.new_titles.length} titles are new. I suggested a level from the wording (Manager = 3, Supervisor / Head = 2, otherwise Staff). Please check, especially anyone who approves leave.</p>
        ${res.new_titles.map((t) => `<div class="between lvl2"><span>${esc(t.title)}</span><select data-t="${esc(t.title)}">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${n === levelOf(t) ? " selected" : ""}>${n} — ${LEVELS[n]}</option>`).join("")}</select></div>`).join("")}` : ""}
      ${warns.length ? `<h3>Please check</h3><ul class="warnlist">${warns.map((r) => `<li><b>${esc(r.name)}</b> — ${esc(r.warnings.join("; "))}</li>`).join("")}</ul>` : ""}
      <div id="iperr"></div><div class="btns"><button class="btn primary" id="doimp">Confirm &amp; import ${s.create + s.update} people</button><button class="btn" id="cancelimp">Cancel</button></div></div>`;
    const readInputs = () => { box.querySelectorAll("[data-d]").forEach((i) => { const v = i.value.trim(); if (v && v !== i.dataset.d) imp.deptMap[i.dataset.d] = v; else delete imp.deptMap[i.dataset.d]; });
      box.querySelectorAll("[data-t]").forEach((i) => (imp.levels[i.dataset.t] = Number(i.value))); };
    box.querySelector("#impco").onchange = (ev) => { readInputs(); imp.company = ev.target.value; preview(imp, box); };
    box.querySelectorAll("[data-d]").forEach((i) => (i.onchange = () => { readInputs(); preview(imp, box); }));
    box.querySelector("#cancelimp").onclick = () => (box.innerHTML = "");
    box.querySelector("#doimp").onclick = async (ev) => {
      readInputs(); ev.target.disabled = true; box.querySelector("#iperr").innerHTML = "";
      try {
        const r = await rpc("iaf_import_employees", { p_company_code: imp.company, p_rows: imp.rows, p_commit: true, p_dept_map: imp.deptMap, p_title_levels: imp.levels });
        toast(`Imported: ${r.summary.create} new, ${r.summary.update} updated ✔`);
        if (imp.company !== cur.short_code) { const c = companies.find((x) => x.short_code === imp.company); if (c) state.empCompany = c.id; }
        await reload();
      } catch (e) { box.querySelector("#iperr").innerHTML = errBox(e); ev.target.disabled = false; }
    };
  }
  const rows2 = (n) => `${n} ${n === 1 ? "person" : "people"}`;
}
