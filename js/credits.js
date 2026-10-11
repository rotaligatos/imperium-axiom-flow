// Leave credits (administrator / HR staff, desktop): give the year's VL / SL from the company leave table,
// see everyone's balances (first-half use, SL for January cash conversion, overused credits of people who left),
// and keep the leave table itself (tenure step-ups are extra rows with "years of service").
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
    <div class="between"><div class="cotabs">${[["report", "Balances"], ["grant", "Give credits"], ["table", "Leave table"]].map(([k, t]) => `<button class="cotab${st.view === k ? " on" : ""}" data-view="${k}">${t}</button>`).join("")}</div>
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
    <div class="card"><h3>Add or change a row</h3><p class="s">For a tenure increase, enter the years of service it starts from (for example Staff, Vacation Leave, 5 years, 12 days). Changes apply the next time credits are given.</p>
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
    box.innerHTML = `<h3>Confidential leave (RA 9262)</h3>
      <p class="s">These requests skip the supervisor and manager and go to the HR person below. On each request, HR can hand the case to a supervisor or manager when needed.</p>
      ${staff.length ? `<form class="form" id="cform2"><label>Goes to<select name="r"><option value="">First HR staff member (default)</option>
        ${staff.map((x) => `<option value="${esc(x.id)}" ${g.confidential_receiver === x.id ? "selected" : ""}>${esc(x.full_name)}</option>`).join("")}</select></label>
        <p class="s">Now going to: <b>${esc((staff.find((x) => x.id === g.effective_receiver) || {}).full_name || "nobody")}</b></p>
        <div class="eerr"></div><button class="btn primary" type="submit">Save</button></form>`
        : `<div class="alert warn">No HR staff account in ${esc(cur.short_code)} yet. Until one is added, employees are told to contact HR directly.</div>`}`;
    const f = box.querySelector("#cform2");
    if (f) f.onsubmit = async (ev) => { ev.preventDefault(); f.querySelector(".eerr").innerHTML = "";
      try { await rpc("iaf_leave_settings_save", { p_company: cur.id, p_receiver: f.r.value || null }); toast("Saved ✔"); confCard(box, cur, { rpc, esc, toast, errBox }); }
      catch (e) { f.querySelector(".eerr").innerHTML = errBox(e); } };
  } catch (e) { box.innerHTML = `<h3>Confidential leave (RA 9262)</h3>` + errBox(e); }
}
