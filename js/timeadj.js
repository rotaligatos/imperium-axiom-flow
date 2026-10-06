// Half-day and Undertime: file (self or people under you), approve / reject, track. Phone and desktop. HR list is shown on the Schedules page.
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "");
const ymd = (d) => d.toISOString().slice(0, 10);
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000);
const STATUS = { pending: ["Waiting", "warn"], approved: ["Approved", "ok"], rejected: ["Rejected", ""], cancelled: ["Cancelled", ""] };
const chip = (s) => `<span class="chip ${STATUS[s][1]}">${STATUS[s][0]}</span>`;
const hm = (m) => `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}`;
const t12 = (t) => { if (!t) return ""; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const CHG = { vl: "Vacation leave", sl: "Sick leave", unpaid: "Unpaid" };

export function titleOf(r) {
  if (r.kind === "half_day") return r.part === "am_absent" ? "Half-day · absent in the morning (starts 1:00 PM)" : "Half-day · absent in the afternoon (goes home 12:00 PM)";
  return r.part === "pm" ? `Undertime · leaves ${t12(r.time)} (${hm(r.minutes)} short)` : `Undertime · arrives ${t12(r.time)} (${hm(r.minutes)} short)`;
}
export function adjCard(r, esc, actions = "") {
  return `<div class="card sreq" data-rid="${esc(r.id)}"><div class="between"><b>${esc(r.person)}</b>${chip(r.status)}</div>
    <div class="s">${esc(fmtD(r.date))}</div><div class="s">${esc(titleOf(r))}${r.kind === "half_day" ? (r.charge_applied === "unpaid" && r.charge !== "unpaid" ? " · not enough " + esc(CHG[r.charge]) + " balance, charged unpaid" : r.charge_applied ? ` · ${r.deducted} day deducted from ` + esc(CHG[r.charge_applied]) : r.charge ? " · 0.5 day will be deducted from " + esc(CHG[r.charge]) : "") : ""}${r.kind === "undertime" ? " · deducted from pay" : ""}${r.late ? " · filed late" : ""}</div>
    <div class="s">Reason: ${esc(r.reason)}</div>
    <div class="s">Filed by ${esc(r.filed_by)}${r.approver ? " · approver " + esc(r.approver) : ""}${r.decided_by ? ` · ${r.status} by ${esc(r.decided_by)}${r.override ? " (HR override)" : ""}` : ""}${r.note ? " — " + esc(r.note) : ""}</div>${actions}</div>`;
}
const decideBtns = `<div class="btns"><button class="btn primary" data-dec="yes">Approve</button><button class="btn" data-dec="no">Reject</button></div><div class="eerr"></div>`;

export function wireAdj(root, { rpc, toast, errBox }, after, needNote = false) {
  root.onclick = async (ev) => {
    const b = ev.target.closest("[data-dec],[data-cancel]"); if (!b) return;
    const card = b.closest("[data-rid]"), id = card.dataset.rid, err = card.querySelector(".eerr"); if (err) err.innerHTML = "";
    try {
      if (b.dataset.cancel !== undefined) { if (!confirm("Cancel this filing?")) return; await rpc("iaf_time_adj_cancel", { p_id: id }); toast("Cancelled ✔"); return after(); }
      const yes = b.dataset.dec === "yes"; let note = null;
      if (!yes || needNote) { note = prompt(yes ? "Reason for approving on behalf of the approver:" : "Reason for rejecting:"); if (note === null) return; if (!note.trim()) { toast("A reason is required.", true); return; } }
      b.disabled = true; await rpc("iaf_time_adj_decide", { p_id: id, p_approve: yes, p_note: note }); toast(yes ? "Approved ✔" : "Rejected ✔"); after();
    } catch (e) { if (err) err.innerHTML = errBox(e); else toast(e.message, true); b.disabled = false; }
  };
}

export async function renderTime(el, ctx) {
  const { rpc, esc, toast, errBox } = ctx;
  el.innerHTML = `<div class="empty loading">Loading…</div>`;
  let form, inbox, mine;
  try { [form, inbox, mine] = await Promise.all([rpc("iaf_shift_change_form"), rpc("iaf_time_adj_inbox"), rpc("iaf_time_adj_mine")]); } catch (e) { el.innerHTML = errBox(e); return; }
  if (!form.linked) { el.innerHTML = `<div class="alert bad">Your login is not linked to an employee record yet. Please contact HR.</div>`; return; }
  const reload = () => renderTime(el, ctx), today = ymd(manilaToday());
  el.innerHTML = `${inbox.length ? `<h2>Waiting for your decision</h2>${inbox.map((r) => adjCard(r, esc, decideBtns)).join("")}` : ""}
    <h2>Half-day / Undertime</h2>
    <form class="form card" id="tform">
      <div class="s">Half-day is for office schedules only (not shifts). Undertime is deducted from pay and allowed only after working more than half of the day. Afternoon undertime must be filed before you leave.</div>
      <label>Who<select name="emp">${form.people.map((p) => `<option value="${esc(p.id)}"${p.me ? " selected" : ""}>${esc(p.name)}${p.me ? " (me)" : ""}</option>`).join("")}</select></label>
      <label>What<select name="kind"><option value="half_day">Half-day</option><option value="undertime">Undertime</option></select></label>
      <label>Date<input name="date" type="date" value="${today}" required></label>
      <div class="s" id="tprev"></div>
      <label data-for="half_day">Which half<select name="hpart"><option value="am_absent">Absent in the morning (starts 1:00 PM)</option><option value="pm_absent">Absent in the afternoon (goes home 12:00 PM)</option></select></label>
      <label data-for="half_day">Deduct 0.5 day from<select name="charge"><option value="vl">Vacation leave</option><option value="sl">Sick leave</option><option value="unpaid">Unpaid</option></select></label>
      <label data-for="undertime">Type<select name="upart"><option value="pm">Leaving early (afternoon)</option><option value="am">Arriving late (morning, after a half-day)</option></select></label>
      <label data-for="undertime">Time<input name="time" type="time"></label>
      <label data-for="undertime" data-tick><span class="tick"><input type="checkbox" name="ticked"> I confirm the arrival information is correct</span></label>
      <label>Reason<textarea name="reason" rows="2" maxlength="500" required></textarea></label>
      <div class="eerr"></div><button class="btn primary block" type="submit">Submit</button></form>
    <h2>My filings</h2>${mine.map((r) => adjCard(r, esc, r.mine && r.status === "pending" ? `<div class="btns"><button class="btn" data-cancel>Cancel</button></div>` : "")).join("") || `<div class="empty">Nothing filed yet.</div>`}`;
  const f = el.querySelector("#tform");
  const sync = () => {
    const k = f.kind.value;
    f.querySelectorAll("[data-for]").forEach((l) => { l.hidden = l.dataset.for !== k || (l.hasAttribute("data-tick") && f.upart.value !== "am"); });
  };
  const preview = async () => {
    const box = el.querySelector("#tprev"); box.textContent = "";
    if (!f.date.value) return;
    try { const d = await rpc("iaf_time_adj_preview", { p_emp: f.emp.value, p_date: f.date.value });
      box.textContent = d.state === "unset" ? "No schedule is set for this person." : d.state === "rest" ? `Rest day (${d.schedule}).` : `${d.schedule}: ${t12(d.start)} – ${t12(d.end)}${d.kind === "shift" ? " (shift – half-day not allowed)" : ""}${d.vl_left != null || d.sl_left != null ? ` · Left: VL ${d.vl_left ?? "–"}, SL ${d.sl_left ?? "–"}` : ""}`;
    } catch (e) { box.textContent = ""; }
  };
  f.kind.onchange = f.upart.onchange = sync; f.date.onchange = f.emp.onchange = preview; sync(); preview();
  f.onsubmit = async (ev) => { ev.preventDefault(); const err = f.querySelector(".eerr"); err.innerHTML = ""; const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const half = f.kind.value === "half_day";
    try {
      await rpc("iaf_time_adj_file", { p_employee: f.emp.value, p_kind: f.kind.value, p_date: f.date.value, p_part: half ? f.hpart.value : f.upart.value,
        p_time: half ? null : f.time.value || null, p_charge: half ? f.charge.value : null, p_reason: f.reason.value, p_info_ticked: !half && f.upart.value === "am" && f.ticked.checked });
      toast("Submitted ✔"); reload();
    } catch (e) { err.innerHTML = errBox(e); btn.disabled = false; } };
  wireAdj(el, ctx, reload);
}

export async function renderTimeHr(box, ctx, companyId) {
  const { rpc, esc, errBox } = ctx;
  let list; try { list = await rpc("iaf_time_adj_list", { p_company: companyId }); } catch (e) { box.innerHTML = errBox(e); return; }
  const reload = () => renderTimeHr(box, ctx, companyId);
  box.innerHTML = `<h3>Half-day / undertime filings <small>${list.filter((r) => r.status === "pending").length} waiting</small></h3>${list.map((r) => adjCard(r, esc, r.status === "pending" ? `<div class="btns"><button class="btn" data-dec="yes">Approve for approver</button><button class="btn" data-dec="no">Reject</button></div><div class="eerr"></div>` : "")).join("") || "<small>None in the last 90 days.</small>"}`;
  wireAdj(box, ctx, reload, true);
}
