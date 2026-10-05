// Employees page (Administrator / HR): the company's people list, Excel/CSV upload with a preview, add or edit one person.
// Salary figures found in an uploaded file are sent to the server and kept in a table only HR can read; this page never shows them.
import { readAnyFile, mapEmployeeRows, mapChildrenRows, suggestDeptMap } from "./xlsxread.js";
import { templateCsv, exportCsv, childrenTemplateCsv, childrenExportCsv, downloadCsv, humanField, renderP201 } from "./p201.js";

const RANKS = { 1: "Rank and File", 2: "Staff", 3: "Supervisor", 4: "Manager", 5: "Head / HR Manager", 6: "Director", 7: "Managing Director" };
const RANK_OPTS = (sel) => [7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}"${n === sel ? " selected" : ""}>${RANKS[n]}</option>`).join("");
const STATUS = ["active", "inactive", "separated"];
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—");

export async function renderEmployees(el, { rpc, esc, toast, errBox, state }) {
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let companies;
  try { companies = await rpc("iaf_my_companies"); } catch (e) { el.innerHTML = errBox(e); return; }
  if (!companies.length) { el.innerHTML = `<div class="empty">No company available.</div>`; return; }
  const cur = companies.find((c) => c.id === state.empCompany) || companies[0]; state.empCompany = cur.id;
  let dir, lk, extras, depts;
  try { [dir, lk, extras, depts] = await Promise.all([rpc("iaf_employee_directory", { p_company: cur.id }), rpc("iaf_org_lookups", { p_company: cur.id }), rpc("iaf_employee_extras", { p_company: cur.id }), rpc("iaf_dept_list", { p_company: cur.id })]); } catch (e) { el.innerHTML = errBox(e); return; }
  const xcache = {};   // lookups of other companies, loaded only when someone opens "add another position"
  const extrasOf = (id) => extras.filter((x) => x.employee_id === id);
  const visitors = extras.filter((x) => x.company_id === cur.id && x.home_company_id !== cur.id);
  const canLevels = state.isAdmin;
  const opt = (rows, val, label, sel, none) => `${none ? `<option value="">${esc(none)}</option>` : ""}${rows.map((r) => `<option value="${esc(r[val])}"${r[val] === sel ? " selected" : ""}>${esc(label(r))}</option>`).join("")}`;
  const deptName = (list) => { const m = Object.fromEntries(list.map((d) => [d.id, d.name])); return (d) => (d.parent_id && m[d.parent_id] ? `${m[d.parent_id]} › ${d.name}` : d.name); };
  const deptLabel = deptName(lk.departments);
  const roleLabel = (r) => `${r.title} · ${RANKS[r.rank] || ""}`;
  const rankOf = Object.fromEntries(lk.roles.map((r) => [r.id, r.rank]));
  const q = (state.empQuery || "").toLowerCase();
  const stF = state.empStatus || "current";
  const stOk = (p) => (stF === "all" ? true : stF === "current" ? p.status !== "separated" : p.status === stF);
  const shown = dir.filter((p) => stOk(p) && (!q || `${p.full_name} ${p.role_title || ""} ${p.dept_name || ""} ${p.employee_no || ""}`.toLowerCase().includes(q)));
  const groups = {}; shown.forEach((p) => (groups[p.dept_name || "No department"] ||= []).push(p));
  const active = dir.filter((p) => p.status === "active").length, sepCount = dir.filter((p) => p.status === "separated").length;

  const personCard = (p) => `<div class="card person prow" data-id="${esc(p.id)}">
      <div class="between"><div class="pmain"><b>${esc(p.full_name)}</b>${p.has_login ? ` <span class="chip ok">login</span>` : ""}${p.status === "active" ? "" : ` <span class="chip mute">${esc(p.status)}</span>`}<br>
        <small>${esc(p.role_title || "No job title")}${rankOf[p.role_id] ? ` · ${esc(RANKS[rankOf[p.role_id]])}` : ""} · hired ${esc(fmtD(p.hire_date))}</small></div>
        <div class="pact"><button class="link" data-edit>Edit</button><button class="link only-desktop" data-p201btn>201 file</button><button class="link" data-addpos>+ Position</button></div></div>
      ${p.role_id && companies.length > 1 ? `<div class="mirrors"><small>Same position in:</small> ${companies.filter((c) => c.id !== cur.id).map((c) => `<label class="tick"><input type="checkbox" data-mirror="${esc(c.id)}"${extrasOf(p.id).some((x) => x.company_id === c.id) ? " checked" : ""}> ${esc(c.short_code)}</label>`).join(" ")}</div>` : ""}
      ${extrasOf(p.id).map((x) => `<div class="between xpos"><small>➕ <b>${esc(x.company_code)}</b> · ${esc(x.dept_name || "no department")} · ${esc(x.role_title)}${x.note ? ` — ${esc(x.note)}` : ""}</small><button class="link" data-delpos="${esc(x.position_id)}">Remove</button></div>`).join("")}
      <div class="p201box only-desktop" data-p201 hidden></div>
      <form class="form egrid" data-eform hidden>${personFields(p)}<div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-closeform>Close</button></div></form>
      <form class="form egrid" data-pform hidden><p class="s">Main position: <b>${esc(cur.short_code)}</b> · ${esc(p.dept_name || "—")} · ${esc(p.role_title || "—")}. Leave and the login stay with the main company; this adds a second department or company.</p>
        <label>Company<select name="pco">${companies.map((c) => `<option value="${esc(c.id)}">${esc(c.short_code)}</option>`).join("")}</select></label>
        <div data-pbody class="egrid"><small>Loading…</small></div><div class="eerr"></div>
        <div class="btns"><button class="btn primary" type="submit">Add position</button><button class="btn" type="button" data-closeform>Close</button></div></form></div>`;
  function personFields(p) {
    p = p || {};
    return `<label>Full name<input name="name" required maxlength="80" value="${esc(p.full_name || "")}"></label>
      <label>Department<select name="dept">${opt(lk.departments, "id", deptLabel, p.dept_id, "— none —")}</select></label>
        <label>Job title<select name="role">${opt(lk.roles, "id", roleLabel, p.role_id, "— none —")}</select></label>
      <label>Hire date<input name="hire" type="date" value="${esc(p.hire_date || "")}"></label>
        <label>Employee no. <span class="opt">(optional)</span><input name="no" maxlength="30" value="${esc(p.employee_no || "")}"></label>
      <label>Status<select name="status">${STATUS.map((s) => `<option${s === (p.status || "active") ? " selected" : ""}>${s}</option>`).join("")}</select></label>
      <input type="hidden" name="rep" value="${esc(p.reports_to_id || "")}">`;
  }

  const ctx = { rpc, esc, toast, errBox };
  el.innerHTML = `
    <div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === cur.id ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>
    <p class="s"><b>${esc(cur.name)}</b> · ${active} active · ${sepCount} separated · ${dir.length} people in all</p>
    <p class="s only-mobile">The 201 file, uploads and exports are available on a computer.</p>
    <div class="card only-desktop"><div class="between"><b>Upload employee 201 list</b><span class="pact"><button class="link" data-tpl>Blank template</button><button class="link" data-export>Export current 201</button></span></div>
      <p class="s">One sheet for everyone: name, job, department, hire date, <b>status (active / separated)</b> and all 201 details. Upload an Excel (.xlsx) or CSV file. You will see a preview first — nothing is saved until you confirm. A <b>blank cell never erases</b> what is already saved. People already in the list are matched by Employee No, then by name; anyone else is added. Salary columns and government numbers are stored for HR staff only.</p>
      <input type="file" id="empfile" accept=".xlsx,.csv" hidden><button class="btn block" data-pick>Choose Excel / CSV file…</button><div id="imp"></div></div>
    <details class="card grp only-desktop" id="kidbox"><summary><b>Children &amp; deliveries upload</b> <span class="chip mute">for Paternity / Maternity</span></summary>
      <p class="s">Optional second sheet: one row per child (or miscarriage) with the date. Upload the main 201 sheet first so the people exist.</p>
      <div class="between"><span class="pact"><button class="link" data-ktpl>Blank template</button><button class="link" data-kexport>Export current</button></span></div>
      <input type="file" id="kidfile" accept=".xlsx,.csv" hidden><button class="btn block" data-kpick>Choose Excel / CSV file…</button><div id="kidimp"></div></details>
    <details class="card grp" id="deptbox"${state.deptOpen ? " open" : ""}><summary><b>Departments &amp; sections</b> <span class="chip mute">${depts.filter((d) => d.is_active).length}</span></summary>
      <p class="s">A section belongs to a department (for example Supply Chain → PPIC, Logistics). Nothing is fixed: add, rename, move or switch off at any time. A section has no approver of its own: leave follows the org chart, or the primary approver ticked there.</p>
      <form class="form egrid" id="adddept"><label>Name<input name="name" required maxlength="80" placeholder="e.g. PPIC"></label>
        <label>Section of<select name="parent"><option value="">— a main department —</option>${depts.filter((d) => d.is_active && !d.parent_id).map((d) => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join("")}</select></label>
        <div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Add</button></div></form>
      ${depts.map((d) => `<div class="drow${d.parent_id ? " sec" : ""}${d.is_active ? "" : " off"}" data-d="${esc(d.id)}"><div class="between"><span><b>${esc(d.name)}</b>${d.parent_id ? ' <span class="chip mute">section</span>' : ""}${d.is_active ? "" : ' <span class="chip mute">switched off</span>'}
          <small> · ${d.people} people${d.approver_name ? ` · ✓ approver: ${esc(d.approver_name)}${d.approver_has_login ? "" : " (no login yet)"}` : ""}</small></span>
          <span class="pact"><button class="link" data-dedit>Edit</button>${d.parent_id || !d.is_active ? "" : '<button class="link" data-dsec>+ Section</button>'}${d.is_active ? '<button class="link" data-dremoveopen>Remove</button>' : '<button class="link" data-dact="1">Switch on</button>'}</span></div>
        <form class="form egrid" data-dform hidden><label>Name<input name="name" required maxlength="80" value="${esc(d.name)}"></label>
          <label>Section of<select name="parent"><option value="">— a main department —</option>${depts.filter((x) => x.is_active && !x.parent_id && x.id !== d.id).map((x) => `<option value="${esc(x.id)}"${x.id === d.parent_id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
          <div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-dclose>Close</button></div></form>
        <form class="form egrid" data-dremove hidden><p class="s">Removing hides this ${d.parent_id ? "section" : "department"} (history is kept). Anyone still in it${d.parent_id ? "" : ", and its sections,"} moves to the one you choose.</p>
          <label>Move everyone to<select name="to"><option value="">— nobody is here —</option>${depts.filter((x) => x.is_active && x.id !== d.id && x.parent_id !== d.id && !(d.parent_id === null && x.parent_id)).map((x) => `<option value="${esc(x.id)}">${x.parent_id ? "↳ " : ""}${esc(x.name)}</option>`).join("")}</select></label>
          <div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Remove</button><button class="btn" type="button" data-dclose>Close</button></div></form></div>`).join("") || "<small>No departments yet.</small>"}
    </details>
    <div class="between"><h2>People</h2><button class="btn" data-addp>+ Add a person</button></div>
    <div id="addbox" hidden><form class="card form" id="addemp">${personFields(null)}<div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Add person</button><button class="btn" type="button" data-canceladd>Cancel</button></div></form></div>
    <div class="between filt"><input class="search" id="empq" type="search" placeholder="Search name, job title, department or employee no." value="${esc(state.empQuery || "")}">
      <select id="empst" aria-label="Show">${[["current", "Active & inactive"], ["active", "Active only"], ["inactive", "Inactive"], ["separated", "Separated"], ["all", "Everyone"]].map(([k, t]) => `<option value="${k}"${k === stF ? " selected" : ""}>${t}</option>`).join("")}</select></div>
    ${visitors.length ? `<details class="grp" open><summary><b>Also works here (main job elsewhere)</b> <span class="chip mute">${visitors.length}</span></summary>${visitors.map((x) => `<div class="card vperson"><div class="between"><div><b>${esc(x.full_name)}</b> <span class="chip mute">main: ${esc(x.home_code)}</span><br><small>${esc(x.role_title)} · ${esc(x.dept_name || "no department")}${x.note ? ` — ${esc(x.note)}` : ""}</small></div><button class="link" data-delpos="${esc(x.position_id)}">Remove</button></div></div>`).join("")}</details>` : ""}
    <div class="list">${Object.keys(groups).sort().map((g) => `<details class="grp" ${q || Object.keys(groups).length < 4 ? "open" : ""}><summary><b>${esc(g)}</b> <span class="chip mute">${groups[g].length}</span></summary><div class="gl">${groups[g].map(personCard).join("")}</div></details>`).join("") || `<div class="empty">No people yet. Upload a file above or add someone.</div>`}</div>
    <h2>Job titles${canLevels ? " &amp; levels" : ""}</h2>
    <div class="card"><b>Add a job title</b><p class="s">Needed before you can give someone that title. Pick where it sits on the ladder: Managing Director → Director → Head / HR Manager → Manager → Supervisor → Staff → Rank and File. Supervisor and above approve leave; Head and Director also see the company's leave. Adding a title that already exists changes nothing.</p>
      <form class="form egrid" id="addrole"><label>Job title<input name="title" required maxlength="80"></label>
        <label>Ladder<select name="rank">${RANK_OPTS(2)}</select></label><div class="eerr"></div>
        <div class="btns"><button class="btn primary" type="submit">Add job title to ${esc(cur.short_code)}</button></div></form></div>
    ${canLevels ? `<div class="card"><p class="s">The ladder position belongs to the job title, so everyone with that title follows it. Supervisor and above approve leave (Staff and Rank and File never do, even if people report to them). Head and Director also see everyone's leave in the company. Salary records are separate: only people marked “HR staff” in the Admin tab can read them.</p>
      ${lk.roles.map((r) => `<div class="between lvl" data-role="${esc(r.id)}"><span>${esc(r.title)}</span><select>${RANK_OPTS(r.rank)}</select></div>`).join("") || "<small>No job titles yet.</small>"}</div>` : ""}`;

  const reload = () => renderEmployees(el, { rpc, esc, toast, errBox, state });
  const nz = (v) => v || null;
  const saveArgs = (f, id) => ({ p_id: id || null, p_company: cur.id, p_full_name: f.name.value.trim(), p_dept_id: nz(f.dept.value), p_role_id: nz(f.role.value), p_hire_date: nz(f.hire.value),
    p_employee_no: nz(f.no.value.trim()), p_status: f.status.value, p_reports_to: nz(f.rep.value) });
  const guard = async (btn, box, fn, ok) => { btn.disabled = true; if (box) box.innerHTML = ""; try { await fn(); toast(ok); await reload(); } catch (e) { if (box) box.innerHTML = errBox(e); else toast(e.message, true); btn.disabled = false; } };

  el.querySelector("#deptbox").addEventListener("toggle", (e) => { state.deptOpen = e.target.open; });
  el.querySelector("#empq").oninput = (ev) => { state.empQuery = ev.target.value; const pos = ev.target.selectionStart; reload().then(() => { const i = el.querySelector("#empq"); i.focus(); i.setSelectionRange(pos, pos); }); };
  el.onclick = (ev) => {
    const co = ev.target.closest("[data-co]"); if (co) { state.empCompany = co.dataset.co; state.empQuery = ""; return reload(); }
    if (ev.target.closest("[data-tpl]")) return downloadCsv("IAF_201_template.csv", templateCsv());
    if (ev.target.closest("[data-ktpl]")) return downloadCsv("IAF_children_template.csv", childrenTemplateCsv());
    if (ev.target.closest("[data-export]") || ev.target.closest("[data-kexport]")) { const kids = !!ev.target.closest("[data-kexport]");
      return rpc("iaf_employee_201_export", { p_company: cur.id }).then((x) => downloadCsv(`IAF_${kids ? "children" : "201"}_${cur.short_code}_${new Date().toISOString().slice(0, 10)}.csv`, kids ? childrenExportCsv(x.children) : exportCsv(x.people))).catch((e) => toast(e.message, true)); }
    if (ev.target.closest("[data-kpick]")) return el.querySelector("#kidfile").click();
    if (ev.target.closest("[data-pick]")) return el.querySelector("#empfile").click();
    if (ev.target.closest("[data-addp]")) { el.querySelector("#addbox").hidden = false; return; }
    if (ev.target.closest("[data-canceladd]")) { el.querySelector("#addbox").hidden = true; return; }
    const de = ev.target.closest("[data-dedit]"); if (de) { const f = de.closest(".drow").querySelector("[data-dform]"); f.hidden = !f.hidden; return; }
    const dro = ev.target.closest("[data-dremoveopen]"); if (dro) { const f = dro.closest(".drow").querySelector("[data-dremove]"); f.hidden = !f.hidden; return; }
    if (ev.target.closest("[data-dclose]")) { ev.target.closest("form").hidden = true; return; }
    const ds = ev.target.closest("[data-dsec]"); if (ds) { const f = el.querySelector("#adddept"); f.parent.value = ds.closest(".drow").dataset.d; f.name.focus(); f.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    const da = ev.target.closest("[data-dact]"); if (da) return guard(da, null, () => rpc("iaf_dept_set_active", { p_id: da.closest(".drow").dataset.d, p_active: true }), "Switched on ✔");
    const dp = ev.target.closest("[data-delpos]"); if (dp) { if (!confirm("Remove this additional position?")) return; return guard(dp, null, () => rpc("iaf_position_delete", { p_id: dp.dataset.delpos }), "Position removed ✔"); }
    const c = ev.target.closest(".person"); if (!c) return;
    const sync = () => c.classList.toggle("open", !c.querySelector("[data-eform]").hidden || !c.querySelector("[data-pform]").hidden || !c.querySelector("[data-p201]").hidden);
    if (ev.target.closest("[data-p201btn]")) { const b = c.querySelector("[data-p201]"); b.hidden = !b.hidden; if (!b.hidden && !b.dataset.loaded) { b.dataset.loaded = "1"; renderP201(b, c.dataset.id, ctx); } return sync(); }
    if (ev.target.closest("[data-closeform]")) { c.querySelector("[data-eform]").hidden = true; c.querySelector("[data-pform]").hidden = true; return sync(); }
    if (ev.target.closest("[data-edit]")) { const f = c.querySelector("[data-eform]"); f.hidden = !f.hidden; c.querySelector("[data-pform]").hidden = true; sync(); }
    if (ev.target.closest("[data-addpos]")) { const f = c.querySelector("[data-pform]"); f.hidden = !f.hidden; c.querySelector("[data-eform]").hidden = true; sync(); if (!f.hidden) loadPosBody(f, f.pco.value); }
  };
  async function loadPosBody(f, coId) {
    const body = f.querySelector("[data-pbody]"); body.innerHTML = "<small>Loading…</small>";
    try {
      if (!xcache[coId]) { const [l, ppl] = await Promise.all([rpc("iaf_org_lookups", { p_company: coId }), rpc("iaf_company_people", { p_company: coId }).catch(() => [])]); xcache[coId] = { l, ppl }; }
      const { l, ppl } = xcache[coId], pid = f.closest(".person").dataset.id;
      body.innerHTML = `<label>Department<select name="pdept">${opt(l.departments, "id", deptName(l.departments), "", "— choose —")}</select></label>
        <label>Job title<select name="prole">${opt(l.roles, "id", roleLabel, "", "— choose —")}</select></label></div>
        <label>Reports to <span class="opt">(optional)</span><select name="prep">${opt(ppl.filter((x) => x.id !== pid), "id", (x) => `${x.full_name} (${x.home_code})`, "", "— nobody / set later in Org chart —")}</select></label>
        <label>Main responsibility there <span class="opt">(optional)</span><input name="pnote" maxlength="120" placeholder="e.g. Oversees plant maintenance"></label>`;
    } catch (e) { body.innerHTML = errBox(e); }
  }
  el.onsubmit = (ev) => {
    ev.preventDefault(); const f = ev.target, btn = f.querySelector("button[type=submit]"), box = f.querySelector(".eerr");
    if (f.id === "adddept") return guard(btn, box, () => rpc("iaf_dept_save", { p_id: null, p_company: cur.id, p_name: f.name.value.trim(), p_parent: nz(f.parent.value) }), "Added ✔");
    if (f.matches("[data-dremove]")) return guard(btn, box, () => rpc("iaf_dept_remove", { p_id: f.closest(".drow").dataset.d, p_move_to: nz(f.to.value) }), "Removed ✔");
    if (f.matches("[data-dform]")) return guard(btn, box, () => rpc("iaf_dept_save", { p_id: f.closest(".drow").dataset.d, p_company: cur.id, p_name: f.name.value.trim(), p_parent: nz(f.parent.value) }), "Saved ✔");
    if (f.id === "addrole") return guard(btn, box, () => rpc("iaf_ensure_role_rank", { p_company: cur.id, p_title: f.title.value.trim(), p_rank: Number(f.rank.value) }), "Job title added ✔");
    if (f.matches("[data-pform]")) {
      if (!f.pdept || !f.pdept.value || !f.prole.value) { box.innerHTML = errBox(new Error("Choose a department and a job title.")); return; }
      return guard(btn, box, () => rpc("iaf_position_save", { p_id: null, p_employee_id: f.closest(".person").dataset.id, p_company: f.pco.value, p_dept_id: f.pdept.value, p_role_id: f.prole.value, p_reports_to: nz(f.prep.value), p_note: nz(f.pnote.value.trim()) }), "Position added ✔");
    }
    if (f.id === "addemp") return guard(btn, box, () => rpc("iaf_employee_save", saveArgs(f, null)), "Person added ✔");
    if (f.matches("[data-eform]")) { const id = f.closest(".person").dataset.id; return guard(btn, box, () => rpc("iaf_employee_save", saveArgs(f, id)), "Saved ✔"); }
  };
  el.onchange = async (ev) => {
    const mir = ev.target.dataset && ev.target.dataset.mirror;
    if (mir) { const on = ev.target.checked, id = ev.target.closest(".person").dataset.id;
      if (!on && !confirm("Remove this person's position in that company? Anyone reporting to them there is moved off their line.")) { ev.target.checked = true; return; }
      ev.target.disabled = true; try { await rpc("iaf_position_mirror", { p_employee: id, p_company: mir, p_on: on }); toast(on ? "Added to that company ✔" : "Removed ✔"); await reload(); } catch (e) { toast(e.message, true); ev.target.checked = !on; ev.target.disabled = false; } return; }
    if (ev.target.name === "pco") return loadPosBody(ev.target.closest("form"), ev.target.value);
    const row = ev.target.closest(".lvl"); if (!row) return;
    try { await rpc("iaf_set_role_rank", { p_role_id: row.dataset.role, p_rank: Number(ev.target.value) }); toast("Saved ✔"); await reload(); } catch (e) { toast(e.message, true); }
  };
  el.querySelector("#empst").onchange = (ev) => { state.empStatus = ev.target.value; reload(); };
  el.querySelector("#kidfile").onchange = (ev) => { const file = ev.target.files[0]; ev.target.value = ""; if (file) startKids(file); };
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
    try { res = await rpc("iaf_import_201", { p_company_code: imp.company, p_rows: imp.rows, p_commit: false, p_dept_map: imp.deptMap, p_title_levels: imp.levels }); }
    catch (e) { box.innerHTML = errBox(e); return; }
    const s = res.summary, r201 = res.rows201 || [], nErr = res.errors || 0;
    const warns = [...res.rows.filter((r) => r.warnings && r.warnings.length).map((r) => ({ name: r.name, w: r.warnings })), ...r201.filter((r) => r.warnings && r.warnings.length).map((r) => ({ name: r.name, w: r.warnings }))];
    const bad = r201.filter((r) => r.errors && r.errors.length), chg = r201.filter((r) => r.changes && r.changes.length && !(r.errors && r.errors.length));
    const rawDepts = Object.keys(imp.rows.reduce((a, r) => (r.department ? ((a[r.department] = 1), a) : a), {}));
    const levelOf = (t) => imp.levels[t.title] ?? t.rank;
    box.innerHTML = `<div class="imp">
      <label>Import into company<select id="impco">${companies.map((c) => `<option value="${esc(c.short_code)}"${c.short_code === imp.company ? " selected" : ""}>${esc(c.short_code)} — ${esc(c.name)}</option>`).join("")}</select></label>
      <div class="alert ok"><b>${rows2(imp.rows.length)} found.</b> ${s.create} new · ${s.update} already in the list (will be updated) · ${s.skip} skipped · ${res.with_changes || 0} with 201 changes${imp.salary ? ` · salary records for ${imp.salary} (stored for HR only)` : ""}.</div>
      ${bad.length ? `<div class="alert bad"><b>${bad.length} row${bad.length === 1 ? "" : "s"} must be fixed before importing.</b><ul class="warnlist">${bad.map((r) => `<li><b>${esc(r.name)}</b> (row ${r.n}) — ${esc(r.errors.join("; "))}</li>`).join("")}</ul>Correct them in your file and choose it again. Nothing has been saved.</div>` : ""}
      ${chg.length ? `<details class="chglist"><summary>What will change (${chg.length})</summary><ul class="warnlist">${chg.slice(0, 80).map((r) => `<li><b>${esc(r.name)}</b>${r.found ? "" : " <span class='chip ok'>new</span>"} — ${esc(r.changes.map(humanField).join(", "))}</li>`).join("")}${chg.length > 80 ? `<li>… and ${chg.length - 80} more</li>` : ""}</ul></details>` : ""}
      <h3>Departments</h3><p class="s">Fix spelling here if needed. Names that match an existing department are joined to it.</p>
      ${rawDepts.map((d) => `<div class="between deptmap"><span>${esc(d)}</span><input data-d="${esc(d)}" value="${esc(imp.deptMap[d] || d)}" maxlength="60"></div>`).join("")}
      ${res.new_titles.length ? `<h3>New job titles — place them on the ladder</h3><p class="s">${res.new_titles.length} titles are new. I suggested a position from the wording. Please check, especially anyone who approves leave (Supervisor and above).</p>
        ${res.new_titles.map((t) => `<div class="between lvl2"><span>${esc(t.title)}</span><select data-t="${esc(t.title)}">${RANK_OPTS(levelOf(t))}</select></div>`).join("")}` : ""}
      ${warns.length ? `<h3>Please check</h3><ul class="warnlist">${warns.map((r) => `<li><b>${esc(r.name)}</b> — ${esc(r.w.join("; "))}</li>`).join("")}</ul>` : ""}
      <div id="iperr"></div><div class="btns"><button class="btn primary" id="doimp"${nErr ? " disabled" : ""}>Confirm &amp; import ${s.create + s.update} people</button><button class="btn" id="cancelimp">Cancel</button></div></div>`;
    const readInputs = () => { box.querySelectorAll("[data-d]").forEach((i) => { const v = i.value.trim(); if (v && v !== i.dataset.d) imp.deptMap[i.dataset.d] = v; else delete imp.deptMap[i.dataset.d]; });
      box.querySelectorAll("[data-t]").forEach((i) => (imp.levels[i.dataset.t] = Number(i.value))); };
    box.querySelector("#impco").onchange = (ev) => { readInputs(); imp.company = ev.target.value; preview(imp, box); };
    box.querySelectorAll("[data-d]").forEach((i) => (i.onchange = () => { readInputs(); preview(imp, box); }));
    box.querySelector("#cancelimp").onclick = () => (box.innerHTML = "");
    box.querySelector("#doimp").onclick = async (ev) => {
      readInputs(); ev.target.disabled = true; box.querySelector("#iperr").innerHTML = "";
      try {
        const r = await rpc("iaf_import_201", { p_company_code: imp.company, p_rows: imp.rows, p_commit: true, p_dept_map: imp.deptMap, p_title_levels: imp.levels });
        toast(`Imported: ${r.summary.create} new, ${r.summary.update} updated ✔`);
        if (imp.company !== cur.short_code) { const c = companies.find((x) => x.short_code === imp.company); if (c) state.empCompany = c.id; }
        await reload();
      } catch (e) { box.querySelector("#iperr").innerHTML = errBox(e); ev.target.disabled = false; }
    };
  }
  // ------------------------------------------------------------------ children / deliveries upload
  async function startKids(file) {
    const box = el.querySelector("#kidimp"); box.innerHTML = `<div class="empty small">Reading ${esc(file.name)}…</div>`;
    let rows; try { const sheets = await readAnyFile(file); rows = mapChildrenRows(sheets[0].rows); if (!rows.length) throw new Error("No rows found in that file."); } catch (e) { box.innerHTML = errBox(e); return; }
    const guess = (/\b(MSSI|WCLI|CWLI)\b/i.exec(file.name) || [])[1], code = (companies.find((c) => c.short_code === (guess || "").toUpperCase()) || cur).short_code;
    let res; try { res = await rpc("iaf_import_children", { p_company_code: code, p_rows: rows, p_commit: false }); } catch (e) { box.innerHTML = errBox(e); return; }
    const sm = res.summary, bad = res.rows.filter((r) => r.errors && r.errors.length);
    box.innerHTML = `<div class="alert ok"><b>${rows.length} rows.</b> ${sm.add} to add · ${sm.already} already listed · ${sm.errors} with errors (${esc(code)}).</div>
      ${bad.length ? `<div class="alert bad"><ul class="warnlist">${bad.map((r) => `<li><b>${esc(r.name)}</b> (row ${r.n}) — ${esc(r.errors.join("; "))}</li>`).join("")}</ul>Fix these in your file and choose it again. Nothing has been saved.</div>` : ""}
      <div id="kerr"></div><div class="btns"><button class="btn primary" id="dokid"${sm.errors ? " disabled" : ""}>Confirm &amp; add ${sm.add}</button><button class="btn" id="cancelkid">Cancel</button></div>`;
    box.querySelector("#cancelkid").onclick = () => (box.innerHTML = "");
    box.querySelector("#dokid").onclick = async (ev) => { ev.target.disabled = true; try { const r = await rpc("iaf_import_children", { p_company_code: code, p_rows: rows, p_commit: true }); toast(`Added ${r.summary.add} ✔`); box.innerHTML = ""; } catch (e) { box.querySelector("#kerr").innerHTML = errBox(e); ev.target.disabled = false; } };
  }
  const rows2 = (n) => `${n} ${n === 1 ? "person" : "people"}`;
}
