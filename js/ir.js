// Incident reports (Code of Conduct step 2).
// Filer (supervisor and up / HR) -> the employee's supervisor -> department manager -> HR.
// HR issues the Notice to Explain, the employee explains (or HR records the handwritten one), HR may hold a hearing,
// HR decides per the Code (the manager or the Head of Plant Operation may recommend lighter), then the Head of Plant
// Operation and HR sign. The Head sees every report and acts only when asked. HR may restrict a report.
import { fnCall, storageUpload, storageBlob } from "./api.js";
import { sign } from "./sign.js";
import { ladder } from "./coc.js";

const BUCKET = "iaf-incidents";
const ST = { in_review: ["With reviewers", "wait"], returned: ["Returned to filer", "warn"], with_hr: ["With HR", "wait"], nte: ["Waiting for explanation", "warn"],
  explained: ["Explanation received", "wait"], for_signature: ["For signature", "wait"], decided: ["Decided", "ok"], closed: ["Closed — no violation", "mute"], withdrawn: ["Withdrawn", "mute"] };
const PENALTIES = ["Written Warning", "3 days Suspension", "6 days Suspension", "12 days Suspension", "Dismissal"];
const ACT = { filed: "filed the report", endorsed: "endorsed", returned: "returned it to the filer", resubmitted: "resubmitted", withdrawn: "withdrew the report",
  offense_added: "added an offense", head_requested: "asked the Head of Plant Operation", head_note: "Head of Plant Operation note", recommended: "recommended a lighter penalty",
  nte_issued: "issued the Notice to Explain", explained: "explained", explanation_recorded: "recorded the employee's explanation", no_explanation: "no explanation by the deadline",
  hearing: "recorded the hearing", decision_drafted: "drafted the decision", closed_no_violation: "closed: no violation", signed_head: "signed (Head of Plant Operation)",
  signed_hr: "signed (HR)", restricted: "restricted the report", unrestricted: "lifted the restriction", file_evidence: "attached evidence", file_explanation: "attached the explanation",
  file_hearing: "attached hearing minutes", file_decision: "attached the decision" };
let q = { box: "waiting", search: "", sel: null, mode: null, draft: null };

const dt = (iso) => (iso ? new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const chipOf = (s, esc) => { const [t, k] = ST[s] || [s, "mute"]; return `<span class="chip ${k}">${esc(t)}</span>`; };
const code = (o) => `Art. ${o.article} · Sec. ${o.section} · ${o.no}`;

export async function renderIr(el, ctx) {
  const { rpc, esc, errBox } = ctx;
  if (q.mode === "new") return renderNew(el, ctx);
  let rows, canFile = false;
  try { [rows, canFile] = await Promise.all([rpc("iaf_ir_list", { p_box: q.box, p_employee: null, p_status: null, p_q: q.search || null }), rpc("iaf_ir_can_file").catch(() => false)]); }
  catch (e) { el.innerHTML = errBox(e); return; }
  const reload = () => renderIr(el, ctx);
  el.innerHTML = `<div class="pfilters irbar"><div class="cotabs">${[["waiting", "Waiting for me"], ["all", "All I can see"], ["filed", "Filed by me"]].map(([k, t]) => `<button class="cotab${q.box === k ? " on" : ""}" data-box="${k}">${t}</button>`).join("")}</div>
      <input id="irq" type="search" placeholder="Search name or IR no." value="${esc(q.search)}">${canFile ? `<button class="btn primary" id="irnew">+ New incident report</button>` : ""}</div>
    <div class="split ${q.sel ? "has-detail" : ""}"><section class="pane-list">${rows.length ? `<div class="list">${rows.map((r) => `<a class="row prow${q.sel === r.id ? " on" : ""}" href="javascript:void 0" data-sel="${esc(r.id)}"><div class="grow">
        <div class="t">${esc(r.ref_no)} · ${esc(r.employee)}</div><div class="s">${esc(r.company)}${r.dept ? " · " + esc(r.dept) : ""} · ${esc(dt(r.incident_at))}</div>
        <div class="tchips">${chipOf(r.status, esc)}${r.waiting_on_me ? ' <span class="chip bad">Your turn</span>' : ""}${r.overdue ? ' <span class="chip warn">Explanation overdue</span>' : ""}${r.restricted ? ' <span class="chip mute">🔒 Restricted</span>' : ""}${r.head_review_requested ? ' <span class="chip warn">Head asked</span>' : ""}</div></div></a>`).join("")}</div>`
      : `<div class="empty">${q.box === "waiting" ? "🎉 Nothing waiting for you." : "No incident reports."}</div>`}</section>
      <section class="pane-detail" id="irdet">${q.sel ? '<div class="empty small">Loading…</div>' : '<div class="empty">Select a report to see it.</div>'}</section></div>`;
  el.querySelectorAll("[data-box]").forEach((b) => (b.onclick = () => { q.box = b.dataset.box; q.sel = null; reload(); }));
  let t; el.querySelector("#irq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q.search = e.target.value.trim(); reload(); }, 350); };
  const nb = el.querySelector("#irnew"); if (nb) nb.onclick = () => { q.mode = "new"; q.draft = { offenses: [] }; reload(); };
  el.querySelectorAll("[data-sel]").forEach((a) => (a.onclick = () => { q.sel = a.dataset.sel; reload(); }));
  if (ctx.state?.canPeople && ctx.state?.me?.company_id && !q.sel) {
    el.insertAdjacentHTML("beforeend", '<details class="card only-desktop"><summary><b>Settings (HR)</b></summary><div id="irset"></div></details>');
    irSettingsCard(el.querySelector("#irset"), ctx.state.me.company_id, ctx);
  }
  if (q.sel) renderDetail(el.querySelector("#irdet"), ctx, reload);
}

// ---------- detail ----------
async function renderDetail(box, ctx, reload) {
  const { rpc, esc, toast, errBox } = ctx;
  let d; try { d = await rpc("iaf_ir_get", { p_id: q.sel }); } catch (e) { box.innerHTML = errBox(e); return; }
  const me = d.me || {}, open = !["decided", "closed", "withdrawn"].includes(d.status);
  const reviewerCanAdd = open && !me.subject;
  const offenseCards = (d.offenses || []).map((o) => `<div class="card coc"><div class="s"><b>${esc(code(o))}</b> — ${esc(o.section_title)}${o.fit ? ` <span class="chip ${o.fit === "strong" ? "ok" : "mute"}">${o.fit === "strong" ? "Strong fit" : "Possible"}</span>` : ""}${o.source === "ai" ? ' <span class="chip tchip">AI</span>' : ""}</div>
      <p class="coct">${esc(o.text)}</p>${ladder(o.penalties, esc)}
      ${me.subject ? "" : `<p class="s">This year this would be offense no. <b>${o.count}</b> → Code penalty: <b>${esc(o.penalty_now || "")}</b></p>`}
      ${o.why ? `<p class="s">Why: ${esc(o.why)}</p>` : ""}${o.note ? `<div class="alert warn"><b>Note:</b> ${esc(o.note)}</div>` : ""}</div>`).join("");
  const route = (d.route || []).map((s) => `<li><b>${esc(s.name || "—")}</b> <small>${esc(s.role)}</small> ${s.action ? `<span class="chip ${s.action === "endorsed" ? "ok" : "warn"}">${esc(s.action)}</span>` : (d.status === "in_review" && d.holder === s.name ? '<span class="chip wait">reviewing</span>' : '<span class="chip mute">waiting</span>')}${s.note ? `<em>“${esc(s.note)}”</em>` : ""}</li>`).join("");
  const files = (d.files || []).map((f) => `<li><button class="link" data-file="${esc(f.path)}">📎 ${esc(f.name || "file")}</button> <small>${esc(f.kind)} · ${esc(dt(f.at))}</small></li>`).join("");
  const A = []; // action cards
  if (d.status === "in_review" && me.holder) A.push(`<div class="card"><h3>Your review</h3><p class="s">Check the facts and the offenses. Endorse to pass it on, or return it to the filer to add or correct something.</p>
      <label>Remarks<textarea id="rnote" rows="2" maxlength="1000"></textarea></label><div class="btns"><button class="btn primary" data-a="endorse">Endorse</button><button class="btn" data-a="return">Return to filer</button></div></div>`);
  if (d.status === "returned" && me.filer) A.push(`<div class="card"><h3>Returned to you</h3><p class="s">Correct or add to the description, then resubmit. The review starts again.</p>
      <label>What happened<textarea id="rdesc" rows="5" maxlength="6000">${esc(d.description)}</textarea></label><label>What you changed<input id="rnote" maxlength="500"></label>
      <div class="btns"><button class="btn primary" data-a="resubmit">Resubmit</button></div></div>`);
  if (d.status === "nte" && (me.subject || me.hr)) A.push(`<div class="card"><h3>${me.subject ? "Your written explanation" : "Record the employee's explanation"}</h3>
      <p class="s">${me.subject ? "Explain in your own words what happened. You may also attach a photo of a handwritten explanation." : (me.employee_has_login ? "The employee can type it in the app. If they gave it on paper, type it here or attach a photo." : "This employee has no login: type the explanation or attach a photo of the handwritten one.")}
      Deadline: <b>${esc(dt(d.explain_due_at))}</b>${d.overdue ? ' <span class="chip warn">overdue</span>' : ""}</p>
      <label>Explanation<textarea id="rnote" rows="5" maxlength="6000"></textarea></label><div class="btns"><button class="btn" data-up="explanation">Attach photo / file</button><button class="btn primary" data-a="explain">Submit explanation</button>
      ${me.hr && d.overdue ? '<button class="btn" data-a="no_explanation">No explanation received</button>' : ""}</div></div>`);
  if (me.hr && d.status === "with_hr") A.push(`<div class="card"><h3>Notice to Explain</h3><p class="s">Write what the employee must explain. The deadline is set from the HR setting (hours) and shown to the employee.</p>
      <label>What to explain<textarea id="rnote" rows="3" maxlength="2000" placeholder="e.g. Explain in writing why you drove the forklift above the speed limit inside the warehouse on Oct 9, 2026."></textarea></label>
      <div class="btns"><button class="btn primary" data-a="issue_nte">Issue Notice to Explain</button><button class="btn" data-a="return">Return to filer</button><button class="btn" data-a="no_violation">Close — no violation</button></div></div>`);
  if (me.hr && ["nte", "explained"].includes(d.status)) A.push(`<div class="card"><h3>Administrative hearing <span class="opt">(optional)</span></h3>
      <div class="two"><label>Date and time<input type="datetime-local" id="hat"></label><span></span></div><label>Minutes / what was agreed<textarea id="hnote" rows="3" maxlength="4000">${esc(d.hearing_notes || "")}</textarea></label>
      <div class="btns"><button class="btn" data-a="hearing">Save hearing</button><button class="btn" data-up="hearing">Attach minutes</button></div></div>`);
  if (me.hr && ["explained", "for_signature"].includes(d.status)) {
    const offs = d.offenses || [];
    A.push(`<div class="card"><h3>Decision</h3><p class="s">Choose the offense. The Code penalty follows this year's count. A different (lighter) penalty needs the reason${d.recommended_penalty ? ` — recommended: <b>${esc(d.recommended_penalty)}</b> by ${esc(d.recommended_by || "")}: “${esc(d.recommendation_reason || "")}”` : ""}.</p>
      <div class="two"><label>Offense<select id="doff">${offs.map((o) => `<option value="${esc(o.id)}" data-pen="${esc(o.penalty_now)}" ${d.offense?.id === o.id ? "selected" : ""}>${esc(code(o))} (offense no. ${o.count}: ${esc(o.penalty_now)})</option>`).join("") || '<option value="">Add an offense first</option>'}</select></label>
      <label>Penalty<select id="dpen">${PENALTIES.map((p) => `<option ${d.final_penalty === p ? "selected" : ""}>${p}</option>`).join("")}</select></label></div>
      <label>Reason / decision notes<textarea id="dnote" rows="3" maxlength="4000">${esc(d.decision_notes || "")}</textarea></label>
      <div class="btns"><button class="btn primary" data-a="decide">${d.status === "for_signature" ? "Change decision" : "Save decision for signature"}</button><button class="btn" data-a="no_violation">Close — no violation</button></div></div>`);
  }
  if (d.status === "for_signature" && ((me.head && !d.head_signed_at) || (me.hr && !d.hr_signed_at))) A.push(`<div class="card"><h3>Sign the decision</h3>
      <p>${esc(code(d.offense || {}))} · offense no. ${d.offense_count} · Code: ${esc(d.coc_penalty || "")} · <b>Decision: ${esc(d.final_penalty || "")}</b></p><p class="s">Your fingerprint, face or device PIN is your signature.</p>
      <div class="btns"><button class="btn primary" data-a="sign">Sign as ${me.head && !d.head_signed_at ? "Head of Plant Operation" : "HR"}</button></div></div>`);
  if (open && (me.head || (!me.subject && me.level >= 3))) A.push(`<div class="card"><h3>Recommend a lighter penalty</h3><div class="two"><label>Penalty<select id="rpen">${PENALTIES.map((p) => `<option>${p}</option>`).join("")}<option>Verbal reminder</option></select></label><span></span></div>
      <label>Reason<input id="rrea" maxlength="1000"></label><div class="btns"><button class="btn" data-a="recommend">Recommend</button></div></div>`);
  if (open && me.head && d.head_review_requested) A.push(`<div class="card"><h3>You were asked to confirm</h3><p>“${esc(d.head_review_note || "")}”</p>
      <label>Your note<textarea id="hdnote" rows="2" maxlength="1000"></textarea></label><div class="btns"><button class="btn primary" data-a="head_note">Send note</button></div></div>`);
  if (open && !me.subject && !me.head && !d.head_review_requested && d.head) A.push(`<div class="card"><h3>Ask the Head of Plant Operation</h3><p class="s">${esc(d.head)} sees every report and acts only when asked.</p>
      <label>What should be confirmed?<input id="hqnote" maxlength="1000"></label><div class="btns"><button class="btn" data-a="request_head">Ask for confirmation</button></div></div>`);
  const tools = [];
  if (reviewerCanAdd) tools.push(`<button class="btn" data-addoff>+ Add offense from the Code</button>`, `<button class="btn" data-ai>✨ Ask AI${d.explanation ? " (with the explanation)" : ""}</button>`, `<button class="btn" data-up="evidence">Attach evidence</button>`);
  if (me.hr && ["decided", "for_signature"].includes(d.status)) tools.push(`<button class="btn" data-up="decision">Attach signed decision</button>`);
  if (me.hr) tools.push(`<button class="btn" data-a="restrict">${d.restricted ? "Lift restriction" : "🔒 Restrict"}</button>`);
  if (open && (me.hr || (me.filer && ["in_review", "returned", "with_hr"].includes(d.status)))) tools.push(`<button class="btn danger" data-a="withdraw">Withdraw</button>`);

  box.innerHTML = `<a class="back" href="javascript:void 0" data-back>‹ Back to list</a>
    <div class="card"><div class="between"><h2 class="nm">${esc(d.ref_no)} · ${esc(d.employee)}</h2>${chipOf(d.status, esc)}</div>
      <p class="s">${esc(d.company)}${d.dept ? " · " + esc(d.dept) : ""} · filed by ${esc(d.filed_by)} on ${esc(dt(d.created_at))}${d.holder && open ? ` · waiting on <b>${esc(d.holder)}</b>` : ""}</p>
      ${d.restricted ? `<div class="alert">🔒 Restricted by HR: only HR and the Head of Plant Operation see this report.${d.restricted_note ? ` (${esc(d.restricted_note)})` : ""}</div>` : ""}
      <dl><dt>When</dt><dd>${esc(dt(d.incident_at))}</dd>${d.location ? `<dt>Where</dt><dd>${esc(d.location)}</dd>` : ""}${d.damage_amount != null ? `<dt>Damage</dt><dd>₱${Number(d.damage_amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</dd>` : ""}
      ${d.witnesses ? `<dt>Witnesses</dt><dd>${esc(d.witnesses)}</dd>` : ""}<dt>What happened</dt><dd class="pre">${esc(d.description)}</dd>
      ${d.nte_issued_at ? `<dt>Notice to Explain</dt><dd>${esc(d.nte_note || "")}<br><small>Issued ${esc(dt(d.nte_issued_at))} · due ${esc(dt(d.explain_due_at))}</small></dd>` : ""}
      ${d.explained_at ? `<dt>Explanation</dt><dd class="pre">${d.explanation ? esc(d.explanation) : "<i>None received</i>"}<br><small>${esc(dt(d.explained_at))}${d.explained_by ? " · recorded by " + esc(d.explained_by) : ""}${d.explanation_late ? " · late" : ""}</small></dd>` : ""}
      ${d.hearing_at ? `<dt>Hearing</dt><dd>${esc(dt(d.hearing_at))}${d.hearing_notes ? `<br><span class="pre">${esc(d.hearing_notes)}</span>` : ""}</dd>` : ""}
      ${d.recommended_penalty && !me.subject ? `<dt>Recommended</dt><dd>${esc(d.recommended_penalty)} — ${esc(d.recommended_by || "")}: “${esc(d.recommendation_reason || "")}”</dd>` : ""}
      ${d.final_penalty ? `<dt>Decision</dt><dd><b>${esc(d.final_penalty)}</b>${d.offense ? ` · ${esc(code(d.offense))} · offense no. ${d.offense_count} (Code: ${esc(d.coc_penalty || "")})` : ""}${d.decision_notes ? `<br>${esc(d.decision_notes)}` : ""}
        <br><small>Head of Plant Operation: ${d.head_signed_at ? "✔ " + esc(d.head_signed_by) + " " + esc(dt(d.head_signed_at)) : "not yet signed"} · HR: ${d.hr_signed_at ? "✔ " + esc(d.hr_signed_by) + " " + esc(dt(d.hr_signed_at)) : "not yet signed"}</small></dd>` : ""}</dl>
      ${tools.length ? `<div class="btns">${tools.join("")}</div>` : ""}<div class="eerr" id="irerr"></div></div>
    ${A.join("")}
    ${!me.subject && (d.route || []).length ? `<h3>Review route</h3><ol class="tl">${route}<li><b>HR</b> <small>decides</small></li></ol>` : ""}
    ${offenseCards ? `<h3>Offenses considered</h3>${offenseCards}` : (me.subject ? "" : '<div class="empty small">No offense chosen yet.</div>')}
    <div id="irai"></div>
    ${files ? `<h3>Files</h3><ul class="flist">${files}</ul>` : ""}
    ${(d.history || []).length ? `<h3>Earlier decided reports of this employee</h3><ul class="flist">${d.history.map((h) => `<li>${esc(h.ref_no)} · ${esc(dt(h.incident_at))} · ${esc(h.offense || "")} · <b>${esc(h.final_penalty || "")}</b></li>`).join("")}</ul>` : ""}
    ${(d.events || []).length ? `<h3>History</h3><ol class="tl">${d.events.map((e) => `<li><b>${esc(e.who || "")}</b> ${esc(ACT[e.action] || e.action)} <small>${esc(dt(e.at))}</small>${e.note ? `<em>“${esc(e.note)}”</em>` : ""}</li>`).join("")}</ol>` : ""}`;

  const err = box.querySelector("#irerr");
  const act = async (a, note, data = {}, sig = null) => {
    try { await rpc("iaf_ir_act", { p_id: d.id, p_action: a, p_note: note || null, p_data: data, p_signature: sig }); toast("Done ✔"); reload(); }
    catch (e) { (box.querySelector(`[data-a="${a}"]`)?.closest(".card")?.querySelector(".eerr") || err).innerHTML = errBox(e); if (!box.querySelector(`[data-a="${a}"]`)?.closest(".card")?.querySelector(".eerr")) err.scrollIntoView({ block: "nearest" }); }
  };
  box.querySelectorAll(".card").forEach((c) => { if (c.querySelector("[data-a]") && !c.querySelector(".eerr")) c.insertAdjacentHTML("beforeend", '<div class="eerr"></div>'); });
  box.querySelector("[data-back]").onclick = () => { q.sel = null; reload(); };
  const val = (id) => (box.querySelector(id) || {}).value || "";
  box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a;
    if (a === "endorse" || a === "return") return act(a, val("#rnote") || (a === "return" ? prompt("What should the filer add or correct?") : ""));
    if (a === "resubmit") return act(a, val("#rnote"), { description: val("#rdesc") });
    if (a === "issue_nte") return act(a, val("#rnote"));
    if (a === "explain") return act(a, val("#rnote"));
    if (a === "no_explanation") return act(a, "No explanation received by the deadline.");
    if (a === "hearing") return act(a, val("#hnote"), val("#hat") ? { hearing_at: new Date(val("#hat")).toISOString() } : {});
    if (a === "decide") { const o = box.querySelector("#doff"); return act(a, val("#dnote"), { offense_id: o.value, penalty: val("#dpen") }); }
    if (a === "no_violation") { const n = prompt("Why does no penalty apply?"); if (n) act(a, n); return; }
    if (a === "recommend") return act(a, val("#rrea"), { penalty: val("#rpen") });
    if (a === "head_note") return act(a, val("#hdnote"));
    if (a === "request_head") return act(a, val("#hqnote"));
    if (a === "withdraw") { const n = prompt("Why is the report withdrawn?"); if (n) act(a, n); return; }
    if (a === "restrict") { const n = prompt(d.restricted ? "Lift the restriction? Add a note (optional)." : "Restrict this report to HR and the Head of Plant Operation. Reason:"); if (n === null) return; return act(a, n, { restricted: !d.restricted }); }
    if (a === "sign") { b.disabled = true; b.textContent = "Waiting for your fingerprint / face / PIN…";
      try { const sid = await sign("APPROVE", ""); await act("sign", null, {}, sid); } catch (e) { err.innerHTML = errBox(e); b.disabled = false; b.textContent = "Sign"; } return; }
  }));
  // decision: pre-select the Code penalty of the chosen offense
  const doff = box.querySelector("#doff"), dpen = box.querySelector("#dpen");
  if (doff && dpen && !d.final_penalty) { const sync = () => { const p = doff.selectedOptions[0]?.dataset.pen; if (p && PENALTIES.includes(p)) dpen.value = p; }; doff.onchange = sync; sync(); }
  box.querySelectorAll("[data-file]").forEach((b) => (b.onclick = async () => { try { const blob = await storageBlob(BUCKET, b.dataset.file); const u = URL.createObjectURL(blob); window.open(u, "_blank") || (location.href = u); } catch (e) { toast(e.message, true); } }));
  box.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => pick(async (f) => { await upload(rpc, d.id, b.dataset.up, f); toast("File attached ✔"); reload(); }, toast)));
  const ao = box.querySelector("[data-addoff]"); if (ao) ao.onclick = () => offensePicker(box.querySelector("#irai"), ctx, async (o) => { await rpc("iaf_ir_act", { p_id: d.id, p_action: "add_offense", p_note: null, p_data: { offense_id: o.id, source: "reviewer" }, p_signature: null }); toast("Offense added ✔"); reload(); });
  const ai = box.querySelector("[data-ai]"); if (ai) ai.onclick = async () => {
    const out = box.querySelector("#irai"); ai.disabled = true; ai.textContent = "Reading the Code… (up to a minute)";
    try { const r = await fnCall("iaf-coc-ai", { incident: `${d.description}${d.location ? `\nWhere: ${d.location}` : ""}${d.damage_amount != null ? `\nDamage: PHP ${d.damage_amount}` : ""}${d.witnesses ? `\nWitnesses: ${d.witnesses}` : ""}`, explanation: d.explanation || null }, 120000);
      out.innerHTML = aiBlock(r, esc, (d.offenses || []).map((o) => o.id));
      out.querySelectorAll("[data-take]").forEach((b2) => (b2.onclick = async () => { const m = r.matches[Number(b2.dataset.take)];
        try { await rpc("iaf_ir_act", { p_id: d.id, p_action: "add_offense", p_note: null, p_data: { offense_id: m.id, source: "ai", fit: m.fit, why: m.why }, p_signature: null }); toast("Offense added ✔"); reload(); } catch (e) { toast(e.message, true); } }));
    } catch (e) { out.innerHTML = errBox(e); }
    ai.disabled = false; ai.textContent = "✨ Ask AI";
  };
}

function aiBlock(r, esc, have = [], pickable = true) {
  return `<div class="card"><h3>✨ What the AI found</h3><p>${esc(r.summary || "")}</p><p class="s">Guide only. HR decides per the Code.</p>
    ${(r.matches || []).map((m, i) => `<div class="card coc"><div class="s"><b>${esc(code(m))}</b> — ${esc(m.section_title)} <span class="chip ${m.fit === "strong" ? "ok" : "mute"}">${m.fit === "strong" ? "Strong fit" : "Possible"}</span></div>
      <p class="coct">${esc(m.text)}</p>${ladder(m.penalties, esc)}<p class="s">${esc(m.why)}</p>
      ${pickable ? (have.includes(m.id) ? '<span class="chip ok">Already in the report</span>' : `<button class="btn" data-take="${i}">Use this offense</button>`) : `<label class="check"><input type="checkbox" data-pick="${i}" ${m.fit === "strong" ? "checked" : ""}><span>Include in the report</span></label>`}</div>`).join("") || '<div class="empty small">No offense in the Code clearly fits.</div>'}
    ${(r.questions || []).length ? `<p><b>Confirm before deciding:</b></p><ul class="warnlist">${r.questions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${(r.explanation_points || []).length ? `<p><b>From the explanation:</b></p><ul class="warnlist">${r.explanation_points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
}

function offensePicker(out, { rpc, esc, errBox }, onPick) {
  out.innerHTML = `<div class="card"><h3>Add an offense from the Code</h3><input id="opq" type="search" placeholder="Search words, e.g. forklift, late, PPE"><div id="opres"></div></div>`;
  let t; const res = out.querySelector("#opres");
  out.querySelector("#opq").oninput = (e) => { clearTimeout(t); t = setTimeout(async () => {
    const v = e.target.value.trim(); if (v.length < 2) { res.innerHTML = ""; return; }
    try { const rows = (await rpc("iaf_coc_search", { p_q: v, p_article: null, p_section: null, p_ids: null })).slice(0, 12);
      res.innerHTML = rows.map((o, i) => `<div class="card coc"><div class="s"><b>${esc(code(o))}</b> — ${esc(o.section_title)}</div><p class="coct">${esc(o.text)}</p>${ladder(o.penalties, esc)}<button class="btn" data-o="${i}">Add</button></div>`).join("") || '<div class="empty small">Nothing found.</div>';
      res.querySelectorAll("[data-o]").forEach((b) => (b.onclick = async () => { try { await onPick(rows[Number(b.dataset.o)]); } catch (x) { res.insertAdjacentHTML("afterbegin", errBox(x)); } }));
    } catch (x) { res.innerHTML = errBox(x); } }, 300); };
  out.querySelector("#opq").focus();
}

function pick(onFile, toast, multiple = false) {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*,application/pdf"; inp.multiple = multiple;
  inp.onchange = async () => { const fs = [...inp.files]; if (!fs.length) return; try { for (const f of fs) await onFile(f); } catch (x) { toast(x.message, true); } };
  inp.click();
}
async function upload(rpc, id, kind, f) {
  if (f.size > 15 * 1024 * 1024) throw new Error("File is too big (15 MB max).");
  const path = `${id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
  await storageUpload(BUCKET, path, f);
  await rpc("iaf_ir_file_add", { p_id: id, p_kind: kind, p_path: path, p_name: f.name, p_size: f.size });
}

// ---------- new report ----------
async function renderNew(el, ctx) {
  const { rpc, esc, toast, errBox } = ctx;
  const d = q.draft;
  const back = () => { q.mode = null; q.draft = null; renderIr(el, ctx); };
  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  el.innerHTML = `<div class="card"><div class="between"><h2 class="nm">New incident report</h2><button class="btn" id="nback">Cancel</button></div>
    <p class="s">Write the facts only. It goes to the employee's supervisor, then the department manager, then HR. The employee is asked to explain once HR issues the Notice to Explain.</p>
    <form class="form" id="nf">
      <label>Employee involved<input id="nwho" type="search" placeholder="Type a name or employee no." value="${esc(d.emp?.full_name || "")}" autocomplete="off"></label><div id="nwhores"></div>
      <div class="two"><label>When did it happen?<input type="datetime-local" name="when" max="${nowLocal}" value="${esc(d.when || "")}" required></label><label>Where<input name="where" maxlength="200" value="${esc(d.where || "")}"></label></div>
      <label>What happened<textarea name="desc" rows="6" maxlength="6000" required placeholder="What, when, where, who saw it, what was damaged, how many times this month">${esc(d.desc || "")}</textarea></label>
      <div class="two"><label>Witnesses<input name="wit" maxlength="500" value="${esc(d.wit || "")}"></label><label>Damage / loss in ₱ <span class="opt">(if any)</span><input type="number" name="dmg" min="0" step="0.01" value="${esc(d.dmg ?? "")}"></label></div>
      <div class="btns"><button class="btn" type="button" id="nfiles">📎 Attach photos / documents</button><span class="s" id="nfcount">${(d.files || []).length ? `${d.files.length} file(s)` : ""}</span></div>
      <div class="btns"><button class="btn" type="button" id="nai">✨ Find what applies (AI)</button><button class="btn" type="button" id="nadd">+ Add offense from the Code</button></div>
      <div id="nchosen">${(d.offenses || []).map((o, i) => `<div class="card coc"><div class="s"><b>${esc(code(o))}</b> — ${esc(o.section_title)} <button class="link" type="button" data-rm="${i}">remove</button></div><p class="coct">${esc(o.text)}</p>${ladder(o.penalties, esc)}</div>`).join("")}</div>
      <div id="nai_out"></div>
      <div class="eerr"></div><button class="btn primary block" type="submit">Submit report</button></form></div>`;
  const f = el.querySelector("#nf");
  const keep = () => Object.assign(d, { when: f.when.value, where: f.where.value, desc: f.desc.value, wit: f.wit.value, dmg: f.dmg.value });
  el.querySelector("#nback").onclick = back;
  let t; const wres = el.querySelector("#nwhores");
  el.querySelector("#nwho").oninput = (e) => { d.emp = null; clearTimeout(t); t = setTimeout(async () => {
    try { const ppl = await rpc("iaf_ir_people", { p_q: e.target.value.trim() || null });
      wres.innerHTML = `<div class="list pick">${ppl.map((p, i) => `<a class="row" href="javascript:void 0" data-p="${i}"><div class="grow"><div class="t">${esc(p.full_name)}</div><div class="s">${esc(p.employee_no || "")} · ${esc(p.company)}${p.dept ? " · " + esc(p.dept) : ""}${p.has_login ? "" : " · no login"}</div></div></a>`).join("") || '<div class="empty small">No one found.</div>'}</div>`;
      wres.querySelectorAll("[data-p]").forEach((a) => (a.onclick = () => { d.emp = ppl[Number(a.dataset.p)]; el.querySelector("#nwho").value = d.emp.full_name; wres.innerHTML = `<p class="s">✔ ${esc(d.emp.full_name)} · ${esc(d.emp.company)}${d.emp.dept ? " · " + esc(d.emp.dept) : ""}</p>`; }));
    } catch (x) { wres.innerHTML = errBox(x); } }, 300); };
  el.querySelector("#nfiles").onclick = () => pick(async (file) => { (d.files ||= []).push(file); el.querySelector("#nfcount").textContent = `${d.files.length} file(s)`; }, toast, true);
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { keep(); d.offenses.splice(Number(b.dataset.rm), 1); renderNew(el, ctx); }));
  el.querySelector("#nadd").onclick = () => offensePicker(el.querySelector("#nai_out"), ctx, async (o) => { keep(); if (!d.offenses.some((x) => x.id === o.id)) d.offenses.push({ ...o, source: "filer" }); renderNew(el, ctx); });
  el.querySelector("#nai").onclick = async () => {
    const b = el.querySelector("#nai"), out = el.querySelector("#nai_out");
    if (f.desc.value.trim().length < 20) { out.innerHTML = errBox(new Error("Describe what happened first (a few sentences).")); return; }
    b.disabled = true; b.textContent = "Reading the Code… (up to a minute)";
    try { const r = await fnCall("iaf-coc-ai", { incident: `${f.desc.value}${f.where.value ? `\nWhere: ${f.where.value}` : ""}${f.dmg.value ? `\nDamage: PHP ${f.dmg.value}` : ""}${f.wit.value ? `\nWitnesses: ${f.wit.value}` : ""}` }, 120000);
      d.ai = r; out.innerHTML = aiBlock(r, esc, [], false);
    } catch (x) { out.innerHTML = errBox(x); }
    b.disabled = false; b.textContent = "✨ Find what applies (AI)";
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault(); keep(); const err = f.querySelector(".eerr"); err.innerHTML = ""; const btn = f.querySelector("button[type=submit]");
    if (!d.emp) { err.innerHTML = errBox(new Error("Choose the employee involved from the list.")); return; }
    const picked = d.ai ? [...el.querySelectorAll("[data-pick]:checked")].map((c) => d.ai.matches[Number(c.dataset.pick)]).map((m) => ({ id: m.id, fit: m.fit, why: m.why, source: "ai" })) : [];
    const offs = [...d.offenses.map((o) => ({ id: o.id, source: "filer" })), ...picked.filter((p) => !d.offenses.some((o) => o.id === p.id))];
    btn.disabled = true; btn.textContent = "Submitting…";
    try {
      const id = await rpc("iaf_ir_file", { p_employee: d.emp.id, p_incident_at: new Date(f.when.value).toISOString(), p_location: f.where.value || null, p_description: f.desc.value,
        p_witnesses: f.wit.value || null, p_damage: f.dmg.value === "" ? null : Number(f.dmg.value), p_offenses: offs, p_ai: d.ai ? { summary: d.ai.summary, questions: d.ai.questions } : null });
      for (const file of d.files || []) { btn.textContent = `Uploading ${file.name}…`; try { await upload(rpc, id, "evidence", file); } catch (x) { toast(`${file.name} did not upload: ${x.message}`, true); } }
      toast("Incident report submitted ✔"); q.mode = null; q.draft = null; q.sel = id; q.box = "filed"; renderIr(el, ctx);
    } catch (x) { err.innerHTML = errBox(x); btn.disabled = false; btn.textContent = "Submit report"; }
  };
}

// HR setting: hours the employee has to explain
export async function irSettingsCard(box, companyId, { rpc, esc, toast, errBox }) {
  try {
    const s = await rpc("iaf_ir_settings_get", { p_company: companyId });
    box.innerHTML = `<h3>Incident reports</h3><form class="form" id="irs"><div class="two"><label>Hours the employee has to explain<input type="number" name="h" min="1" max="240" value="${esc(s.explain_hours)}"></label>
      <span class="s">Head of Plant Operation (signs decisions): <b>${esc(s.head || "not set — set the final approver on the Schedules page")}</b></span></div><div class="eerr"></div><button class="btn" type="submit">Save</button></form>`;
    const f = box.querySelector("#irs");
    f.onsubmit = async (ev) => { ev.preventDefault(); try { await rpc("iaf_ir_settings_save", { p_company: companyId, p_hours: Number(f.h.value) }); toast("Saved ✔"); } catch (e) { f.querySelector(".eerr").innerHTML = errBox(e); } };
  } catch (e) { box.innerHTML = errBox(e); }
}
