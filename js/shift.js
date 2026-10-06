// Change Shift: file (self, people under you, or a whole department), then Manager -> Head of Plant Operation -> HR and the supervisor are told.
// Works on phone and desktop. The HR list and the "final approver" setting are shown on the Schedules page.
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "");
const ymd = (d) => d.toISOString().slice(0, 10);
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000);
const STATUS = { pending: ["With the Manager", "warn"], with_head: ["With the Head", "warn"], returned: ["Returned to requester", "warn"], approved: ["Approved", "ok"], rejected: ["Rejected", ""], cancelled: ["Cancelled", ""] };
const chip = (s) => `<span class="chip ${(STATUS[s] || ["", ""])[1]}">${(STATUS[s] || [s])[0]}</span>`;
const LOG = { filed: "Filed", manager_approved: "Manager approved", final_approved: "Head approved", approved_by_hr_override: "Approved by HR for the approver", rejected: "Rejected", rejected_by_hr_override: "Rejected by HR for the approver",
  returned_to_manager: "Head sent back to the Manager", returned_to_requester: "Returned to the requester", people_changed: "Manager changed who is included", resubmitted: "Re-submitted", cancelled: "Cancelled" };

export function reqCard(r, esc, actions = "") {
  const log = (r.log || []).length ? `<details class="s"><summary>History</summary>${r.log.map((l) => `<div>${esc(new Date(l.at).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))} · ${esc(LOG[l.action] || l.action)} — ${esc(l.by || "")}${l.note ? ": " + esc(l.note) : ""}</div>`).join("")}</details>` : "";
  const who = r.dept ? `Whole department: ${esc(r.dept)} · ${r.people.length} people` : esc(r.people.join(", "));
  return `<div class="card sreq" data-rid="${esc(r.id)}"><div class="between"><b>${esc(r.schedule)}</b>${chip(r.status)}</div>
    <div class="s">${who}</div>${r.dept ? `<details class="s"><summary>Who is included</summary>${esc(r.people.join(", "))}</details>` : ""}
    <div class="s">From ${esc(fmtD(r.start_date))}${r.end_date ? " to " + esc(fmtD(r.end_date)) : " until further notice"}${r.late ? " · filed late" : ""}</div>
    <div class="s">Reason: ${esc(r.reason)}</div>
    <div class="s">Filed by ${esc(r.filed_by)}${r.status === "pending" || r.status === "with_head" ? " · waiting for " + esc(r.approver || "") : ""}${r.decided_by ? ` · ${r.status} by ${esc(r.decided_by)}${r.override ? " (HR override)" : ""}` : ""}</div>
    ${r.note && (r.status === "returned" || r.status === "pending" || r.status === "rejected") ? `<div class="alert warn">${esc(r.note)}</div>` : ""}${log}${actions}</div>`;
}

const decideBtns = (r) => `<div class="btns"><button class="btn primary" data-act="approve">${r.stage === "head" ? "Approve (final)" : "Approve → Head"}</button><button class="btn" data-act="return">${r.stage === "head" ? "Send back to Manager" : "Return to requester"}</button><button class="btn" data-act="reject">Reject</button></div><div class="eerr"></div>`;
const hrBtns = `<div class="btns"><button class="btn" data-act="approve">Approve for approver</button><button class="btn" data-act="return">Return</button><button class="btn" data-act="reject">Reject</button></div><div class="eerr"></div>`;

// who is included: the Manager can take people out (or add someone under them), with a reason
const editor = (r, form, esc) => {
  const have = new Set(r.members.map((m) => m.id)), add = form && form.company_id === r.company_id ? form.people.filter((p) => !have.has(p.id)) : [];
  return `<details class="s"><summary>Change who is included</summary><div class="people">${r.members.map((m) => `<label class="tick"><input type="checkbox" data-inc value="${esc(m.id)}" checked> ${esc(m.name)}</label>`).join("")}${add.length ? `<div class="s">Add:</div>` + add.map((p) => `<label class="tick"><input type="checkbox" data-inc value="${esc(p.id)}"> ${esc(p.name)}</label>`).join("") : ""}</div></details>`;
};

// shared click handler for approve / return / reject / cancel inside `root`
export function wireDecisions(root, { rpc, toast, esc, errBox }, after, needNote = false, startEdit = null) {
  root.onclick = async (ev) => {
    const b = ev.target.closest("[data-act],[data-cancel],[data-edit]"); if (!b) return;
    const card = b.closest("[data-rid]"), id = card.dataset.rid, err = card.querySelector(".eerr"); if (err) err.innerHTML = "";
    try {
      if (b.dataset.edit !== undefined) { if (startEdit) startEdit(id); return; }
      if (b.dataset.cancel !== undefined) { if (!confirm("Cancel this request?")) return; await rpc("iaf_shift_change_cancel", { p_id: id }); toast("Cancelled ✔"); return after(); }
      const act = b.dataset.act; let note = null, people = null;
      const boxes = [...card.querySelectorAll("[data-inc]")];
      if (act === "approve" && boxes.length) { people = boxes.filter((c) => c.checked).map((c) => c.value); const orig = boxes.filter((c) => c.defaultChecked).map((c) => c.value); if (people.length === orig.length && people.every((p) => orig.includes(p))) people = null; }
      if (act !== "approve" || needNote || people) {
        note = prompt(act === "approve" ? (people ? "Reason for changing who is included:" : "Reason for approving on behalf of the approver:") : act === "return" ? "Reason for sending it back:" : "Reason for rejecting:");
        if (note === null) return; if (!note.trim()) { toast("A reason is required.", true); return; }
      }
      b.disabled = true; const out = await rpc("iaf_shift_change_act", { p_id: id, p_action: act, p_note: note, p_people: people });
      toast(out === "with_head" ? "Approved ✔ sent to the Head" : out === "approved" ? "Approved ✔ schedule updated" : out === "rejected" ? "Rejected ✔" : "Sent back ✔"); after();
    } catch (e) { if (err) err.innerHTML = errBox(e); else toast(e.message, true); b.disabled = false; }
  };
}

export async function renderShift(el, ctx, company = null) {
  const { rpc, esc, toast, errBox } = ctx;
  el.innerHTML = `<div class="empty loading">Loading…</div>`;
  let form, inbox, mine;
  try { [form, inbox, mine] = await Promise.all([rpc("iaf_shift_change_form", company ? { p_company: company } : {}), rpc("iaf_shift_change_inbox"), rpc("iaf_shift_change_mine")]); } catch (e) { el.innerHTML = errBox(e); return; }
  const reload = () => renderShift(el, ctx, form.company_id), min = ymd(new Date(manilaToday().getTime() + 2 * 86400000));
  if (!form.linked) { el.innerHTML = `<div class="alert bad">Your login is not linked to an employee record yet. Please contact HR.</div>`; return; }
  el.innerHTML = `${inbox.length ? `<h2>Waiting for your decision</h2>${inbox.map((r) => reqCard(r, esc, (r.stage === "manager" ? editor(r, form, esc) : "") + decideBtns(r))).join("")}` : ""}
    <h2 id="ftitle">Request a shift change</h2>
    <form class="form card" id="sform">
      <div class="s">File at least 2 days before it starts. A reason is required. It goes to your Manager, then to the Head for the final approval; HR and you are informed once it is approved.</div>
      ${form.companies && form.companies.length > 1 ? `<label>Company<select name="co">${form.companies.map((c) => `<option value="${esc(c.id)}"${c.id === form.company_id ? " selected" : ""}>${esc(c.code)} — ${esc(c.name)}</option>`).join("")}</select></label>` : ""}
      ${form.depts && form.depts.length ? `<label>Change for<select name="scope"><option value="people">Selected people</option><option value="dept">A whole department (the Manager decides who is included)</option></select></label>
      <label data-sc="dept" hidden>Department<select name="dept">${form.depts.map((d) => `<option value="${esc(d.id)}">${esc(d.section_of ? d.section_of + " › " : "")}${esc(d.name)} (${d.people} people)</option>`).join("")}</select></label>` : ""}
      <div data-sc="people"><span class="s">Who</span><div class="people">${(() => { const g = {}; form.people.forEach((p) => (g[p.me ? "Me" : p.dept || "No department"] ||= []).push(p));
        return Object.entries(g).map(([k, ps]) => `<div class="s"><b>${esc(k)}</b>${ps.length > 1 ? ` <button type="button" class="link" data-all="${esc(k)}">select all</button>` : ""}</div>` + ps.map((p) => `<label class="tick" data-g="${esc(k)}"><input type="checkbox" name="emp" value="${esc(p.id)}"${form.people.length === 1 || p.me ? " checked" : ""}> ${esc(p.name)}${p.me ? " (me)" : ""}</label>`).join("")).join(""); })()}</div></div>
      <label>New schedule<select name="sch">${form.schedules.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select></label>
      <label>Starting<input name="start" type="date" min="${min}" value="${min}" required></label>
      <label>Until (blank = until further notice)<input name="end" type="date"></label>
      <label>Reason (required)<textarea name="reason" rows="2" maxlength="500" required></textarea></label>
      <div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Submit request</button><button class="btn" type="button" id="fcancel" hidden>Stop editing</button></div></form>
    <h2>My requests</h2>${mine.map((r) => reqCard(r, esc, r.mine && r.status === "returned" ? `<div class="btns"><button class="btn primary" data-edit>Edit and re-submit</button><button class="btn" data-cancel>Cancel request</button></div>` : r.mine && (r.status === "pending" || r.status === "with_head") ? `<div class="btns"><button class="btn" data-cancel>Cancel request</button></div>` : "")).join("") || `<div class="empty">Nothing filed yet.</div>`}`;
  const f = el.querySelector("#sform");
  const syncScope = () => { const d = f.scope && f.scope.value === "dept" && !f.dataset.resub; f.querySelectorAll("[data-sc]").forEach((x) => (x.hidden = (x.dataset.sc === "dept") !== !!d)); };
  if (f.scope) { f.scope.onchange = syncScope; syncScope(); }
  if (f.co) f.co.onchange = () => renderShift(el, ctx, f.co.value);
  f.querySelectorAll("[data-all]").forEach((b) => (b.onclick = () => f.querySelectorAll("[data-g]").forEach((l) => { if (l.dataset.g === b.dataset.all) l.querySelector("input").checked = true; })));
  const stopEdit = () => reload();
  el.querySelector("#fcancel").onclick = stopEdit;
  // edit a returned request
  const startEdit = (id) => {
    const r = mine.find((x) => x.id === id); if (!r) return;
    f.dataset.resub = id; if (f.scope) { f.scope.value = "people"; } syncScope();
    const have = new Set(r.members.map((m) => m.id)), list = f.querySelector(".people");
    r.members.forEach((m) => { if (!f.querySelector(`[name=emp][value="${m.id}"]`)) list.insertAdjacentHTML("beforeend", `<label class="tick"><input type="checkbox" name="emp" value="${esc(m.id)}"> ${esc(m.name)}</label>`); });
    f.querySelectorAll("[name=emp]").forEach((c) => (c.checked = have.has(c.value)));
    f.sch.value = r.schedule_id; f.start.value = r.start_date; f.end.value = r.end_date || ""; f.reason.value = r.reason; f.start.min = "";
    el.querySelector("#ftitle").textContent = "Edit and re-submit"; f.querySelector("button[type=submit]").textContent = "Re-submit"; el.querySelector("#fcancel").hidden = false; f.scrollIntoView({ behavior: "smooth" });
  };
  f.onsubmit = async (ev) => { ev.preventDefault(); const err = f.querySelector(".eerr"); err.innerHTML = ""; const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    const dept = !f.dataset.resub && f.scope && f.scope.value === "dept", emps = dept ? [] : [...f.querySelectorAll("[name=emp]:checked")].map((c) => c.value);
    try {
      if (f.dataset.resub) await rpc("iaf_shift_change_resubmit", { p_id: f.dataset.resub, p_employees: emps, p_schedule: f.sch.value, p_start: f.start.value, p_end: f.end.value || null, p_reason: f.reason.value });
      else await rpc("iaf_shift_change_file", { p_employees: emps, p_schedule: f.sch.value, p_start: f.start.value, p_end: f.end.value || null, p_reason: f.reason.value, ...(dept ? { p_dept: f.dept.value } : {}) });
      toast("Submitted ✔"); reload();
    } catch (e) { err.innerHTML = errBox(e); btn.disabled = false; } };
  wireDecisions(el, ctx, reload, false, startEdit);
}

// HR list (Schedules page): everything, with override
export async function renderShiftHr(box, ctx, companyId) {
  const { rpc, esc, errBox } = ctx;
  let list; try { list = await rpc("iaf_shift_change_list", { p_company: companyId }); } catch (e) { box.innerHTML = errBox(e); return; }
  const reload = () => renderShiftHr(box, ctx, companyId);
  box.innerHTML = `<h3>Shift change requests <small>${list.filter((r) => ["pending", "with_head", "returned"].includes(r.status)).length} open</small></h3>${list.map((r) => reqCard(r, esc, r.status === "pending" || r.status === "with_head" ? hrBtns : "")).join("") || "<small>None in the last 90 days.</small>"}`;
  wireDecisions(box, ctx, reload, true);
}

// who gives the final approval (Head of Plant Operation)
export async function renderShiftFlow(box, ctx, companyId) {
  const { rpc, esc, toast, errBox } = ctx;
  let g; try { g = await rpc("iaf_shift_flow_get", { p_company: companyId }); } catch (e) { box.innerHTML = errBox(e); return; }
  box.innerHTML = `<h3>Shift changes: final approver</h3><p class="s">Requests go to the Manager first, then to this person (Head of Plant Operation) for the final approval. If none is set, the Manager's approval is final.</p>
    <div class="between"><select id="fhead"><option value="">— none —</option>${g.candidates.map((c) => `<option value="${esc(c.user_id)}"${c.user_id === g.head_user_id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select><button class="btn" id="fsave">Save</button></div><div class="eerr"></div>`;
  box.querySelector("#fsave").onclick = async () => { try { await rpc("iaf_shift_flow_set", { p_company: companyId, p_user: box.querySelector("#fhead").value || null }); toast("Saved ✔"); } catch (e) { box.querySelector(".eerr").innerHTML = errBox(e); } };
}
