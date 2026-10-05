// 201 file: CSV template / export, children sheet template, and the per-person 201 form (Employees page, Administrator / HR).
import { COLS201 } from "./xlsxread.js";

const BASE = [["employee_no", "Employee No", ["E-001", "E-002"]], ["name", "Name", ["Dela Cruz, Juan", "Reyes, Maria"]],
  ["position", "Position", ["Forklift Operator", "QA Inspector"]], ["department", "Department", ["Warehouse", "QA"]], ["hire_date", "Hire Date", ["2024-03-15", "2023-07-01"]]];
const ORDER = ["employee_no", "name", "middle_name", "position", "department", "hire_date", "status", ...COLS201.filter((c) => c.key !== "middle_name" && c.key !== "status").map((c) => c.key)];
const HEAD = Object.fromEntries([...BASE.map(([k, h]) => [k, h]), ...COLS201.map((c) => [c.key, c.header])]);
const EX = Object.fromEntries([...BASE.map(([k, , ex]) => [k, ex]), ...COLS201.map((c) => [c.key, c.ex || ["", ""]])]);
const q = (v) => { const s = v == null ? "" : v === true ? "Yes" : v === false ? "No" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => "﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";

export const templateCsv = () => csv([ORDER.map((k) => HEAD[k]), ORDER.map((k) => EX[k][0]), ORDER.map((k) => EX[k][1])]);
export const exportCsv = (people) => csv([ORDER.map((k) => HEAD[k]), ...people.map((p) => ORDER.map((k) => p[k]))]);
export const childrenTemplateCsv = () => csv([["Employee No", "Name", "Child Name", "Birth / Miscarriage Date", "Type", "Birth Cert On File"],
  ["E-001", "Dela Cruz, Juan", "Baby Uno", "2023-02-01", "birth", "yes"], ["E-001", "Dela Cruz, Juan", "", "2024-03-01", "miscarriage", ""]]);
export const childrenExportCsv = (rows) => csv([["Employee No", "Name", "Child Name", "Birth / Miscarriage Date", "Type", "Birth Cert On File"],
  ...rows.map((r) => [r.employee_no, r.name, r.child_name, r.event_date, r.event_type, r.birth_cert_on_file])]);
export function downloadCsv(name, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
export const humanField = (k) => (HEAD[k] || k.replace(/_/g, " ")).toLowerCase();

// ----------------------------------------------------------------------------------------------- per-person form
const YN = [["", "—"], ["yes", "Yes"], ["no", "No"]];
const GROUPS = [
  ["Personal & contact", [["middle_name", "Middle name", "text"], ["sex", "Sex", "sel", [["", "—"], ["male", "Male"], ["female", "Female"]]], ["birth_date", "Birth date", "date"],
    ["civil_status", "Civil status", "sel", [["", "—"], ["single", "Single"], ["married", "Married"], ["widowed", "Widowed"], ["separated", "Legally separated"], ["annulled", "Annulled"]]],
    ["mobile", "Mobile", "tel"], ["personal_email", "Personal email", "email"], ["present_address", "Present address", "text"], ["permanent_address", "Permanent address", "text"]]],
  ["Emergency contact", [["emergency_name", "Name", "text"], ["emergency_relation", "Relationship", "text"], ["emergency_mobile", "Mobile", "tel"]]],
  ["Employment", [["employment_type", "Employment type", "sel", [["", "—"], ["probationary", "Probationary"], ["regular", "Regular"], ["contractual", "Contractual"], ["project_based", "Project based"]]],
    ["regularization_date", "Regularization date", "date"], ["shift_start", "Shift start", "time"], ["shift_end", "Shift end", "time"], ["daily_hours", "Daily hours (8, 9 or 10)", "num"], ["company_email", "Company email", "email"]]],
  ["Leave eligibility", [["spouse_name", "Spouse name", "text"], ["marriage_cert_on_file", "Marriage certificate on file", "sel", YN], ["solo_parent", "Solo parent", "sel", YN],
    ["spic_no", "Solo Parent ID (SPIC) no.", "text"], ["spic_valid_until", "SPIC valid until", "date"], ["prior_paternity_count", "Paternity leaves already used (0–4)", "num"]]],
  ["Education", [["edu_attainment", "Highest attainment", "text"], ["edu_course", "Course", "text"]]],
  ["Separation", [["separation_date", "Separation date", "date"], ["last_day_worked", "Last day worked", "date"], ["separation_type", "Type", "sel", [["", "—"], ["resigned", "Resigned"], ["terminated", "Terminated"], ["end_of_contract", "End of contract"], ["retired", "Retired"], ["awol", "AWOL"], ["other", "Other"]]],
    ["separation_reason", "Reason", "text"], ["clearance_done", "Clearance done", "sel", YN], ["final_pay_released", "Final pay released", "sel", YN], ["rehire_eligible", "Eligible for rehire", "sel", YN]]],
];
const GOV = [["sss", "SSS no."], ["philhealth", "PhilHealth no."], ["pagibig", "Pag-IBIG no."], ["tin", "TIN"]];
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "—");

export async function renderP201(box, empId, { rpc, esc, toast, errBox }) {
  box.innerHTML = `<div class="empty small">Loading 201 file…</div>`;
  let d;
  try { d = await rpc("iaf_employee_201_get", { p_employee: empId }); } catch (e) { box.innerHTML = errBox(e); return; }
  const v = d.p201 || {}, val = (k) => { const x = v[k]; if (x == null) return ""; if (x === true) return "yes"; if (x === false) return "no"; if (k.startsWith("shift_")) return String(x).slice(0, 5); return String(x); };
  const field = ([k, label, type, opts]) => type === "sel"
    ? `<label>${esc(label)}<select name="${k}">${opts.map(([o, t]) => `<option value="${o}"${o === val(k) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`
    : `<label>${esc(label)}<input name="${k}" type="${type === "num" ? "number" : type}"${type === "num" ? ' step="0.5" min="0"' : ""} maxlength="300" value="${esc(val(k))}"></label>`;
  const verified = !!v.solo_verified_at;
  const soloState = v.solo_parent === true ? `<div class="s">${verified ? `<span class="chip ok">✔ Verified by HR${d.verified_by_name ? ` — ${esc(d.verified_by_name)}` : ""}, ${esc(fmtD(String(v.solo_verified_at).slice(0, 10)))}</span>` : `<span class="chip warn">Not verified by HR yet</span>`}
      ${d.can_verify ? `<label class="tick"><input type="checkbox" name="solo_verified"${verified ? " checked" : ""}> HR verified the SPIC${v.spic_valid_until ? ` (valid until ${esc(fmtD(v.spic_valid_until))})` : ""}</label>` : ""}</div>` : "";
  const kids = d.children || [];
  box.innerHTML = `<form class="form" data-p201form>
      ${GROUPS.map(([title, fs]) => `<h4>${esc(title)}</h4><div class="egrid">${fs.map(field).join("")}${title === "Leave eligibility" ? soloState : ""}</div>`).join("")}
      <h4>Government numbers</h4>${d.gov_visible ? `<div class="egrid">${GOV.map(([k, l]) => `<label>${esc(l)}<input name="${k}" maxlength="20" value="${esc((d.gov || {})[k] || "")}"></label>`).join("")}</div>` : `<p class="s">Visible to HR staff only.</p>`}
      <div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Save 201 file</button><button class="btn" type="button" data-pclose>Close</button></div></form>
    <h4>Children &amp; deliveries <small>(for Paternity / Maternity checks)</small></h4>
    <div class="kids">${kids.map((c) => `<div class="between kid" data-kid="${esc(c.id)}"><span>${c.event_type === "miscarriage" ? "Miscarriage" : esc(c.child_name || "Child")} · ${esc(fmtD(c.event_date))}${c.birth_cert_on_file ? ' <span class="chip ok">birth cert on file</span>' : ""}</span><button class="link" type="button" data-kdel>Delete</button></div>`).join("") || "<small>None listed.</small>"}</div>
    <form class="form egrid" data-kidform><label>Child name<input name="cname" maxlength="80" placeholder="optional for a miscarriage"></label>
      <label>Birth / miscarriage date<input name="cdate" type="date" required></label>
      <label>Type<select name="ctype"><option value="birth">Birth</option><option value="miscarriage">Miscarriage</option></select></label>
      <label class="tick"><input type="checkbox" name="ccert"> Birth certificate on file</label>
      <div class="eerr"></div><div class="btns"><button class="btn" type="submit">Add</button></div></form>`;

  box.onsubmit = async (ev) => {
    ev.preventDefault(); ev.stopPropagation(); const f = ev.target, btn = f.querySelector("button[type=submit]"), err = f.querySelector(".eerr"); err.innerHTML = ""; btn.disabled = true;
    try {
      if (f.matches("[data-kidform]")) {
        await rpc("iaf_employee_child_save", { p_employee: empId, p_id: null, p_name: f.cname.value.trim() || null, p_date: f.cdate.value || null, p_type: f.ctype.value, p_cert: f.ccert.checked ? true : null });
        toast("Added ✔"); return renderP201(box, empId, { rpc, esc, toast, errBox });
      }
      const data = {};
      for (const [, fs] of GROUPS) for (const [k] of fs) data[k] = f.elements[k].value;
      if (d.gov_visible) for (const [k] of GOV) data[k] = f.elements[k].value;
      if (d.can_verify && f.elements.solo_verified) data.solo_verified = f.elements.solo_verified.checked ? "yes" : "no";
      const r = await rpc("iaf_employee_201_save", { p_employee: empId, p_data: data });
      const w = (r && r.warnings) || [];
      toast(w.length ? `Saved ✔ — ${w[0]}` : (r && r.changes && r.changes.length ? "201 file saved ✔" : "Nothing changed"));
      renderP201(box, empId, { rpc, esc, toast, errBox });
    } catch (e) { err.innerHTML = errBox(e); btn.disabled = false; }
  };
  box.onclick = async (ev) => {
    if (ev.target.closest("[data-pclose]")) { ev.stopPropagation(); const card = box.closest(".person"); box.hidden = true; card.classList.remove("open"); return; }
    const del = ev.target.closest("[data-kdel]"); if (!del) return;
    ev.stopPropagation(); if (!confirm("Delete this entry?")) return;
    try { await rpc("iaf_employee_child_delete", { p_id: del.closest("[data-kid]").dataset.kid }); toast("Deleted ✔"); renderP201(box, empId, { rpc, esc, toast, errBox }); } catch (e) { toast(e.message, true); }
  };
}
