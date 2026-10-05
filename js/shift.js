// Change Shift: file (self or people under you), approve / reject, track. Works on phone and desktop. HR list is reused on the Schedules page.
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "");
const ymd = (d) => d.toISOString().slice(0, 10);
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000);
const STATUS = { pending: ["Waiting", "warn"], approved: ["Approved", "ok"], rejected: ["Rejected", ""], cancelled: ["Cancelled", ""] };
const chip = (s) => `<span class="chip ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

export function reqCard(r, esc, actions = "") {
  return `<div class="card sreq" data-rid="${esc(r.id)}"><div class="between"><b>${esc(r.schedule)}</b>${chip(r.status)}</div>
    <div class="s">${esc(r.people.join(", "))}</div>
    <div class="s">From ${esc(fmtD(r.start_date))}${r.end_date ? " to " + esc(fmtD(r.end_date)) : " until further notice"}${r.late ? " · filed late" : ""}</div>
    <div class="s">Reason: ${esc(r.reason)}</div>
    <div class="s">Filed by ${esc(r.filed_by)}${r.approver ? " · approver " + esc(r.approver) : ""}${r.decided_by ? ` · ${r.status} by ${esc(r.decided_by)}${r.override ? " (HR override)" : ""}` : ""}${r.note ? " — " + esc(r.note) : ""}</div>${actions}</div>`;
}
const decideBtns = (hr) => `<div class="btns"><button class="btn primary" data-dec="yes">Approve</button><button class="btn" data-dec="no">Reject</button></div><div class="eerr"></div>`;

// shared click handler for approve / reject / cancel inside `root`
export function wireDecisions(root, { rpc, toast, esc, errBox }, after, needNote = false) {
  root.onclick = async (ev) => {
    const b = ev.target.closest("[data-dec],[data-cancel]"); if (!b) return;
    const card = b.closest("[data-rid]"), id = card.dataset.rid, err = card.querySelector(".eerr"); if (err) err.innerHTML = "";
    try {
      if (b.dataset.cancel !== undefined) { if (!confirm("Cancel this request?")) return; await rpc("iaf_shift_change_cancel", { p_id: id }); toast("Cancelled ✔"); return after(); }
      const yes = b.dataset.dec === "yes"; let note = null;
      if (!yes || needNote) { note = prompt(yes ? "Reason for approving on behalf of the approver:" : "Reason for rejecting:"); if (note === null) return; if (!note.trim()) { toast("A reason is required.", true); return; } }
      b.disabled = true; await rpc("iaf_shift_change_decide", { p_id: id, p_approve: yes, p_note: note }); toast(yes ? "Approved ✔ schedule updated" : "Rejected ✔"); after();
    } catch (e) { if (err) err.innerHTML = errBox(e); else toast(e.message, true); b.disabled = false; }
  };
}

export async function renderShift(el, ctx) {
  const { rpc, esc, toast, errBox } = ctx;
  el.innerHTML = `<div class="empty loading">Loading…</div>`;
  let form, inbox, mine;
  try { [form, inbox, mine] = await Promise.all([rpc("iaf_shift_change_form"), rpc("iaf_shift_change_inbox"), rpc("iaf_shift_change_mine")]); } catch (e) { el.innerHTML = errBox(e); return; }
  const reload = () => renderShift(el, ctx), min = ymd(new Date(manilaToday().getTime() + 2 * 86400000));
  if (!form.linked) { el.innerHTML = `<div class="alert bad">Your login is not linked to an employee record yet. Please contact HR.</div>`; return; }
  el.innerHTML = `${inbox.length ? `<h2>Waiting for your decision</h2>${inbox.map((r) => reqCard(r, esc, decideBtns())).join("")}` : ""}
    <h2>Request a shift change</h2>
    <form class="form card" id="sform">
      <div class="s">Must be filed at least 2 days before it starts. Your approver and HR will see it.</div>
      <label>Who<div class="people">${form.people.map((p) => `<label class="tick"><input type="checkbox" name="emp" value="${esc(p.id)}"${form.people.length === 1 || p.me ? " checked" : ""}> ${esc(p.name)}${p.me ? " (me)" : ""}</label>`).join("")}</div></label>
      <label>New schedule<select name="sch">${form.schedules.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select></label>
      <label>Starting<input name="start" type="date" min="${min}" value="${min}" required></label>
      <label>Until (blank = until further notice)<input name="end" type="date"></label>
      <label>Reason<textarea name="reason" rows="2" maxlength="500" required></textarea></label>
      <div class="eerr"></div><button class="btn primary block" type="submit">Submit request</button></form>
    <h2>My requests</h2>${mine.map((r) => reqCard(r, esc, r.mine && r.status === "pending" ? `<div class="btns"><button class="btn" data-cancel>Cancel request</button></div>` : "")).join("") || `<div class="empty">Nothing filed yet.</div>`}`;
  const f = el.querySelector("#sform");
  f.onsubmit = async (ev) => { ev.preventDefault(); const err = f.querySelector(".eerr"); err.innerHTML = ""; const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const emps = [...f.querySelectorAll("[name=emp]:checked")].map((c) => c.value);
    try { await rpc("iaf_shift_change_file", { p_employees: emps, p_schedule: f.sch.value, p_start: f.start.value, p_end: f.end.value || null, p_reason: f.reason.value }); toast("Submitted ✔"); reload(); }
    catch (e) { err.innerHTML = errBox(e); btn.disabled = false; } };
  wireDecisions(el, ctx, reload);
}

// HR list (Schedules page): everything, with override
export async function renderShiftHr(box, ctx, companyId) {
  const { rpc, esc, errBox } = ctx;
  let list; try { list = await rpc("iaf_shift_change_list", { p_company: companyId }); } catch (e) { box.innerHTML = errBox(e); return; }
  const reload = () => renderShiftHr(box, ctx, companyId);
  box.innerHTML = `<h3>Shift change requests <small>${list.filter((r) => r.status === "pending").length} waiting</small></h3>${list.map((r) => reqCard(r, esc, r.status === "pending" ? `<div class="btns"><button class="btn" data-dec="yes">Approve for approver</button><button class="btn" data-dec="no">Reject</button></div><div class="eerr"></div>` : "")).join("") || "<small>None in the last 90 days.</small>"}`;
  wireDecisions(box, ctx, reload, true);
}
