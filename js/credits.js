// Leave credits (administrator / HR staff, desktop): give the year's VL / SL from the company leave table,
// see everyone's balances (first-half use, SL for January cash conversion, overused credits of people who left),
// loyalty leave (extra VL HR gives an awardee for one year), and keep the leave table itself.
const BAND = { staff: "Staff", supervisor: "Supervisor", manager: "Manager", dept_head: "Department Head" };
const ACT = { create: "Will be created", update: "Will be updated", same: "Already correct", kept_manual: "Set by hand — kept", no_login: "No login yet", skip: "Not eligible" };
const n = (v) => (v === null || v === undefined || v === "" ? "—" : String(Number(v)));
let st = { co: null, year: new Date().getFullYear(), view: "report", preview: null };

export async function renderCredits(el, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let companies; try { companies = await rpc("iaf_my_companies"); } catch (e) { el.innerHTML = errBox(e); return; }
  if (!companies.length) { el.innerHTML = `<div class="empty">No companies in your access.</div>`; return; }
  const cur = companies.find((c) => c.id === st.co) || companies.find((c) => c.id === state.empCompany) || companies[0];
  if (st.co !== cur.id) st.preview = null; st.co = cur.id;
  const reload = () => renderCredits(el, ctx);
  const head = `<div class="only-mobile"><p class="s">Leave credits are managed on a computer.</p></div><div class="only-desktop">
    <div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === cur.id ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>
    <div class="between"><div class="cotabs">${[["report", "Balances"], ["grant", "Give credits"], ["loyalty", "Loyalty leave"], ["table", "Leave table"]].map(([k, t]) => `<button class="cotab${st.view === k ? " on" : ""}" data-view="${k}">${t}</button>`).join("")}</div>
      <span><button class="btn sm" data-y="-1" aria-label="Previous year">‹</button> <b>${st.year}</b> <button class="btn sm" data-y="1" aria-label="Next year">›</button></span></div>
    <div id="cbody"><div class="empty">Loading…</div></div></div>`;
  el.innerHTML = head;
  el.querySelectorAll("[data-co]").forEach((b) => (b.onclick = () => { st.co = b.dataset.co; reload(); }));
  el.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => { st.view = b.dataset.view; reload(); }));
  el.querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => { st.year += Number(b.dataset.y); st.preview = null; reload(); }));
  const body = el.querySelector("#cbody");
  try {
    if (st.view === "report") await report(body, cur, ctx);
    else if (st.view === "grant") await grant(body, cur, ctx, reload);
    else if (st.view === "loyalty") await loyalty(body, cur, ctx, reload);
    else await table(body, cur, ctx, reload);
  } catch (e) { body.innerHTML = errBox(e); }
}

async function report(body, cur, { rpc, esc }) {
  const r = await rpc("iaf_leave_balance_report", { p_company: cur.id, p_year: st.year });
  const rows = r.rows || [];
  const sep = rows.filter((x) => x.separation_date && (Number(x.vl_overused) > 0 || Number(x.sl_overused) > 0));
  const noBal = rows.filter((x) => x.vl_total === null && Number(x.vl_entitled) > 0).length;
  body.innerHTML = `<div class="card"><div class="between"><h3>Balances ${st.year} · ${esc(cur.short_code)}</h3><button class="btn sm" id="csv">Download (Excel / CSV)</button></div>
      <p class="s">January–June: only half of the year's Vacation Leave can be used; more than that needs the approver's approval. Unused Sick Leave is converted to cash in January ${st.year + 1}. Unused Vacation Leave is forfeited at year end.</p>
      ${noBal ? `<div class="alert warn">${noBal} eligible employee${noBal > 1 ? "s have" : " has"} no ${st.year} balance yet. Use <b>Give credits</b>.</div>` : ""}
      ${sep.length ? `<div class="alert bad"><b>Overused credits to deduct from final pay:</b> ${sep.map((x) => `${esc(x.name)} (VL ${n(x.vl_overused)}, SL ${n(x.sl_overused)})`).join("; ")}</div>` : ""}
      <div class="tscroll"><table class="dtab"><tr><th>Employee</th><th>Level</th><th>Type</th><th>VL given</th><th>VL used</th><th>VL left</th><th>Jan–Jun used / half</th><th>SL given</th><th>SL used</th><th>SL for cash</th></tr>
      ${rows.map((x) => `<tr${x.status !== "active" ? ' class="dim"' : ""}><td>${esc(x.name)}${x.employee_no ? `<br><small>${esc(x.employee_no)}</small>` : ""}${x.has_login ? "" : '<br><small class="warnt">no login</small>'}</td><td>${esc(x.band)}</td>
        <td>${esc(x.employment_type || "—")}</td><td>${n(x.vl_total)}${x.vl_total === null && Number(x.vl_entitled) ? `<br><small>should be ${n(x.vl_entitled)}</small>` : ""}</td><td>${n(x.vl_used)}</td><td>${n(x.vl_left)}</td>
        <td>${x.vl_total === null ? "—" : `${n(x.vl_h1_used)} / ${n(x.vl_h1_cap)}${Number(x.vl_h1_used) > Number(x.vl_h1_cap) ? ' <span class="chip warn">over</span>' : ""}`}</td>
        <td>${n(x.sl_total)}</td><td>${n(x.sl_used)}</td><td>${x.sl_total === null ? "—" : n(x.sl_unused_for_cash)}</td></tr>`).join("") || `<tr><td colspan="10">No employees.</td></tr>`}</table></div></div>`;
  body.querySelector("#csv").onclick = () => {
    const cols = [["employee_no", "Employee no."], ["name", "Name"], ["dept", "Department"], ["band", "Level"], ["employment_type", "Employment type"], ["regularization_date", "Regularized"], ["separation_date", "Separated"],
      ["vl_entitled", "VL entitled"], ["vl_total", "VL given"], ["vl_used", "VL used"], ["vl_left", "VL left"], ["vl_h1_used", "VL used Jan-Jun"], ["vl_h1_cap", "VL Jan-Jun half"],
      ["sl_entitled", "SL entitled"], ["sl_total", "SL given"], ["sl_used", "SL used"], ["sl_unused_for_cash", "SL for cash conversion"], ["vl_overused", "VL overused"], ["sl_overused", "SL overused"]];
    const q = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + [cols.map((c) => q(c[1])).join(","), ...rows.map((x) => cols.map((c) => q(x[c[0]])).join(","))].join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `Leave_balances_${cur.short_code}_${st.year}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };
}

async function grant(body, cur, { rpc, esc, toast, errBox }, reload) {
  if (!st.preview) st.preview = await rpc("iaf_leave_grant_year", { p_company: cur.id, p_year: st.year, p_apply: false, p_overwrite: false });
  const p = st.preview, by = {};
  (p.rows || []).forEach((r) => { (by[r.employee_id] ||= { name: r.name, no: r.employee_no, band: r.band, basis: r.basis })[r.code] = r; });
  const people = Object.values(by), c = p.counts || {};
  const willChange = (c.create || 0) + (c.update || 0);
  const cell = (r) => (r ? `${n(r.days)}${r.current !== null && r.current !== undefined && Number(r.current) !== Number(r.days) ? ` <small>(now ${n(r.current)})</small>` : ""}<br><small>${esc(ACT[r.action] || r.action)}</small>` : "—");
  body.innerHTML = `<div class="card"><h3>Give ${st.year} leave credits · ${esc(cur.short_code)}</h3>
      <p class="s">Credits are given in full for the year from the leave table (level of the employee's highest position). Regular employees only. Someone regularized during ${st.year} gets a share from the month they became regular. People without a login are listed but get their balance once their login is linked.</p>
      <p><b>${willChange}</b> balance${willChange === 1 ? "" : "s"} will be created or updated · ${c.same || 0} already correct · ${c.kept_manual || 0} set by hand (kept) · ${c.no_login || 0} without login · ${c.skip || 0} not eligible.</p>
      <div class="btns"><button class="btn primary" id="apply" ${willChange ? "" : "disabled"}>Give credits now</button>${c.kept_manual ? ` <label class="s"><input type="checkbox" id="ow"> also replace the ${c.kept_manual} set by hand</label>` : ""}</div><div class="eerr"></div>
      <div class="tscroll"><table class="dtab"><tr><th>Employee</th><th>Level</th><th>Vacation Leave</th><th>Sick Leave</th><th>Basis</th></tr>
      ${people.map((x) => `<tr><td>${esc(x.name)}${x.no ? `<br><small>${esc(x.no)}</small>` : ""}</td><td>${esc(x.band || "")}</td><td>${cell(x.VL)}</td><td>${cell(x.SL)}</td><td><small>${esc(x.basis || "")}</small></td></tr>`).join("") || `<tr><td colspan="5">No active employees.</td></tr>`}</table></div></div>`;
  const ap = body.querySelector("#apply"), ow = body.querySelector("#ow");
  if (ow) ow.onchange = () => { ap.disabled = !(willChange || ow.checked); };
  ap.onclick = async () => {
    if (!confirm(`Give ${st.year} leave credits for ${cur.short_code}?`)) return;
    ap.disabled = true;
    try { const out = await rpc("iaf_leave_grant_year", { p_company: cur.id, p_year: st.year, p_apply: true, p_overwrite: !!ow?.checked });
      const k = out.counts || {}; toast(`Done ✔ ${(k.create || 0)} created, ${(k.update || 0)} updated`); st.preview = null; st.view = "report"; reload(); }
    catch (e) { body.querySelector(".eerr").innerHTML = errBox(e); ap.disabled = false; }
  };
}

async function table(body, cur, { rpc, esc, toast, errBox }, reload) {
  const rules = await rpc("iaf_leave_rules_list");
  const codes = [["VL", "Vacation Leave"], ["SL", "Sick Leave"], ["BIRTHDAY", "Birthday Leave"], ["BEREAVEMENT", "Bereavement Leave"]];
  const grid = (code) => Object.values(BAND).map((b) => rules.filter((r) => r.code === code && r.band === b));
  body.innerHTML = `<div class="card"><h3>Company leave table (days per year)</h3>
      <div class="tscroll"><table class="dtab"><tr><th>Level</th>${codes.map(([, t]) => `<th>${t}</th>`).join("")}</tr>
      ${Object.values(BAND).map((b, i) => `<tr><td>${b}</td>${codes.map(([c]) => `<td>${grid(c)[i].map((r) => `${n(r.days)}${Number(r.min_service_years) ? ` <small>from ${n(r.min_service_years)} yrs</small>` : ""}${r.company !== "All companies" ? ` <small>(${esc(r.company)})</small>` : ""}`).join("<br>") || "—"}</td>`).join("")}</tr>`).join("")}</table></div>
      <p class="s">Head of Plant Operation and Managing Director use the Department Head row. Years of service are counted from the hire date up to January 1.</p></div>
    <div class="card"><h3>Add or change a row</h3><p class="s">Leave is given by job level (HR, Oct 2026). Extra days for loyalty awardees go under <b>Loyalty leave</b>. Years of service here is only for a rule that starts after some years. Changes apply the next time credits are given.</p>
      <form class="form" id="rform"><div class="two"><label>Leave<select name="c">${codes.map(([c, t]) => `<option value="${c}">${t}</option>`).join("")}</select></label>
        <label>Level<select name="b">${Object.entries(BAND).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label></div>
        <div class="two"><label>From years of service<input type="number" name="y" min="0" max="60" step="0.5" value="0"></label><label>Days per year<input type="number" name="d" min="0" max="366" step="0.5" required></label></div>
        <div class="two"><label>Applies to<select name="co"><option value="">All companies</option><option value="${esc(cur.id)}">${esc(cur.short_code)} only</option></select></label><label>Note (optional)<input name="note" maxlength="300" placeholder="e.g. HR memo no."></label></div>
        <div class="eerr"></div><button class="btn primary" type="submit">Save row</button></form></div>
    <div class="card" id="confcard"><h3>Confidential leave (RA 9262)</h3><p class="s">Loading…</p></div>`;
  confCard(body.querySelector("#confcard"), cur, { rpc, esc, toast, errBox });
  const f = body.querySelector("#rform");
  f.onsubmit = async (ev) => { ev.preventDefault(); f.querySelector(".eerr").innerHTML = "";
    try { await rpc("iaf_leave_rule_save", { p_company: f.co.value || null, p_code: f.c.value, p_band: f.b.value, p_min_years: Number(f.y.value || 0), p_days: Number(f.d.value), p_effective: `${st.year}-01-01`, p_note: f.note.value || null });
      toast("Saved ✔"); st.preview = null; reload(); }
    catch (e) { f.querySelector(".eerr").innerHTML = errBox(e); } };
}

// who receives confidential leave (the HR Manager decides; she can hand single cases to a supervisor from the request)
async function confCard(box, cur, { rpc, esc, toast, errBox }) {
  try {
    const g = await rpc("iaf_leave_settings_get", { p_company: cur.id });
    const staff = g.hr_staff || [];
    const nowName = g.effective_receiver === g.hr_manager_id ? g.hr_manager_name : ((staff.find((x) => x.id === g.effective_receiver) || {}).full_name);
    const mgr = g.hr_manager_name ? `HR Manager — ${esc(g.hr_manager_name)} (default)` : "HR Manager (default) — none with a login on the organizational chart yet";
    box.innerHTML = `<h3>Confidential leave (RA 9262)</h3>
      <p class="s">These requests skip the supervisor and manager and go to the HR Manager. The HR Manager may hand this to an HR supervisor or HR staff member, and on each request HR can hand a single case to a supervisor or manager when needed.</p>
      <p class="s">Now going to: <b>${esc(nowName || "nobody — employees are told to contact HR directly")}</b></p>
      ${g.can_change ? `<form class="form" id="cform2"><label>Goes to<select name="r"><option value="">${mgr}</option>
        ${staff.map((x) => `<option value="${esc(x.id)}" ${g.confidential_receiver === x.id ? "selected" : ""}>${esc(x.full_name)}</option>`).join("")}</select></label>
        ${staff.length ? "" : `<p class="s">No HR supervisor or staff account in ${esc(cur.short_code)} yet to hand it to.</p>`}
        <div class="eerr"></div><button class="btn primary" type="submit">Save</button></form>`
        : `<p class="s">Only the HR Manager can change this.</p>`}`;
    const f = box.querySelector("#cform2");
    if (f) f.onsubmit = async (ev) => { ev.preventDefault(); f.querySelector(".eerr").innerHTML = "";
      try { await rpc("iaf_leave_settings_save", { p_company: cur.id, p_receiver: f.r.value || null }); toast("Saved ✔"); confCard(box, cur, { rpc, esc, toast, errBox }); }
      catch (e) { f.querySelector(".eerr").innerHTML = errBox(e); } };
  } catch (e) { box.innerHTML = `<h3>Confidential leave (RA 9262)</h3>` + errBox(e); }
}

// Loyalty leave: extra Vacation Leave days for a loyalty awardee, usable only in the year chosen (no carry over).
async function loyalty(body, cur, { rpc, esc, toast, errBox }, reload) {
  const [list, dir] = await Promise.all([rpc("iaf_leave_loyalty_list", { p_company: cur.id, p_year: st.year }), rpc("iaf_employee_directory", { p_company: cur.id })]);
  const emps = (dir || []).filter((e) => e.status === "active");
  const yrs = (d) => (d ? Math.floor((Date.now() - new Date(d + "T00:00:00")) / (365.25 * 86400000)) : null);
  body.innerHTML = `<div class="card"><h3>Loyalty leave ${st.year} · ${esc(cur.short_code)}</h3>
      <p class="s">Extra Vacation Leave for loyalty awardees. The days are added to the employee's ${st.year} Vacation Leave, must be used within ${st.year} and do not carry over. Use the year arrows above to choose the year (usually the year after the award).</p>
      <div class="tscroll"><table class="dtab"><tr><th>Employee</th><th>Hired</th><th>Award</th><th>Extra VL</th><th>Note</th><th></th></tr>
      ${list.map((x) => `<tr><td>${esc(x.name)}${x.employee_no ? `<br><small>${esc(x.employee_no)}</small>` : ""}</td><td>${x.hire_date ? esc(x.hire_date) : "—"}</td>
        <td>${x.milestone_years ? `${esc(String(x.milestone_years))} years` : "—"}</td><td>${n(x.days)} day(s)${x.added ? "" : '<br><small class="warnt">not added (not a regular employee or 201 incomplete)</small>'}</td>
        <td>${esc(x.note || "")}</td><td><button class="link" data-rm="${esc(x.id)}">Remove</button></td></tr>`).join("") || `<tr><td colspan="6">No loyalty leave for ${st.year} yet.</td></tr>`}</table></div></div>
    <div class="card"><h3>Give loyalty leave for ${st.year}</h3><form class="form" id="lform">
      <label>Employee<input name="emp" list="lemps" required placeholder="Type a name" autocomplete="off"><datalist id="lemps">${emps.map((e) => `<option value="${esc(e.full_name)}${e.employee_no ? ` · ${esc(e.employee_no)}` : ""}"></option>`).join("")}</datalist><small id="lhint"></small></label>
      <div class="two"><label>Extra VL days<input type="number" name="d" min="0.5" max="30" step="0.5" required></label><label>Years of service awarded <span class="opt">(optional)</span><input type="number" name="m" min="1" max="60" step="1" placeholder="e.g. 10"></label></div>
      <label>Note <span class="opt">(optional)</span><input name="note" maxlength="300" placeholder="e.g. 10-year loyalty award, Dec 2026 program"></label>
      <div class="eerr"></div><button class="btn primary" type="submit">Save</button></form>
      <p class="s">If ${st.year} credits were already given, the employee's Vacation Leave is updated right away (unless it was set by hand). If not yet, the days are included when you use <b>Give credits</b>.</p></div>`;
  const f = body.querySelector("#lform");
  const pick = () => { const v = f.emp.value.trim(); return emps.find((e) => `${e.full_name}${e.employee_no ? ` · ${e.employee_no}` : ""}` === v) || emps.find((e) => e.full_name === v) || null; };
  f.emp.oninput = () => { const e = pick(); const y = e && yrs(e.hire_date); body.querySelector("#lhint").textContent = e ? `${e.dept_name || ""}${e.hire_date ? ` · hired ${e.hire_date}${y !== null ? ` (${y} years)` : ""}` : " · hire date missing"}` : ""; if (e && y && !f.m.value) f.m.value = y; };
  f.onsubmit = async (ev) => {
    ev.preventDefault(); const err = f.querySelector(".eerr"); err.innerHTML = ""; const e = pick();
    if (!e) { err.innerHTML = errBox(new Error("Choose the employee from the list.")); return; }
    try {
      const r = await rpc("iaf_leave_loyalty_save", { p_employee: e.id, p_year: st.year, p_days: Number(f.d.value), p_milestone: f.m.value ? Number(f.m.value) : null, p_note: f.note.value || null });
      toast(r.balance === "updated" ? `Saved ✔ ${e.full_name}'s ${st.year} VL is now ${n(r.total)} days` : r.balance === "kept_manual" ? "Saved ✔ Their VL was set by hand: add the days there too." : "Saved ✔ The days are added when credits are given.");
      reload();
    } catch (x) { err.innerHTML = errBox(x); }
  };
  body.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this loyalty leave?")) return; try { await rpc("iaf_leave_loyalty_remove", { p_id: b.dataset.rm }); toast("Removed ✔"); reload(); } catch (x) { toast(x.message, true); } }));
}
