// Work schedules (administrator / HR staff, desktop). Templates, assignment by company / department / person, upload, and who is on what.
import { readAnyFile } from "./xlsxread.js";
import { renderShiftHr } from "./shift.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const t12 = (hhmm) => { if (!hhmm) return ""; const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "AM" : "PM"}`; };
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "");
// "Mon-Fri 8AM-5PM" style summary: groups consecutive days with identical hours
export function summarize(days) {
  const by = new Map(days.map((d) => [d.dow, d])), parts = []; let i = 1;
  while (i <= 7) {
    const d = by.get(i); if (!d) { i++; continue; }
    let j = i; while (by.has(j + 1) && by.get(j + 1).start === d.start && by.get(j + 1).end === d.end) j++;
    parts.push(`${i === j ? DAYS[i - 1] : DAYS[i - 1] + "-" + DAYS[j - 1]} ${t12(d.start)}-${t12(d.end)}`); i = j + 1;
  }
  return parts.join(", ");
}
export const dayLine = (r) => (r.unset ? "No schedule set" : r.rest ? "Rest day" : `${t12(r.start)} – ${t12(r.end)}${r.overnight ? " (next day)" : ""}`);
export const templateCsv = () => "﻿Employee No,Name,Schedule,Effective From\r\nE-001,\"Dela Cruz, Juan\",Office 5 days 8-5,2026-11-01\r\nE-002,\"Reyes, Maria\",Shift 6AM-2PM,2026-11-01\r\n";
function download(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const norm = (v) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const txt = (v) => (v == null ? "" : String(v).trim());
function isoDate(v) { if (v == null || v === "") return null; if (typeof v === "number") return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : null;
  const s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; const d = new Date(s); return Number.isNaN(+d) ? "bad" : d.toISOString().slice(0, 10); }
export function mapScheduleRows(grid) {
  let hi = -1;
  for (let i = 0; i < Math.min(grid.length, 15); i++) { const h = (grid[i] || []).map(norm); if (h.some((x) => /^schedule/.test(x))) { hi = i; break; } }
  if (hi < 0) throw new Error('Could not find the header row. The sheet needs a "Schedule" column (and "Employee No" or "Name").');
  const h = (grid[hi] || []).map(norm), at = (re) => h.findIndex((x) => re.test(x));
  const c = { no: at(/^employee (no|number)|^emp no/), name: at(/^(name|employee name|full name)$/), sch: at(/^schedule/), from: at(/effective|^start|^from/) };
  const rows = [];
  for (let i = hi + 1; i < grid.length; i++) { const r = grid[i] || [], g = (k) => (k >= 0 ? r[k] : null); if (!txt(g(c.no)) && !txt(g(c.name))) continue;
    rows.push({ employee_no: txt(g(c.no)) || null, name: txt(g(c.name)) || null, schedule: txt(g(c.sch)) || null, effective_from: isoDate(g(c.from)) }); }
  return rows;
}

let state0 = { co: null };
export async function renderSchedules(el, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let companies; try { companies = await rpc("iaf_my_companies"); } catch (e) { el.innerHTML = errBox(e); return; }
  const cur = companies.find((c) => c.id === state0.co) || companies.find((c) => c.id === state.empCompany) || companies[0]; state0.co = cur.id;
  let ov, lk; try { [ov, lk] = await Promise.all([rpc("iaf_schedule_overview", { p_company: cur.id }), rpc("iaf_org_lookups", { p_company: cur.id })]); } catch (e) { el.innerHTML = errBox(e); return; }
  const depts = lk.departments || [], name = Object.fromEntries(ov.schedules.map((s) => [s.id, s]));
  const reload = () => renderSchedules(el, ctx);
  const opts = (arr, f) => arr.map(f).join("");
  const peopleBy = ov.people.reduce((m, p) => { const k = p.schedule || "— none set —"; (m[k] = m[k] || []).push(p); return m; }, {});

  el.innerHTML = `<div class="only-mobile"><p class="s">Schedules are managed on a computer.</p></div>
  <div class="only-desktop">
  <div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === cur.id ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>

  <div class="card"><h3>Schedule templates</h3>
    <div class="schedlist">${ov.schedules.map((s) => `<div class="between sched" data-sid="${esc(s.id)}"><span><b>${esc(s.name)}</b> <span class="chip">${esc(s.kind)}</span><br><small>${esc(summarize(s.days))}${s.days[0] ? ` · ${s.days[0].hours} paid hrs/day` : ""}</small></span>
      <span><button class="link" data-edit>Edit</button> <button class="link" data-del>Delete</button></span></div>`).join("") || "<small>No templates yet.</small>"}</div>
    <div class="btns"><button class="btn" id="newsch">New schedule</button><button class="btn" id="presets">Add the standard templates</button></div>
    <div id="sform"></div></div>

  <div class="card"><h3>Assign a schedule</h3>
    <form class="form egrid" id="aform">
      <label>Applies to<select name="scope"><option value="company">Whole company</option><option value="department">A department / section</option><option value="employee">One person</option></select></label>
      <label id="tdept" hidden>Department<select name="dept">${opts(depts, (d) => `<option value="${esc(d.id)}">${d.parent_id ? "— " : ""}${esc(d.name)}</option>`)}</select></label>
      <label id="temp" hidden>Person<select name="emp">${opts(ov.people, (p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.employee_no ? " (" + esc(p.employee_no) + ")" : ""}</option>`)}</select></label>
      <label>Schedule<select name="sch">${opts(ov.schedules, (s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`)}</select></label>
      <label>Starting<input name="from" type="date" required></label>
      <label>Until (blank = until further notice)<input name="to" type="date"></label>
      <label class="wide">Note<input name="note" maxlength="200" placeholder="optional"></label>
      <div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Assign</button></div></form>
    <p class="s">The most specific one wins: a person's own schedule beats their section, then their department, then the company. Sections follow their department unless set separately.</p>
    <h4>Current and upcoming assignments</h4>
    <div>${ov.assignments.map((a) => `<div class="between"><span><b>${esc(a.target)}</b> — ${esc(a.schedule)} <small>from ${esc(fmtD(a.from))}${a.to ? " to " + esc(fmtD(a.to)) : ""}</small></span><button class="link" data-un="${esc(a.id)}">Remove</button></div>`).join("") || "<small>Nothing assigned yet.</small>"}</div></div>

  <div class="card" id="shr"></div>

  <div class="card"><h3>Upload people's schedules</h3>
    <p class="s">One row per person: Employee No (or Name), Schedule (exact template name), Effective From.</p>
    <div class="btns"><button class="btn" id="tpl">Blank template</button><label class="btn">Choose file<input type="file" id="sfile" accept=".csv,.xlsx" hidden></label></div><div id="simp"></div></div>

  <div class="card"><h3>Who is on what today</h3>
    ${Object.entries(peopleBy).map(([k, ps]) => `<details class="sec"><summary>${esc(k)} <small>${ps.length}</small></summary><div class="s">${ps.map((p) => esc(p.name) + (p.dept ? ` <small>(${esc(p.dept)})</small>` : "")).join(" · ")}</div></details>`).join("")}</div></div>`;

  el.querySelectorAll("[data-co]").forEach((b) => (b.onclick = () => { state0.co = b.dataset.co; reload(); }));
  renderShiftHr(el.querySelector("#shr"), ctx, cur.id);
  const af = el.querySelector("#aform"), syncScope = () => { el.querySelector("#tdept").hidden = af.scope.value !== "department"; el.querySelector("#temp").hidden = af.scope.value !== "employee"; };
  af.scope.onchange = syncScope; syncScope(); af.from.value = new Date().toISOString().slice(0, 10);
  af.onsubmit = async (ev) => { ev.preventDefault(); const err = af.querySelector(".eerr"); err.innerHTML = ""; const btn = af.querySelector("button[type=submit]"); btn.disabled = true;
    try { const sc = af.scope.value; await rpc("iaf_schedule_assign", { p_company: cur.id, p_scope: sc, p_target: sc === "department" ? af.dept.value : sc === "employee" ? af.emp.value : null, p_schedule: af.sch.value, p_from: af.from.value, p_to: af.to.value || null, p_note: af.note.value.trim() || null });
      toast("Assigned ✔"); reload(); } catch (e) { err.innerHTML = errBox(e); btn.disabled = false; } };
  el.querySelectorAll("[data-un]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this assignment?")) return; try { await rpc("iaf_schedule_unassign", { p_id: b.dataset.un }); toast("Removed ✔"); reload(); } catch (e) { toast(e.message, true); } }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (!confirm("Delete this schedule template?")) return; try { await rpc("iaf_schedule_delete", { p_id: b.closest("[data-sid]").dataset.sid }); toast("Deleted ✔"); reload(); } catch (e) { toast(e.message, true); } }));
  el.querySelector("#presets").onclick = async () => { try { const n = await rpc("iaf_schedule_add_presets", { p_company: cur.id }); toast(n ? `Added ${n} ✔` : "All standard templates are already there"); reload(); } catch (e) { toast(e.message, true); } };

  // template editor
  const sbox = el.querySelector("#sform");
  const editor = (s) => {
    const by = new Map((s ? s.days : []).map((d) => [d.dow, d]));
    sbox.innerHTML = `<form class="form" id="sf"><div class="egrid"><label>Name<input name="nm" maxlength="80" required value="${esc(s ? s.name : "")}"></label>
      <label>Kind<select name="kind">${["office", "shift", "custom"].map((k) => `<option${s && s.kind === k ? " selected" : ""}>${k}</option>`).join("")}</select></label></div>
      <table class="dtab"><tr><th>Day</th><th>Works</th><th>Start</th><th>End</th><th>Meal min</th><th>Meal paid</th><th>Coffee min</th></tr>
      ${DAYS.map((d, i) => { const x = by.get(i + 1) || {}; return `<tr data-d="${i + 1}"><td>${d}</td><td><input type="checkbox" name="w"${s ? (x.start ? " checked" : "") : (i < 5 ? " checked" : "")}></td>
        <td><input type="time" name="st" value="${x.start || "08:00"}"></td><td><input type="time" name="en" value="${x.end || "17:00"}"></td>
        <td><input type="number" name="bm" min="0" max="180" step="5" value="${x.break_min ?? 60}"></td><td><input type="checkbox" name="bp"${x.break_paid ? " checked" : ""}></td><td><input type="number" name="cm" min="0" max="60" step="5" value="${x.coffee_min ?? 0}"></td></tr>`; }).join("")}</table>
      <p class="s">Office day 8–5 with an unpaid 60-minute meal = 8 paid hours. Shifts: 30-minute meal paid + 15-minute coffee. An end time earlier than the start means the shift ends the next day.</p>
      <div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Save schedule</button><button class="btn" type="button" id="cs">Cancel</button></div></form>`;
    sbox.querySelector("#cs").onclick = () => (sbox.innerHTML = "");
    sbox.querySelector("#sf").onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target, err = f.querySelector(".eerr"); err.innerHTML = "";
      const days = [...f.querySelectorAll("tr[data-d]")].filter((tr) => tr.querySelector("[name=w]").checked).map((tr) => ({ dow: +tr.dataset.d, start: tr.querySelector("[name=st]").value, end: tr.querySelector("[name=en]").value,
        break_min: +tr.querySelector("[name=bm]").value || 0, break_paid: tr.querySelector("[name=bp]").checked, coffee_min: +tr.querySelector("[name=cm]").value || 0 }));
      try { await rpc("iaf_schedule_save", { p_company: cur.id, p_id: s ? s.id : null, p_name: f.nm.value, p_kind: f.kind.value, p_days: days }); toast("Saved ✔"); reload(); } catch (e) { err.innerHTML = errBox(e); } };
    sbox.scrollIntoView({ block: "nearest" });
  };
  el.querySelector("#newsch").onclick = () => editor(null);
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editor(name[b.closest("[data-sid]").dataset.sid])));

  // upload
  el.querySelector("#tpl").onclick = () => download("schedule-template.csv", templateCsv());
  el.querySelector("#sfile").onchange = async (ev) => { const file = ev.target.files[0]; ev.target.value = ""; if (!file) return; const box = el.querySelector("#simp"); box.innerHTML = `<div class="empty small">Reading ${esc(file.name)}…</div>`;
    let rows; try { const sh = await readAnyFile(file); rows = mapScheduleRows(sh[0].rows); if (!rows.length) throw new Error("No rows found in that file."); } catch (e) { box.innerHTML = errBox(e); return; }
    const call = (commit) => rpc("iaf_import_schedules", { p_company_code: cur.short_code, p_rows: rows, p_commit: commit });
    let r; try { r = await call(false); } catch (e) { box.innerHTML = errBox(e); return; }
    box.innerHTML = `<div class="alert ${r.errors.length ? "bad" : "ok"}"><b>${r.rows} rows</b> — ${r.ok} ready · ${r.errors.length} with problems (${esc(cur.short_code)}).</div>
      ${r.errors.length ? `<ul class="warnlist">${r.errors.map((x) => `<li>Row ${x.row}: ${esc(x.error)}</li>`).join("")}</ul><p class="s">Fix these in your file and choose it again. Nothing has been saved.</p>` : ""}
      <div id="serr"></div><div class="btns"><button class="btn primary" id="dosch"${r.errors.length ? " disabled" : ""}>Confirm &amp; assign ${r.ok}</button><button class="btn" id="cansch">Cancel</button></div>`;
    box.querySelector("#cansch").onclick = () => (box.innerHTML = "");
    box.querySelector("#dosch").onclick = async (e2) => { e2.target.disabled = true; try { const x = await call(true); toast(`Assigned ${x.ok} ✔`); reload(); } catch (e) { box.querySelector("#serr").innerHTML = errBox(e); e2.target.disabled = false; } }; };
}
