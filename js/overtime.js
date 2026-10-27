// Overtime: file (self or people under you on the org chart), approve (superior → department head → Managing Director),
// enter actual hours, superior confirms, HR checks the biometric log, then it is filed for payroll.
// All rules live in the database (iaf_ot_* functions); this page only shows them and asks for the device signature.
import { sign } from "./sign.js";

const DAY = { ordinary: "Ordinary day", rest_day: "Rest day", special_holiday: "Special holiday", special_holiday_rest: "Special holiday on rest day",
  regular_holiday: "Regular holiday", regular_holiday_rest: "Regular holiday on rest day" };
const STAGE = { superior: "Superior", head: "Department head", md: "Managing Director" };
const STATUS = { pending: ["Waiting for approval", "wait"], approved: ["Approved · enter actual hours", "ok"], confirming: ["Superior to confirm hours", "wait"],
  head_check: ["Over 12 h · head to approve", "wait"], hr_check: ["HR biometric check", "wait"], filed: ["Filed for payroll", "ok"],
  rejected: ["Rejected", "bad"], cancelled: ["Cancelled", "mute"] };
const STEP = { queued: "next", waiting: "waiting", approved: "approved", rejected: "rejected", skipped: "skipped", closed: "closed" };
const who = (s) => String(s.name || "").replace(/^Managing Director /, "");
const MODE = { delegate: " (as delegate)", hr_softcopy: " (HR, from the signed soft copy)" };

const t12 = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const hm = (m) => { m = Number(m) || 0; const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`; };
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "");
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const chip = (s) => { const [t, k] = STATUS[s] || [s, "mute"]; return `<span class="chip ${k}">${t}</span>`; };
const dayChip = (d) => `<span class="chip ${d === "ordinary" ? "mute" : "warn"}">${DAY[d] || d}</span>`;

export function otCard(r, esc, actions = "") {
  const live = r.lines.filter((l) => l.status === "active"), gone = r.lines.filter((l) => l.status !== "active");
  const showAct = live.some((l) => l.actual_minutes != null || l.not_worked);
  const lineRow = (l) => `<tr><td>${esc(l.name)}</td><td>${dayChip(l.day_type)}${l.holiday ? `<br><small>${esc(l.holiday)}</small>` : ""}</td>
    ${showAct ? `<td>${l.not_worked ? "Did not work" : l.actual_minutes != null ? `${esc(t12(l.actual_start))} – ${esc(t12(l.actual_end))}<br><small>${hm(l.actual_minutes)}</small>` : "–"}</td>
    <td>${l.payable_minutes != null ? `<b>${hm(l.payable_minutes)}</b>` : l.credited_minutes != null ? hm(l.credited_minutes) : "–"}</td>` : ""}</tr>`;
  const route = r.route.map((s) => `<li class="${s.status === "waiting" ? "on" : ""}"><b>${esc(STAGE[s.stage] || s.stage)}</b> · ${esc(who(s))} — ${STEP[s.status] || s.status}${s.acted_by_name && s.status !== "skipped" ? ` by ${esc(s.acted_by_name)}${MODE[s.acted_mode] || ""}` : ""}${s.note ? `<br><small>${esc(s.note)}</small>` : ""}</li>`).join("");
  return `<div class="card otc" data-oid="${esc(r.id)}"><div class="between"><b>${esc(fmtD(r.work_date))}</b>${chip(r.status)}</div>
    <div class="s">${esc(t12(r.start))} – ${esc(t12(r.end))} · ${hm(r.planned_minutes)} planned${r.is_long ? " · over 12 h" : ""}${r.after_fact ? " · <span class=\"warnt\">emergency, filed after the work</span>" : ""}${r.actuals_overdue ? " · <span class=\"warnt\">actual hours overdue</span>" : ""}</div>
    <div class="s">Reason: ${esc(r.reason)}${r.emergency_reason ? `<br>Emergency: ${esc(r.emergency_reason)}` : ""}</div>
    <div class="s">Filed by ${esc(r.filed_by_name)}${r.closed_note ? ` · <i>“${esc(r.closed_note)}”</i>` : ""}</div>
    <div class="tscroll"><table class="dtab"><tr><th>Person</th><th>Day</th>${showAct ? "<th>Actual</th><th>Counts</th>" : ""}</tr>${live.map(lineRow).join("")}</table></div>
    ${gone.length ? `<div class="s">Removed: ${gone.map((l) => `${esc(l.name)}${l.removed_note ? ` (${esc(l.removed_note)})` : ""}`).join(", ")}</div>` : ""}
    <details><summary class="s">Approval route</summary><ol class="otroute">${route}<li>Actual hours → superior confirms → HR checks the biometric log → payroll</li></ol></details>
    ${actions}</div>`;
}

const note = (ph, req = false) => `<label><span>${req ? "Note" : "Note <span class=\"opt\">(optional)</span>"}</span><textarea name="note" rows="2" maxlength="500" placeholder="${ph}"></textarea></label>`;
function actionsFor(r, mode, esc) {
  const live = r.lines.filter((l) => l.status === "active");
  const err = `<div class="eerr"></div>`;
  if (mode === "approve") return `<div class="otact">${live.length > 1 ? `<p class="s">Untick anyone who should not be on this overtime (needs a note):</p>${live.map((l) => `<label class="check"><input type="checkbox" name="keep" value="${esc(l.id)}" checked><span>${esc(l.name)}</span></label>`).join("")}` : ""}
    ${note("Reason if rejecting or removing someone")}${err}<div class="btns"><button class="btn primary" data-ot="act" data-yes="1">Approve &amp; sign</button><button class="btn danger" data-ot="act">Reject &amp; sign</button></div></div>`;
  if (mode === "md") return `<div class="otact"><div class="alert">The Managing Director has no login. Record the MD's decision from the signed soft copy.</div>
    ${note("Soft copy reference, e.g. signed copy received Oct 27 from the MD's office", true)}${err}<div class="btns"><button class="btn primary" data-ot="act" data-yes="1">Record MD approval &amp; sign</button><button class="btn danger" data-ot="act">Record MD rejection &amp; sign</button></div></div>`;
  if (mode === "long") return `<div class="otact"><div class="alert warn">The actual hours went over 12 hours. Your approval is needed before HR's biometric check.</div>
    ${note("Reason if sending back, e.g. cap at 12 hours")}${err}<div class="btns"><button class="btn primary" data-ot="long" data-yes="1">Approve hours &amp; sign</button><button class="btn" data-ot="long">Send back &amp; sign</button></div></div>`;
  if (mode === "confirm") return `<div class="otact"><p class="s">Check the actual hours above. Extra time beyond the approved ${hm(r.planned_minutes)} counts only if it is 30 minutes or more.</p>
    ${note("What needs correcting, if returning")}${err}<div class="btns"><button class="btn primary" data-ot="confirm" data-yes="1">Confirm hours &amp; sign</button><button class="btn" data-ot="confirm">Return to filer &amp; sign</button></div></div>`;
  if (mode === "verify") return `<div class="otact"><p class="s">Compare with the biometric log. Lower the minutes if the log shows less (under 30 minutes counts as 0).</p>
    <div class="tscroll"><table class="dtab"><tr><th>Person</th><th>Confirmed</th><th>Minutes per biometric</th></tr>${live.map((l) => `<tr><td>${esc(l.name)}</td><td>${hm(l.credited_minutes)}</td><td><input type="number" name="vmin" data-line="${esc(l.id)}" min="0" max="${Number(l.credited_minutes) || 0}" step="1" value="${Number(l.credited_minutes) || 0}"></td></tr>`).join("")}</table></div>
    ${note("Required if you lowered minutes or return it: what the biometric log shows")}${err}<div class="btns"><button class="btn primary" data-ot="verify" data-yes="1">Matches · file for payroll &amp; sign</button><button class="btn" data-ot="verify">Return &amp; sign</button></div></div>`;
  if (mode === "actuals") return `<div class="otact"><p class="s">Enter the real time in and out from the work (planned ${esc(t12(r.start))} – ${esc(t12(r.end))}).</p>
    <div class="tscroll"><table class="dtab"><tr><th>Person</th><th>Start</th><th>End</th><th>Did not work</th></tr>${live.map((l) => `<tr data-line="${esc(l.id)}"><td>${esc(l.name)}</td><td><input type="time" name="as" value="${esc(l.actual_start || r.start)}"></td><td><input type="time" name="ae" value="${esc(l.actual_end || r.end)}"></td><td><input type="checkbox" name="nw"${l.not_worked ? " checked" : ""}></td></tr>`).join("")}</table></div>
    ${err}<div class="btns"><button class="btn primary" data-ot="actuals">Submit actual hours &amp; sign</button>${r.status === "approved" ? `<button class="btn" data-ot="cancel">Cancel overtime</button>` : ""}</div></div>`;
  if (mode === "cancel") return `<div class="btns">${err}<button class="btn" data-ot="cancel">Cancel overtime</button></div>`;
  return "";
}

export async function renderOt(el, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  const tab = state.otTab === "hr" && state.canPeople ? "hr" : "mine";
  el.innerHTML = `${state.canPeople ? `<div class="cotabs"><button class="cotab${tab === "mine" ? " on" : ""}" data-tab="mine">My overtime</button><button class="cotab${tab === "hr" ? " on" : ""}" data-tab="hr">HR records</button></div>` : ""}<div id="otbody"><div class="empty loading">Loading…</div></div>`;
  el.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { state.otTab = b.dataset.tab; renderOt(el, ctx); }));
  const body = el.querySelector("#otbody");
  if (tab === "hr") return renderOtHr(body, ctx);

  let form, inbox, mine;
  try { [form, inbox, mine] = await Promise.all([rpc("iaf_shift_change_form"), rpc("iaf_ot_inbox"), rpc("iaf_ot_mine")]); } catch (e) { body.innerHTML = errBox(e); return; }
  if (!form.linked) { body.innerHTML = `<div class="alert bad">Your login is not linked to an employee record yet. Please contact HR.</div>`; return; }
  const reload = () => renderOt(el, ctx);
  const byId = {};
  const sec = (title, list, mode) => { if (!list.length) return "";
    list.forEach((r) => (byId[r.id] = r));
    return `<h2>${title} <small>${list.length}</small></h2>${list.map((r) => otCard(r, esc, actionsFor(r, typeof mode === "function" ? mode(r) : mode, esc))).join("")}`; };
  const waiting = sec("Waiting for your approval", inbox.to_approve, (r) => (r.status === "head_check" ? "long" : "approve"))
    + sec("Managing Director soft copy to record", inbox.md_softcopy, "md")
    + sec("Actual hours to confirm", inbox.to_confirm, "confirm")
    + sec("HR biometric check", inbox.to_verify, "verify")
    + sec("Enter actual hours", inbox.needs_actuals, "actuals");
  const overdue = inbox.overdue_actuals.length ? `<h2>Actual hours overdue <small>${inbox.overdue_actuals.length}</small></h2><p class="s">The filer has not entered the actual hours yet (more than 3 days after the work).</p>${inbox.overdue_actuals.map((r) => otCard(r, esc)).join("")}` : "";
  const shown = new Set(Object.keys(byId));
  const myList = mine.filter((r) => !shown.has(r.id)).map((r) => { byId[r.id] = r;
    return otCard(r, esc, r.filed_by === state.me?.id && ["pending", "approved"].includes(r.status) ? actionsFor(r, "cancel", esc) : ""); }).join("");
  const people = form.people || [];
  body.innerHTML = `${waiting}${overdue}
    <h2>File overtime</h2>
    <form class="form card" id="otform">
      <p class="s">Overtime is at least 30 minutes. Rest days and holidays also need the department head and the Managing Director. Not allowed on a leave day (cancel the leave first).</p>
      ${people.length > 1 ? `<fieldset class="fs"><legend>Who</legend><div class="otpeople">${people.map((p) => `<label class="check"><input type="checkbox" name="emp" value="${esc(p.id)}"${p.me ? " checked" : ""}><span>${esc(p.name)}${p.me ? " (me)" : ""}${p.dept ? ` <small>${esc(p.dept)}</small>` : ""}</span></label>`).join("")}</div></fieldset>`
        : `<input type="hidden" name="emp" value="${esc(people[0]?.id || "")}">`}
      <label>Date<input type="date" name="date" value="${manilaToday()}" required></label>
      <div class="two"><label>Start<input type="time" name="start" required></label><label>End<input type="time" name="end" required></label></div>
      <div id="otprev" class="s"></div>
      <div id="otem" hidden><div class="alert warn">This overtime has already started. It can only be filed as an <b>emergency</b>, after the work is finished, with the actual times. The department head must approve it.</div>
        <label>What was the emergency?<textarea name="emr" rows="2" maxlength="1000"></textarea></label></div>
      <label>Reason for the overtime<textarea name="reason" rows="2" maxlength="1000" required placeholder="e.g. finish the cutting for the J Tower delivery"></textarea></label>
      <div class="eerr"></div><button class="btn primary block" type="submit">Sign &amp; submit</button>
      <p class="s" style="text-align:center">Your fingerprint, face or device PIN is your signature.</p></form>
    <h2>My overtime</h2>${myList || `<div class="empty">No overtime filed in the last 6 months.</div>`}`;

  const f = body.querySelector("#otform");
  const emps = () => [...f.querySelectorAll("[name=emp]")].filter((x) => x.type === "hidden" || x.checked).map((x) => x.value).filter(Boolean);
  let pseq = 0, prev = null;
  const preview = async () => {
    const box = body.querySelector("#otprev"), my = ++pseq; prev = null;
    if (!f.date.value || !f.start.value || !f.end.value || !emps().length) { box.innerHTML = ""; body.querySelector("#otem").hidden = true; return; }
    try {
      const d = await rpc("iaf_ot_preview", { p_employees: emps(), p_date: f.date.value, p_start: f.start.value, p_end: f.end.value }); if (my !== pseq) return; prev = d;
      body.querySelector("#otem").hidden = !d.after_fact;
      const special = (d.people || []).filter((p) => p.day_type !== "ordinary");
      box.innerHTML = `<div class="card otprev"><b>${hm(d.minutes)}</b>${d.is_long ? " · over 12 hours" : ""}${special.length ? `<br>${special.map((p) => `${esc(p.name)}: ${esc(DAY[p.day_type])}${p.holiday ? ` (${esc(p.holiday)})` : ""}`).join("<br>")}` : ""}
        <br><small>Approval: ${(d.route || []).map((s) => `${esc(STAGE[s.stage] || s.stage)} ${esc(who(s))}${s.skipped ? " (skipped)" : ""}`).join(" → ") || "—"} → then actual hours, superior confirms, HR biometric check</small></div>`;
    } catch (e) { if (my === pseq) box.innerHTML = errBox(e); }
  };
  f.addEventListener("change", (ev) => { if (["emp", "date", "start", "end"].includes(ev.target.name)) preview(); });
  f.onsubmit = async (ev) => {
    ev.preventDefault(); const err = f.querySelector(".eerr"), btn = f.querySelector("button[type=submit]"); err.innerHTML = "";
    if (!emps().length) { err.innerHTML = errBox(new Error("Tick at least one person.")); return; }
    btn.disabled = true; btn.textContent = "Signing…";
    try {
      const sid = await sign("SUBMIT", state.me?.full_name);
      await rpc("iaf_ot_file", { p: { employees: emps(), work_date: f.date.value, start: f.start.value, end: f.end.value, reason: f.reason.value,
        emergency: !!prev?.after_fact, emergency_reason: f.emr.value || null, signature_id: sid } });
      toast("Overtime submitted ✔"); reload();
    } catch (e) { err.innerHTML = errBox(e); btn.disabled = false; btn.textContent = "Sign & submit"; }
  };

  body.onclick = async (ev) => {
    const b = ev.target.closest("[data-ot]"); if (!b) return;
    const card = b.closest("[data-oid]"), id = card.dataset.oid, r = byId[id], err = card.querySelector(".eerr"), yes = !!b.dataset.yes;
    const nt = (card.querySelector("textarea[name=note]")?.value || "").trim() || null;
    if (err) err.innerHTML = "";
    const go = async (purpose, fn, done) => {
      b.disabled = true; const label = b.textContent; b.textContent = "Signing…";
      try { const sid = purpose ? await sign(purpose, state.me?.full_name) : null; await fn(sid); toast(done); reload(); }
      catch (e) { if (err) err.innerHTML = errBox(e); else toast(e.message, true); b.disabled = false; b.textContent = label; }
    };
    try {
      if (b.dataset.ot === "cancel") { const why = prompt("Cancel this overtime? Reason (optional):"); if (why === null) return;
        return go(null, () => rpc("iaf_ot_cancel", { p_id: id, p_note: why || null }), "Cancelled ✔"); }
      if (b.dataset.ot === "act") {
        const keep = [...card.querySelectorAll("[name=keep]")], remove = keep.filter((x) => !x.checked).map((x) => x.value);
        return go(yes ? "APPROVE" : "REJECT", (sid) => rpc("iaf_ot_act", { p_id: id, p_action: yes ? "approve" : "reject", p_note: nt, p_remove: yes && remove.length ? remove : null, p_signature: sid }), yes ? "Approved ✔" : "Rejected ✔");
      }
      if (b.dataset.ot === "long") return go(yes ? "APPROVE" : "REJECT", (sid) => rpc("iaf_ot_long_decide", { p_id: id, p_approve: yes, p_note: nt, p_signature: sid }), yes ? "Approved ✔" : "Sent back ✔");
      if (b.dataset.ot === "confirm") return go(yes ? "APPROVE" : "REJECT", (sid) => rpc("iaf_ot_actuals_confirm", { p_id: id, p_approve: yes, p_note: nt, p_signature: sid }), yes ? "Hours confirmed ✔" : "Returned ✔");
      if (b.dataset.ot === "verify") {
        const lines = [...card.querySelectorAll("[name=vmin]")].map((x) => ({ line_id: x.dataset.line, minutes: Number(x.value || 0) }));
        return go(yes ? "APPROVE" : "REJECT", (sid) => rpc("iaf_ot_hr_verify", { p_id: id, p_approve: yes, p_lines: lines, p_note: nt, p_signature: sid }), yes ? "Filed for payroll ✔" : "Returned ✔");
      }
      if (b.dataset.ot === "actuals") {
        const lines = [...card.querySelectorAll("tr[data-line]")].map((tr) => ({ line_id: tr.dataset.line, start: tr.querySelector("[name=as]").value || null,
          end: tr.querySelector("[name=ae]").value || null, not_worked: tr.querySelector("[name=nw]").checked }));
        return go("SUBMIT", (sid) => rpc("iaf_ot_actuals_submit", { p_id: id, p_lines: lines, p_signature: sid }), "Actual hours sent ✔");
      }
    } catch (e) { if (err) err.innerHTML = errBox(e); }
    void r;
  };
}

// ---- HR: overtime records per company and month, payroll export (CSV for Excel), settings ----
async function renderOtHr(body, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  let cos; try { cos = await rpc("iaf_my_companies"); } catch (e) { body.innerHTML = errBox(e); return; }
  if (!cos.length) { body.innerHTML = `<div class="empty">No company access.</div>`; return; }
  const st = state.otHr ||= { co: (cos.find((c) => c.is_home) || cos[0]).id, month: manilaToday().slice(0, 7), status: "" };
  const range = () => { const [y, m] = st.month.split("-").map(Number); return [`${st.month}-01`, `${st.month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`]; };
  const draw = async () => {
    const [from, to] = range();
    body.innerHTML = `<div class="cotabs">${cos.map((c) => `<button class="cotab${c.id === st.co ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>
      <div class="card"><div class="between"><label>Month<input type="month" id="otm" value="${esc(st.month)}"></label>
        <label>Status<select id="ots"><option value="">All</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${st.status === k ? " selected" : ""}>${v[0]}</option>`).join("")}</select></label>
        <button class="btn" id="otcsv">⬇ Payroll (filed) · Excel CSV</button></div></div>
      <div id="otlist"><div class="empty loading">Loading…</div></div>
      <details class="card" id="otset"><summary><b>Overtime settings</b></summary><div class="empty loading">Loading…</div></details>`;
    const cur = cos.find((c) => c.id === st.co);
    body.querySelectorAll("[data-co]").forEach((b) => (b.onclick = () => { st.co = b.dataset.co; draw(); }));
    body.querySelector("#otm").onchange = (e) => { if (e.target.value) { st.month = e.target.value; draw(); } };
    body.querySelector("#ots").onchange = (e) => { st.status = e.target.value; draw(); };
    body.querySelector("#otcsv").onclick = async (e) => { const b = e.currentTarget; b.disabled = true;
      try { const rows = await rpc("iaf_ot_payroll", { p_company: st.co, p_from: from, p_to: to });
        if (!rows.length) { toast("No filed overtime in this month.", true); return; }
        const cols = [["employee_no", "Employee no."], ["name", "Name"], ["department", "Department"], ["work_date", "Date"], ["day_type", "Day type"], ["holiday", "Holiday"],
          ["planned", "Approved time"], ["actual_start", "Actual in"], ["actual_end", "Actual out"], ["actual_minutes", "Actual minutes"], ["credited_minutes", "Confirmed minutes"],
          ["payable_minutes", "Payable minutes"], ["payable_hours", "Payable hours"], ["after_fact", "Emergency (after the fact)"], ["hr_checked_by", "Checked by"]];
        const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const csv = "﻿" + [cols.map((c) => c[1]).join(","), ...rows.map((r) => cols.map(([k]) => cell(k === "day_type" ? DAY[r[k]] || r[k] : k === "after_fact" ? (r[k] ? "Yes" : "") : r[k])).join(","))].join("\r\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), a = document.createElement("a");
        a.href = url; a.download = `Overtime_${cur.short_code}_${st.month}.csv`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch (x) { toast(x.message, true); } finally { b.disabled = false; } };
    try {
      const list = await rpc("iaf_ot_list", { p_company: st.co, p_from: from, p_to: to, p_status: st.status || null });
      const tot = list.filter((r) => r.status === "filed").flatMap((r) => r.lines.filter((l) => l.status === "active")).reduce((a, l) => a + (Number(l.payable_minutes) || 0), 0);
      body.querySelector("#otlist").innerHTML = (list.length ? `<p class="s">${list.length} request${list.length > 1 ? "s" : ""} · filed for payroll: <b>${hm(tot)}</b></p>` + list.map((r) => otCard(r, esc)).join("") : `<div class="empty">No overtime in this month.</div>`);
    } catch (e) { body.querySelector("#otlist").innerHTML = errBox(e); }
    try {
      const s = await rpc("iaf_ot_settings_get", { p_company: st.co }), box = body.querySelector("#otset");
      box.innerHTML = `<summary><b>Overtime settings · ${esc(cur.short_code)}</b></summary><form class="form" id="otsf">
        <div class="two"><label>Minimum overtime (minutes)<input type="number" name="min" min="1" max="240" value="${esc(s.min)}"><small>Also the least extra time beyond the approved hours that counts.</small></label>
        <label>Head approval above (hours)<input type="number" name="long" min="1" max="24" step="0.5" value="${esc(s.long / 60)}"></label></div>
        <div class="two"><label>Longest overtime per request (hours)<input type="number" name="max" min="1" max="24" step="0.5" value="${esc(s.max / 60)}"></label>
        <label>Emergency filing allowed within (days)<input type="number" name="ad" min="0" max="60" value="${esc(s.after_days)}"></label></div>
        <label>Actual hours overdue after (days)<input type="number" name="dd" min="1" max="30" value="${esc(s.due_days)}"></label>
        <div class="eerr"></div><button class="btn" type="submit">Save settings</button></form>`;
      const f = box.querySelector("#otsf");
      f.onsubmit = async (ev) => { ev.preventDefault(); const err = f.querySelector(".eerr"); err.innerHTML = "";
        try { await rpc("iaf_ot_settings_save", { p_company: st.co, p_min: Number(f.min.value), p_max: Math.round(Number(f.max.value) * 60), p_after_days: Number(f.ad.value),
            p_long: Math.round(Number(f.long.value) * 60), p_due_days: Number(f.dd.value) }); toast("Settings saved ✔"); }
        catch (x) { err.innerHTML = errBox(x); } };
    } catch (e) { body.querySelector("#otset").innerHTML = `<summary><b>Overtime settings</b></summary>${errBox(e)}`; }
  };
  draw();
}
