// Incident reports, following the company forms.
//  General IR: any employee files -> Noted by (filer's supervisor / department head, then the involved employee's supervisor / manager) -> HR.
//    HR records the IR status (open / closed / extended) and closes it, or, when a Code of Conduct violation is marked, issues the
//    Notice to Explain; the employee explains, HR may hold a hearing, HR decides per the Code (lighter penalty may be recommended),
//    the Head of Plant Operation and HR sign. The Head sees every report and acts only when asked. HR may restrict a report.
//  IT Incident Report (FO-MIS-02): reporter -> immediate supervisor -> IT representative (assessment) -> IT Manager closes.
//  Both forms can be downloaded blank (paper filing) or filled (PDF).
import { fnCall, storageUpload, openStoredFile, rest } from "./api.js";
import { buildGeneralIrPdf, buildItIrPdf, downloadPdf, NATURE, IT_ASSETS, IT_TYPES, ROLE_LABEL, COMPANY_NAMES } from "./irpdf.js";
import { sign } from "./sign.js";
import { ladder } from "./coc.js";

const BUCKET = "iaf-incidents";
const ST = { in_review: ["With reviewers", "wait"], returned: ["Returned to filer", "warn"], with_hr: ["With HR", "wait"], nte: ["Waiting for explanation", "warn"],
  explained: ["Explanation received", "wait"], for_signature: ["For signature", "wait"], decided: ["Decided", "ok"], closed: ["Closed", "mute"], withdrawn: ["Withdrawn", "mute"] };
const PENALTIES = ["Written Warning", "3 days Suspension", "6 days Suspension", "12 days Suspension", "Dismissal"];
const ACT = { filed: "filed the report", endorsed: "endorsed", returned: "returned it to the filer", resubmitted: "resubmitted", withdrawn: "withdrew the report",
  offense_added: "added an offense", head_requested: "asked the Head of Plant Operation", head_note: "Head of Plant Operation note", recommended: "recommended a lighter penalty",
  nte_issued: "issued the Notice to Explain", explained: "explained", explanation_recorded: "recorded the employee's explanation", no_explanation: "no explanation by the deadline",
  hearing: "recorded the hearing", decision_drafted: "drafted the decision", closed_no_violation: "closed: no violation", signed_head: "signed (Head of Plant Operation)",
  signed_hr: "signed (HR)", restricted: "restricted the report", unrestricted: "lifted the restriction", file_evidence: "attached evidence", file_explanation: "attached the explanation",
  file_hearing: "attached hearing minutes", file_decision: "attached the decision", ir_status: "updated the IR status", closed: "closed the report",
  it_saved: "saved the IT assessment", it_assessed: "submitted the IT assessment", it_closed: "closed the IT report", sent_to_hr: "sent the report to HR" };
let q = { box: "waiting", search: "", kind: "", sel: null, mode: null, draft: null };
const who = (r) => r.employee || r.persons_other || "—";
const IRS = { open: "Open", closed: "Closed", extended: "Extended" };
const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const dt = (iso) => (iso ? new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const chipOf = (s, esc) => { const [t, k] = ST[s] || [s, "mute"]; return `<span class="chip ${k}">${esc(t)}</span>`; };
const code = (o) => `Art. ${o.article} · Sec. ${o.section} · ${o.no}`;

export async function renderIr(el, ctx) {
  const { rpc, esc, errBox } = ctx;
  if (q.mode === "new") return renderNew(el, ctx);
  let rows, canFile = false;
  try { [rows, canFile] = await Promise.all([rpc("iaf_ir_list", { p_box: q.box, p_employee: null, p_status: q.kind || null, p_q: q.search || null }), rpc("iaf_ir_can_file").catch(() => false)]); }
  catch (e) { el.innerHTML = errBox(e); return; }
  const reload = () => renderIr(el, ctx);
  el.innerHTML = `<div class="pfilters irbar"><div class="cotabs">${[["waiting", "Waiting for me"], ["all", "All I can see"], ["filed", "Filed by me"]].map(([k, t]) => `<button class="cotab${q.box === k ? " on" : ""}" data-box="${k}">${t}</button>`).join("")}</div>
      <select id="irkind"><option value="">All forms</option><option value="general"${q.kind === "general" ? " selected" : ""}>Incident reports</option><option value="it"${q.kind === "it" ? " selected" : ""}>IT incident reports</option></select>
      <input id="irq" type="search" placeholder="Search name or IR no." value="${esc(q.search)}">${canFile ? `<button class="btn primary" id="irnew">+ New report</button>` : ""}</div>
    <p class="s">Blank forms for paper filing: <button class="link" data-blank="general">Incident Report (PDF)</button> · <button class="link" data-blank="it">IT Incident Report FO-MIS-02 (PDF)</button></p>
    <div class="split ${q.sel ? "has-detail" : ""}"><section class="pane-list">${rows.length ? `<div class="list">${rows.map((r) => `<a class="row prow${q.sel === r.id ? " on" : ""}" href="javascript:void 0" data-sel="${esc(r.id)}"><div class="grow">
        <div class="t">${esc(r.ref_no)} · ${r.kind === "it" ? "IT · " + esc(r.filed_by) : esc(who(r))}</div><div class="s">${esc(r.company)}${r.dept && r.kind !== "it" ? " · " + esc(r.dept) : ""} · ${esc(dt(r.incident_at))}</div>
        <div class="tchips">${chipOf(r.status, esc)}${r.ir_state && r.ir_state !== "open" ? ` <span class="chip mute">IR ${esc(IRS[r.ir_state])}</span>` : ""}${r.waiting_on_me ? ' <span class="chip bad">Your turn</span>' : ""}${r.overdue ? ' <span class="chip warn">Explanation overdue</span>' : ""}${r.restricted ? ' <span class="chip mute">🔒 Restricted</span>' : ""}${r.head_review_requested ? ' <span class="chip warn">Head asked</span>' : ""}</div></div></a>`).join("")}</div>`
      : `<div class="empty">${q.box === "waiting" ? "🎉 Nothing waiting for you." : "No incident reports."}</div>`}</section>
      <section class="pane-detail" id="irdet">${q.sel ? '<div class="empty small">Loading…</div>' : '<div class="empty">Select a report to see it.</div>'}</section></div>`;
  el.querySelectorAll("[data-box]").forEach((b) => (b.onclick = () => { q.box = b.dataset.box; q.sel = null; reload(); }));
  let t; el.querySelector("#irq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q.search = e.target.value.trim(); q.focusSearch = true; reload(); }, 350); };
  if (q.focusSearch) { q.focusSearch = false; const i = el.querySelector("#irq"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  const nb = el.querySelector("#irnew"); if (nb) nb.onclick = () => { q.mode = "new"; q.draft = { offenses: [], kind: null }; reload(); };
  el.querySelector("#irkind").onchange = (e) => { q.kind = e.target.value; q.sel = null; reload(); };
  el.querySelectorAll("[data-blank]").forEach((b) => (b.onclick = async () => {
    const co = await myCompanyCode(ctx); const k = b.dataset.blank;
    downloadPdf(k === "it" ? buildItIrPdf({ blank: true, company: co }) : buildGeneralIrPdf({ blank: true, company: co }), `${k === "it" ? "FO-MIS-02_IT_Incident_Report" : "Incident_Report"}_${co}_blank.pdf`);
  }));
  el.querySelectorAll("[data-sel]").forEach((a) => (a.onclick = () => { q.sel = a.dataset.sel; reload(); }));
  if (ctx.state?.canPeople && ctx.state?.me?.company_id && !q.sel) {
    el.insertAdjacentHTML("beforeend", '<details class="card only-desktop"><summary><b>Settings (HR)</b></summary><div id="irset"></div></details>');
    irSettingsCard(el.querySelector("#irset"), ctx.state.me.company_id, ctx);
  }
  if (q.sel) renderDetail(el.querySelector("#irdet"), ctx, reload);
}

async function myCompanyCode(ctx) {
  if (ctx.state?.companyCode) return ctx.state.companyCode;
  try { const r = await rest(`companies?id=eq.${encodeURIComponent(ctx.state?.me?.company_id || "")}&select=short_code`); if (r[0]) return (ctx.state.companyCode = r[0].short_code); } catch { /* fall back below */ }
  return "WCLI";
}
function reportPdf(d) {
  const x = { ...d, hr_received: d.decided_by ? { name: d.decided_by, title: "HR", stamp: `Closed in IAF ${dt(d.decided_at)}` } : null };
  const name = `${d.kind === "it" ? "FO-MIS-02_" : "IR_"}${d.ref_no}.pdf`;
  downloadPdf(d.kind === "it" ? buildItIrPdf(x) : buildGeneralIrPdf(x), name);
}

// ---------- detail ----------
async function renderDetail(box, ctx, reload) {
  const { rpc, esc, toast, errBox } = ctx;
  let d; try { d = await rpc("iaf_ir_get2", { p_id: q.sel }); } catch (e) { box.innerHTML = errBox(e); return; }
  const me = d.me || {}, m2 = d.me2 || {}, open = !["decided", "closed", "withdrawn"].includes(d.status), isIt = d.kind === "it", it = d.it || {};
  const step = d.step || null, canCode = !!ctx.state?.canCoc;
  const reviewerCanAdd = open && !me.subject && !isIt && canCode;
  const offenseCards = (d.offenses || []).map((o) => `<div class="card coc"><div class="s"><b>${esc(code(o))}</b> — ${esc(o.section_title)}${o.fit ? ` <span class="chip ${o.fit === "strong" ? "ok" : "mute"}">${o.fit === "strong" ? "Strong fit" : "Possible"}</span>` : ""}${o.source === "ai" ? ' <span class="chip tchip">AI</span>' : ""}</div>
      <p class="coct">${esc(o.text)}</p>${ladder(o.penalties, esc)}
      ${me.subject ? "" : `<p class="s">This year this would be offense no. <b>${o.count}</b> → Code penalty: <b>${esc(o.penalty_now || "")}</b></p>`}
      ${o.why ? `<p class="s">Why: ${esc(o.why)}</p>` : ""}${o.note ? `<div class="alert warn"><b>Note:</b> ${esc(o.note)}</div>` : ""}</div>`).join("");
  const routeRows = (d.route_titles || []).map((s) => `<li><b>${esc(s.name || (s.role === "it_rep" ? "Any IT representative" : "—"))}</b> <small>${esc(ROLE_LABEL[s.role] || s.role)}${s.title ? " · " + esc(s.title) : ""}</small>
      ${s.action ? `<span class="chip ${["endorsed", "assessed", "approved"].includes(s.action) ? "ok" : "warn"}">${esc(s.action.replace(/_/g, " "))}</span>` : (step && step.role === s.role && d.status === "in_review" ? '<span class="chip wait">now</span>' : '<span class="chip mute">waiting</span>')}</li>`).join("");
  const files = (d.files || []).map((f) => `<li><button class="link" data-file="${esc(f.path)}">📎 ${esc(f.name || "file")}</button> <small>${esc(f.kind)} · ${esc(dt(f.at))}</small></li>`).join("");
  const natureTxt = (d.nature || []).map((k) => NATURE.flatMap(([, it2]) => it2).find(([c]) => c === k)?.[1] || k).join(", ");
  const opt = (arr, sel) => arr.map(([k, t]) => `<option value="${k}"${sel === k ? " selected" : ""}>${t}</option>`).join("");
  const A = []; // action cards
  if (d.status === "in_review" && me.holder && step && !["it_rep", "it_manager"].includes(step.role)) A.push(`<div class="card"><h3>Your review</h3>
      <p class="s">${isIt ? "Check the report. Endorse it to IT, or return it to the reporter." : "Check the facts. Endorse (noted) to pass it on, or return it to the filer to add or correct something."}</p>
      <label>Remarks<textarea id="rnote" rows="2" maxlength="1000"></textarea></label><div class="btns"><button class="btn primary" data-a="endorse">${isIt ? "Endorse to IT" : "Noted — endorse"}</button><button class="btn" data-a="return">Return to filer</button></div></div>`);
  if (isIt && open && d.status === "in_review" && m2.it && step && ["it_rep", "it_manager"].includes(step.role)) {
    const noMgr = !(d.route_titles || []).some((s) => s.role === "it_manager");
    A.push(`<div class="card"><h3>IT assessment</h3><p class="s">To be filled out by an IT representative.${step.role === "it_manager" ? " Already with the IT Manager; you can still correct it." : ""}</p>
      <div class="two"><label>Asset tag<input id="i_asset_tag" maxlength="100" value="${esc(it.asset_tag || "")}"></label><label>Accountability form no.<input id="i_accountability_no" maxlength="100" value="${esc(it.accountability_no || "")}"></label></div>
      <div class="two"><label>Account<input id="i_account" maxlength="200" value="${esc(it.account || "")}"></label><label>Platform<input id="i_platform" maxlength="200" value="${esc(it.platform || "")}"></label></div>
      <label>A. Findings<textarea id="i_findings" rows="3" maxlength="4000">${esc(it.findings || "")}</textarea></label>
      <label>B. Business impact<textarea id="i_impact" rows="2" maxlength="4000">${esc(it.impact || "")}</textarea></label>
      <label>Action taken<textarea id="i_action_taken" rows="2" maxlength="4000">${esc(it.action_taken || "")}</textarea></label>
      <label>Recommendation<textarea id="i_recommendation" rows="2" maxlength="4000">${esc(it.recommendation || "")}</textarea></label>
      <div class="two"><label>Status<select id="i_it_status">${opt([["open", "Open"], ["ongoing", "Ongoing"], ["closed", "Closed"]], it.it_status || "open")}</select></label><span></span></div>
      <div class="btns"><button class="btn" data-a="it_save">Save</button>${step.role === "it_rep" ? `<button class="btn primary" data-a="it_submit">${noMgr ? "Save" : "Submit to the IT Manager"}</button>` : ""}
      ${step.role === "it_rep" && noMgr ? '<button class="btn primary" data-a="it_close">Close report</button>' : ""}<button class="btn" data-a="to_hr">Send to HR</button></div></div>`);
  }
  if (isIt && open && d.status === "in_review" && step && step.role === "it_manager" && step.mine) A.push(`<div class="card"><h3>IT Manager</h3><p class="s">Check the IT assessment, then close the report. If it needs discipline (for example theft or misuse), send it to HR.</p>
      <label>Remarks<input id="mnote" maxlength="1000"></label><div class="btns"><button class="btn primary" data-a="it_close">Close report</button><button class="btn" data-a="to_hr">Send to HR</button></div></div>`);
  if (me.hr && d.status === "with_hr") {
    const canNte = m2.has_offense && d.employee_id;
    A.push(`<div class="card"><h3>HR</h3>
      <p class="s">${canNte ? "A Code of Conduct violation is marked. Issue the Notice to Explain, or close the report." : `No Code of Conduct violation is marked${d.employee_id ? "" : " and no employee is named"}. Record the IR status and corrective action below and close the report.${d.employee_id ? " To start the disciplinary steps, add the offense first (button above)." : ""}`}</p>
      ${canNte ? `<label>What the employee must explain<textarea id="rnote" rows="3" maxlength="2000" placeholder="e.g. Explain in writing why you drove the forklift above the speed limit inside the warehouse on Oct 9, 2026."></textarea></label>` : ""}
      <div class="btns">${canNte ? '<button class="btn primary" data-a="issue_nte">Issue Notice to Explain</button>' : ""}${m2.can_close ? '<button class="btn" data-a="close">Close — no disciplinary action</button>' : '<button class="btn" data-a="no_violation">Close — no violation</button>'}<button class="btn" data-a="return">Return to filer</button></div></div>`);
  }
  if (m2.can_set_state && d.status !== "withdrawn") A.push(`<div class="card"><h3>IR status</h3>
      <div class="two"><label>Status<select id="sst">${opt([["open", "Open"], ["closed", "Closed"], ["extended", "Extended"]], d.ir_state)}</select></label><label>Extended to<input type="date" id="sext" value="${esc(d.extended_to || "")}"></label></div>
      ${isIt ? "" : `<label>Corrective action<textarea id="scor" rows="2" maxlength="2000">${esc(d.corrective_action || "")}</textarea></label>
      <div class="two"><label>Responsible<input id="sres" maxlength="200" value="${esc(d.responsible || "")}"></label><label>Target date of completion<input type="date" id="stgt" value="${esc(d.target_date || "")}"></label></div>`}
      <label>Note<input id="snote" maxlength="500"></label><div class="btns"><button class="btn" data-a="ir_status">Save IR status</button></div></div>`);
  if (d.status === "returned" && me.filer) A.push(`<div class="card"><h3>Returned to you</h3><p class="s">Correct or add to the description, then resubmit. The review starts again.</p>
      <label>What happened<textarea id="rdesc" rows="5" maxlength="6000">${esc(d.description)}</textarea></label><label>What you changed<input id="rnote" maxlength="500"></label>
      <div class="btns"><button class="btn primary" data-a="resubmit">Resubmit</button></div></div>`);
  if (d.status === "nte" && (me.subject || me.hr)) A.push(`<div class="card"><h3>${me.subject ? "Your written explanation" : "Record the employee's explanation"}</h3>
      <p class="s">${me.subject ? "Explain in your own words what happened. You may also attach a photo of a handwritten explanation." : (me.employee_has_login ? "The employee can type it in the app. If they gave it on paper, type it here or attach a photo." : "This employee has no login: type the explanation or attach a photo of the handwritten one.")}
      Deadline: <b>${esc(dt(d.explain_due_at))}</b>${d.overdue ? ' <span class="chip warn">overdue</span>' : ""}</p>
      <label>Explanation<textarea id="rnote" rows="5" maxlength="6000"></textarea></label><div class="btns"><button class="btn" data-up="explanation">Attach photo / file</button><button class="btn primary" data-a="explain">Submit explanation</button>
      ${me.hr && d.overdue ? '<button class="btn" data-a="no_explanation">No explanation received</button>' : ""}</div></div>`);
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
  const disc = d.employee_id && (m2.has_offense || ["nte", "explained", "for_signature"].includes(d.status));
  if (open && disc && (me.head || (!me.subject && me.level >= 3))) A.push(`<div class="card"><h3>Recommend a lighter penalty</h3><div class="two"><label>Penalty<select id="rpen">${PENALTIES.map((p) => `<option>${p}</option>`).join("")}<option>Verbal reminder</option></select></label><span></span></div>
      <label>Reason<input id="rrea" maxlength="1000"></label><div class="btns"><button class="btn" data-a="recommend">Recommend</button></div></div>`);
  if (open && me.head && d.head_review_requested) A.push(`<div class="card"><h3>You were asked to confirm</h3><p>“${esc(d.head_review_note || "")}”</p>
      <label>Your note<textarea id="hdnote" rows="2" maxlength="1000"></textarea></label><div class="btns"><button class="btn primary" data-a="head_note">Send note</button></div></div>`);
  if (open && !isIt && !me.subject && !me.head && !d.head_review_requested && d.head && (me.hr || me.level >= 2)) A.push(`<div class="card"><h3>Ask the Head of Plant Operation</h3><p class="s">${esc(d.head)} sees every report and acts only when asked.</p>
      <label>What should be confirmed?<input id="hqnote" maxlength="1000"></label><div class="btns"><button class="btn" data-a="request_head">Ask for confirmation</button></div></div>`);
  const tools = [`<button class="btn" data-pdf>⬇ Download form (PDF)</button>`];
  if (reviewerCanAdd) tools.push(`<button class="btn" data-addoff>+ Add Code of Conduct violation</button>`, `<button class="btn" data-ai>✨ Ask AI${d.explanation ? " (with the explanation)" : ""}</button>`);
  if (open && !me.subject) tools.push(`<button class="btn" data-up="evidence">Attach evidence</button>`);
  if (me.hr && ["decided", "for_signature"].includes(d.status)) tools.push(`<button class="btn" data-up="decision">Attach signed decision</button>`);
  if (me.hr) tools.push(`<button class="btn" data-a="restrict">${d.restricted ? "Lift restriction" : "🔒 Restrict"}</button>`);
  if (open && (me.hr || (me.filer && ["in_review", "returned", "with_hr"].includes(d.status)))) tools.push(`<button class="btn danger" data-a="withdraw">Withdraw</button>`);

  const facts = isIt
    ? `<dt>Reported by</dt><dd>${esc(d.filer?.name || d.filed_by)}${d.filer?.position ? " · " + esc(d.filer.position) : ""}${d.filer?.department ? " · " + esc(d.filer.department) : ""}</dd>
       <dt>Affected asset</dt><dd>${esc((it.assets || []).map((k) => IT_ASSETS.find(([c]) => c === k)?.[1].replace(" (specify)", "") || k).join(", "))}${it.account_spec ? ": " + esc(it.account_spec) : ""}</dd>
       <dt>Type of incident</dt><dd>${esc((it.types || []).map((k) => IT_TYPES.find(([c]) => c === k)?.[1].replace(" (specify)", "") || k).join(", "))}${it.others_spec ? ": " + esc(it.others_spec) : ""}</dd>
       <dt>When</dt><dd>${esc(dt(d.incident_at))}</dd><dt>Description / symptoms</dt><dd class="pre">${esc(d.description)}</dd>
       ${it.findings || it.asset_tag ? `<dt>IT assessment</dt><dd>${it.asset_tag ? `Asset tag ${esc(it.asset_tag)} · ` : ""}${it.accountability_no ? `Accountability form ${esc(it.accountability_no)} · ` : ""}${it.account ? `Account ${esc(it.account)} · ` : ""}${it.platform ? `Platform ${esc(it.platform)}` : ""}
         ${it.findings ? `<br><b>Findings:</b> ${esc(it.findings)}` : ""}${it.impact ? `<br><b>Business impact:</b> ${esc(it.impact)}` : ""}${it.action_taken ? `<br><b>Action taken:</b> ${esc(it.action_taken)}` : ""}${it.recommendation ? `<br><b>Recommendation:</b> ${esc(it.recommendation)}` : ""}
         <br><small>Status: ${esc(it.it_status || "open")}${d.it_rep_name ? " · IT representative " + esc(d.it_rep_name) : ""}${d.it_mgr_name ? " · closed by " + esc(d.it_mgr_name) + " " + esc(dt(d.it_mgr_at)) : ""}</small></dd>` : ""}`
    : `<dt>Person/s involved</dt><dd>${esc(d.employee || "")}${d.employee && d.persons_other ? ", " : ""}${esc(d.persons_other || "")}${d.subject?.position ? ` <small>(${esc(d.subject.position)}${d.subject.department ? ", " + esc(d.subject.department) : ""})</small>` : ""}</dd>
       <dt>When</dt><dd>${esc(dt(d.incident_at))}</dd>${d.location ? `<dt>Area of incident</dt><dd>${esc(d.location)}</dd>` : ""}<dt>Nature</dt><dd>${esc(natureTxt)}</dd>
       ${d.damage_amount != null ? `<dt>Damage</dt><dd>₱${Number(d.damage_amount).toLocaleString("en-PH", { minimumFractionDigits: 2 })}</dd>` : ""}
       ${d.witnesses ? `<dt>Witnesses</dt><dd>${esc(d.witnesses)}</dd>` : ""}<dt>What happened</dt><dd class="pre">${esc(d.description)}</dd>
       ${d.corrective_action || d.responsible || d.target_date ? `<dt>Corrective action</dt><dd>${esc(d.corrective_action || "")}${d.responsible ? `<br><small>Responsible: ${esc(d.responsible)}</small>` : ""}${d.target_date ? `<br><small>Target date: ${esc(d.target_date)}</small>` : ""}</dd>` : ""}
       <dt>IR status</dt><dd>${esc(IRS[d.ir_state] || d.ir_state)}${d.ir_state === "extended" && d.extended_to ? " to " + esc(d.extended_to) : ""}</dd>`;
  box.innerHTML = `<a class="back" href="javascript:void 0" data-back>‹ Back to list</a>
    <div class="card"><div class="between"><h2 class="nm">${esc(d.ref_no)} · ${isIt ? "IT incident" : esc(who(d))}</h2>${chipOf(d.status, esc)}</div>
      <p class="s">${esc(d.company)}${d.dept && !isIt ? " · " + esc(d.dept) : ""} · filed by ${esc(d.filed_by)} on ${esc(dt(d.created_at))}${d.holder && open ? ` · waiting on <b>${esc(d.holder)}</b>` : (open && step && step.role === "it_rep" ? " · waiting on <b>IT</b>" : "")}</p>
      ${d.restricted ? `<div class="alert">🔒 Restricted by HR: only HR and the Head of Plant Operation see this report.${d.restricted_note ? ` (${esc(d.restricted_note)})` : ""}</div>` : ""}
      <dl>${facts}
      ${d.nte_issued_at ? `<dt>Notice to Explain</dt><dd>${esc(d.nte_note || "")}<br><small>Issued ${esc(dt(d.nte_issued_at))} · due ${esc(dt(d.explain_due_at))}</small></dd>` : ""}
      ${d.explained_at ? `<dt>Explanation</dt><dd class="pre">${d.explanation ? esc(d.explanation) : "<i>None received</i>"}<br><small>${esc(dt(d.explained_at))}${d.explained_by ? " · recorded by " + esc(d.explained_by) : ""}${d.explanation_late ? " · late" : ""}</small></dd>` : ""}
      ${d.hearing_at ? `<dt>Hearing</dt><dd>${esc(dt(d.hearing_at))}${d.hearing_notes ? `<br><span class="pre">${esc(d.hearing_notes)}</span>` : ""}</dd>` : ""}
      ${d.recommended_penalty && !me.subject ? `<dt>Recommended</dt><dd>${esc(d.recommended_penalty)} — ${esc(d.recommended_by || "")}: “${esc(d.recommendation_reason || "")}”</dd>` : ""}
      ${d.final_penalty ? `<dt>Decision</dt><dd><b>${esc(d.final_penalty)}</b>${d.offense ? ` · ${esc(code(d.offense))} · offense no. ${d.offense_count} (Code: ${esc(d.coc_penalty || "")})` : ""}${d.decision_notes ? `<br>${esc(d.decision_notes)}` : ""}
        ${d.offense ? `<br><small>Head of Plant Operation: ${d.head_signed_at ? "✔ " + esc(d.head_signed_by) + " " + esc(dt(d.head_signed_at)) : "not yet signed"} · HR: ${d.hr_signed_at ? "✔ " + esc(d.hr_signed_by) + " " + esc(dt(d.hr_signed_at)) : "not yet signed"}</small>` : ""}</dd>`
        : (d.status === "closed" && d.decision_notes ? `<dt>Closed</dt><dd>${esc(d.decision_notes)}<br><small>${esc(d.decided_by || "")} ${esc(dt(d.decided_at))}</small></dd>` : "")}</dl>
      <div class="btns">${tools.join("")}</div><div class="eerr" id="irerr"></div></div>
    ${A.join("")}
    ${!me.subject && (d.route_titles || []).length ? `<h3>Route</h3><ol class="tl">${routeRows}${isIt ? "" : "<li><b>HR</b> <small>records the IR status, decides on any violation</small></li>"}</ol>` : ""}
    ${offenseCards ? `<h3>Code of Conduct violation</h3>${offenseCards}` : ""}
    <div id="irai"></div>
    ${files ? `<h3>Files</h3><ul class="flist">${files}</ul>` : ""}
    ${(d.history || []).length ? `<h3>Earlier decided reports of this employee</h3><ul class="flist">${d.history.map((h) => `<li>${esc(h.ref_no)} · ${esc(dt(h.incident_at))} · ${esc(h.offense || "")} · <b>${esc(h.final_penalty || "")}</b></li>`).join("")}</ul>` : ""}
    ${(d.events || []).length ? `<h3>History</h3><ol class="tl">${d.events.map((e) => `<li><b>${esc(e.who || "")}</b> ${esc(ACT[e.action] || e.action)} <small>${esc(dt(e.at))}</small>${e.note ? `<em>“${esc(e.note)}”</em>` : ""}</li>`).join("")}</ol>` : ""}`;

  const err = box.querySelector("#irerr");
  const act = async (a, note, data = {}, sig = null, btnA = a) => {
    try { await rpc("iaf_ir_act2", { p_id: d.id, p_action: a, p_note: note || null, p_data: data, p_signature: sig }); toast("Done ✔"); reload(); }
    catch (e) { const c = box.querySelector(`[data-a="${btnA}"]`)?.closest(".card")?.querySelector(".eerr"); (c || err).innerHTML = errBox(e); if (!c) err.scrollIntoView({ block: "nearest" }); }
  };
  box.querySelectorAll(".card").forEach((c) => { if (c.querySelector("[data-a]") && !c.querySelector(".eerr")) c.insertAdjacentHTML("beforeend", '<div class="eerr"></div>'); });
  box.querySelector("[data-back]").onclick = () => { q.sel = null; reload(); };
  const val = (id) => (box.querySelector(id) || {}).value || "";
  const itData = () => Object.fromEntries(["asset_tag", "accountability_no", "account", "platform", "findings", "impact", "action_taken", "recommendation", "it_status"].map((k) => [k, val("#i_" + k)]));
  box.querySelectorAll("[data-a]").forEach((b) => (b.onclick = async () => {
    const a = b.dataset.a;
    if (a === "endorse") return act(a, val("#rnote"));
    if (a === "return") { const n = val("#rnote") || prompt("What should the filer add or correct?"); if (!n) return; return act(a, n); }
    if (a === "resubmit") return act(a, val("#rnote"), { description: val("#rdesc") });
    if (a === "issue_nte") return act(a, val("#rnote"));
    if (a === "close") { const n = prompt("Closing note (optional): what was agreed / corrective action done?"); if (n === null) return; return act(a, n); }
    if (a === "ir_status") return act(a, val("#snote"), { ir_state: val("#sst"), extended_to: val("#sext") || null, corrective_action: val("#scor") || null, responsible: val("#sres") || null, target_date: val("#stgt") || null });
    if (a === "it_save") return act("it_assess", null, itData(), null, "it_save");
    if (a === "it_submit") return act("it_assess", null, { ...itData(), submit: true }, null, "it_submit");
    if (a === "it_close") { if (box.querySelector("#i_findings")) { try { await rpc("iaf_ir_act2", { p_id: d.id, p_action: "it_assess", p_note: null, p_data: itData(), p_signature: null }); } catch (e) { (b.closest(".card").querySelector(".eerr") || err).innerHTML = errBox(e); return; } }
      return act("it_close", val("#mnote")); }
    if (a === "to_hr") { const n = prompt("Why should HR handle this? (for example theft or misuse)"); if (n) act(a, n); return; }
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
    if (a === "sign") { const label = b.textContent; b.disabled = true; b.textContent = "Waiting for your fingerprint / face / PIN…";
      try { const sid = await sign("APPROVE", ""); await act("sign", null, {}, sid); } catch (e) { err.innerHTML = errBox(e); b.disabled = false; b.textContent = label; } return; }
  }));
  box.querySelector("[data-pdf]").onclick = () => { try { reportPdf(d); } catch (e) { toast(e.message || "Could not make the PDF", true); } };
  const doff = box.querySelector("#doff"), dpen = box.querySelector("#dpen");
  if (doff && dpen && !d.final_penalty) { const sync = () => { const p = doff.selectedOptions[0]?.dataset.pen; if (p && PENALTIES.includes(p)) dpen.value = p; }; doff.onchange = sync; sync(); }
  box.querySelectorAll("[data-file]").forEach((b) => (b.onclick = async () => { try { await openStoredFile(BUCKET, b.dataset.file); } catch (e) { toast(e.message, true); } }));
  box.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => pick(async (f) => { await upload(rpc, d.id, b.dataset.up, f); toast("File attached ✔"); reload(); }, toast)));
  const ao = box.querySelector("[data-addoff]"); if (ao) ao.onclick = () => offensePicker(box.querySelector("#irai"), ctx, async (o) => { await rpc("iaf_ir_act2", { p_id: d.id, p_action: "add_offense", p_note: null, p_data: { offense_id: o.id, source: "reviewer" }, p_signature: null }); toast("Offense added ✔"); reload(); });
  const ai = box.querySelector("[data-ai]"); if (ai) ai.onclick = async () => {
    const out = box.querySelector("#irai"); ai.disabled = true; ai.textContent = "Reading the Code… (up to a minute)";
    try { const r = await fnCall("iaf-coc-ai", { incident: `${d.description}${d.location ? `\nWhere: ${d.location}` : ""}${d.damage_amount != null ? `\nDamage: PHP ${d.damage_amount}` : ""}${d.witnesses ? `\nWitnesses: ${d.witnesses}` : ""}`, explanation: d.explanation || null }, 120000);
      out.innerHTML = aiBlock(r, esc, (d.offenses || []).map((o) => o.id));
      out.querySelectorAll("[data-take]").forEach((b2) => (b2.onclick = async () => { const m = r.matches[Number(b2.dataset.take)];
        try { await rpc("iaf_ir_act2", { p_id: d.id, p_action: "add_offense", p_note: null, p_data: { offense_id: m.id, source: "ai", fit: m.fit, why: m.why }, p_signature: null }); toast("Offense added ✔"); reload(); } catch (e) { toast(e.message, true); } }));
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
  if (!d.kind) {
    el.innerHTML = `<div class="card"><div class="between"><h2 class="nm">New report</h2><button class="btn" id="nback">Cancel</button></div>
      <p class="s">Choose the form. Both follow the company paper forms and can also be downloaded blank from the list.</p>
      <div class="btns"><button class="btn primary" data-kind="general">📝 Incident Report (IR)</button><button class="btn primary" data-kind="it">💻 IT Incident Report (FO-MIS-02)</button></div>
      <p class="s"><b>Incident Report:</b> anything that happened at work (health &amp; safety, company policy, procedure, clients / third parties). It goes to your supervisor / department head to note, then to HR.<br>
      <b>IT Incident Report:</b> a problem with your laptop, desktop or account (damage, file loss, theft, malware, hacked account). It goes to your immediate supervisor, then IT.</p></div>`;
    el.querySelector("#nback").onclick = back;
    el.querySelectorAll("[data-kind]").forEach((b) => (b.onclick = () => { d.kind = b.dataset.kind; renderNew(el, ctx); }));
    return;
  }
  const isIt = d.kind === "it", canCode = !!ctx.state?.canCoc;
  const chk = (name, list, sel) => list.map(([k, t]) => `<label class="check"><input type="checkbox" name="${name}" value="${k}"${(sel || []).includes(k) ? " checked" : ""}><span>${esc(t)}</span></label>`).join("");
  el.innerHTML = `<div class="card"><div class="between"><h2 class="nm">${isIt ? "IT Incident Report" : "Incident Report (IR)"}</h2><span><button class="btn" id="nswitch">Change form</button> <button class="btn" id="nback">Cancel</button></span></div>
    <p class="s">${isIt ? "Your name, position and department are filled in from your record. It goes to your immediate supervisor, then an IT representative assesses it and the IT Manager closes it."
      : "To be completed within 24 hours after the incident. Write the facts only. It goes to your supervisor / department head (noted by), then HR."}</p>
    <form class="form" id="nf">
    ${isIt ? `<fieldset class="fs"><legend>Affected asset</legend>${chk("asset", IT_ASSETS, d.assets)}<label>Account (specify)<input name="acc" maxlength="200" value="${esc(d.acc || "")}"></label></fieldset>
      <fieldset class="fs"><legend>Type of incident</legend>${chk("itype", IT_TYPES, d.itypes)}<label>Others (specify)<input name="oth" maxlength="200" value="${esc(d.oth || "")}"></label></fieldset>
      <label>Date &amp; time<input type="datetime-local" name="when" max="${nowLocal()}" value="${esc(d.when || "")}" required></label>
      <label>Description / symptoms<textarea name="desc" rows="5" maxlength="6000" required placeholder="What happened, error messages, since when">${esc(d.desc || "")}</textarea></label>
      <div class="alert warn">Please include photos and available documentary evidence of the incident.</div>`
    : `<label>Person/s involved <span class="opt">(employee)</span><input id="nwho" type="search" placeholder="Type a name or employee no." value="${esc(d.emp?.full_name || "")}" autocomplete="off"></label><div id="nwhores"></div>
      <label>Other persons involved <span class="opt">(not in the list, e.g. driver, client, supplier)</span><input name="others" maxlength="500" value="${esc(d.others || "")}"></label>
      <div class="two"><label>Date &amp; time of incident<input type="datetime-local" name="when" max="${nowLocal()}" value="${esc(d.when || "")}" required></label><label>Area of incident<input name="where" maxlength="200" value="${esc(d.where || "")}"></label></div>
      <fieldset class="fs"><legend>Nature of incident (check all that apply)</legend><div class="natgrid">${NATURE.map(([g, items]) => `<div><b class="s">${esc(g)}</b>${chk("nature", items, d.nature)}</div>`).join("")}</div></fieldset>
      <label>Concise / brief description of the incident<textarea name="desc" rows="6" maxlength="6000" required placeholder="What, when, where, who saw it, what was damaged">${esc(d.desc || "")}</textarea></label>
      <div class="two"><label>Witnesses<input name="wit" maxlength="500" value="${esc(d.wit || "")}"></label><label>Damage / loss in ₱ <span class="opt">(if any)</span><input type="number" name="dmg" min="0" step="0.01" value="${esc(d.dmg ?? "")}"></label></div>
      <label>Corrective action <span class="opt">(what should be done so it does not happen again)</span><textarea name="corr" rows="2" maxlength="2000">${esc(d.corr || "")}</textarea></label>
      <div class="two"><label>Responsible<input name="resp" maxlength="200" value="${esc(d.resp || "")}"></label><label>Target date of completion<input type="date" name="tgt" value="${esc(d.tgt || "")}"></label></div>`}
      <div class="btns"><button class="btn" type="button" id="nfiles">📎 Attach photos / documents</button><span class="s" id="nfcount">${(d.files || []).length ? `${d.files.length} file(s)` : ""}</span></div>
      ${!isIt && canCode ? `<div class="btns"><button class="btn" type="button" id="nai">✨ Find what applies in the Code (AI)</button><button class="btn" type="button" id="nadd">+ Add Code of Conduct violation</button></div>
      <p class="s">Optional. Mark a violation only when the Code of Conduct applies. Without one, HR records the IR status and closes it.</p>
      <div id="nchosen">${(d.offenses || []).map((o, i) => `<div class="card coc"><div class="s"><b>${esc(code(o))}</b> — ${esc(o.section_title)} <button class="link" type="button" data-rm="${i}">remove</button></div><p class="coct">${esc(o.text)}</p>${ladder(o.penalties, esc)}</div>`).join("")}</div>
      <div id="nai_out"></div>` : ""}
      <div class="eerr"></div><button class="btn primary block" type="submit">Submit report</button></form></div>`;
  const f = el.querySelector("#nf");
  const checked = (n) => [...f.querySelectorAll(`input[name=${n}]:checked`)].map((x) => x.value);
  const keep = () => Object.assign(d, isIt ? { assets: checked("asset"), itypes: checked("itype"), acc: f.acc.value, oth: f.oth.value, when: f.when.value, desc: f.desc.value }
    : { others: f.others.value, when: f.when.value, where: f.where.value, nature: checked("nature"), desc: f.desc.value, wit: f.wit.value, dmg: f.dmg.value, corr: f.corr.value, resp: f.resp.value, tgt: f.tgt.value });
  el.querySelector("#nback").onclick = back;
  el.querySelector("#nswitch").onclick = () => { keep(); d.kind = null; renderNew(el, ctx); };
  if (!isIt) {
    let t; const wres = el.querySelector("#nwhores");
    el.querySelector("#nwho").oninput = (e) => { d.emp = null; clearTimeout(t); t = setTimeout(async () => {
      if (!e.target.value.trim()) { wres.innerHTML = ""; return; }
      try { const ppl = await rpc("iaf_ir_people", { p_q: e.target.value.trim() });
        wres.innerHTML = `<div class="list pick">${ppl.map((p, i) => `<a class="row" href="javascript:void 0" data-p="${i}"><div class="grow"><div class="t">${esc(p.full_name)}</div><div class="s">${esc(p.employee_no || "")} · ${esc(p.company)}${p.dept ? " · " + esc(p.dept) : ""}${p.position ? " · " + esc(p.position) : ""}</div></div></a>`).join("") || '<div class="empty small">No one found.</div>'}</div>`;
        wres.querySelectorAll("[data-p]").forEach((a) => (a.onclick = () => { d.emp = ppl[Number(a.dataset.p)]; el.querySelector("#nwho").value = d.emp.full_name; wres.innerHTML = `<p class="s">✔ ${esc(d.emp.full_name)} · ${esc(d.emp.company)}${d.emp.dept ? " · " + esc(d.emp.dept) : ""}</p>`; }));
      } catch (x) { wres.innerHTML = errBox(x); } }, 300); };
  }
  el.querySelector("#nfiles").onclick = () => pick(async (file) => { (d.files ||= []).push(file); el.querySelector("#nfcount").textContent = `${d.files.length} file(s)`; }, toast, true);
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { keep(); d.offenses.splice(Number(b.dataset.rm), 1); renderNew(el, ctx); }));
  const nadd = el.querySelector("#nadd"); if (nadd) nadd.onclick = () => offensePicker(el.querySelector("#nai_out"), ctx, async (o) => { keep(); if (!d.offenses.some((x) => x.id === o.id)) d.offenses.push({ ...o, source: "filer" }); renderNew(el, ctx); });
  const nai = el.querySelector("#nai"); if (nai) nai.onclick = async () => {
    const out = el.querySelector("#nai_out");
    if (f.desc.value.trim().length < 20) { out.innerHTML = errBox(new Error("Describe what happened first (a few sentences).")); return; }
    nai.disabled = true; nai.textContent = "Reading the Code… (up to a minute)";
    try { const r = await fnCall("iaf-coc-ai", { incident: `${f.desc.value}${f.where.value ? `\nWhere: ${f.where.value}` : ""}${f.dmg.value ? `\nDamage: PHP ${f.dmg.value}` : ""}${f.wit.value ? `\nWitnesses: ${f.wit.value}` : ""}` }, 120000);
      d.ai = r; out.innerHTML = aiBlock(r, esc, [], false);
    } catch (x) { out.innerHTML = errBox(x); }
    nai.disabled = false; nai.textContent = "✨ Find what applies in the Code (AI)";
  };
  f.onsubmit = async (ev) => {
    ev.preventDefault(); keep(); const err = f.querySelector(".eerr"); err.innerHTML = ""; const btn = f.querySelector("button[type=submit]");
    if (!isIt && !d.emp && !d.others.trim()) { err.innerHTML = errBox(new Error("Choose the employee involved from the list, or write the names under Other persons.")); return; }
    if (!isIt && el.querySelector("#nwho").value.trim() && !d.emp) { err.innerHTML = errBox(new Error("Pick the employee from the list (or clear the name and use Other persons).")); return; }
    const picked = d.ai ? [...el.querySelectorAll("[data-pick]:checked")].map((c) => d.ai.matches[Number(c.dataset.pick)]).map((m) => ({ id: m.id, fit: m.fit, why: m.why, source: "ai" })) : [];
    const offs = [...(d.offenses || []).map((o) => ({ id: o.id, source: "filer" })), ...picked.filter((p) => !(d.offenses || []).some((o) => o.id === p.id))];
    const payload = isIt
      ? { kind: "it", incident_at: d.when ? new Date(d.when).toISOString() : null, description: d.desc, it: { assets: d.assets, types: d.itypes, account_spec: d.acc || null, others_spec: d.oth || null } }
      : { kind: "general", employee_id: d.emp?.id || null, persons_other: d.others || null, incident_at: d.when ? new Date(d.when).toISOString() : null, location: d.where || null, nature: d.nature,
          description: d.desc, witnesses: d.wit || null, damage: d.dmg === "" ? null : Number(d.dmg), corrective_action: d.corr || null, responsible: d.resp || null, target_date: d.tgt || null,
          offenses: offs, ai: d.ai ? { summary: d.ai.summary, questions: d.ai.questions } : null };
    btn.disabled = true; btn.textContent = "Submitting…";
    try {
      const id = await rpc("iaf_ir_file2", { p: payload });
      for (const file of d.files || []) { btn.textContent = `Uploading ${file.name}…`; try { await upload(rpc, id, "evidence", file); } catch (x) { toast(`${file.name} did not upload: ${x.message}`, true); } }
      toast("Report submitted ✔"); q.mode = null; q.draft = null; q.sel = id; q.box = "filed"; renderIr(el, ctx);
    } catch (x) { err.innerHTML = errBox(x); btn.disabled = false; btn.textContent = "Submit report"; }
  };
}

// HR setting: hours the employee has to explain
export async function irSettingsCard(box, companyId, { rpc, esc, toast, errBox }) {
  try {
    const s = await rpc("iaf_ir_settings_get", { p_company: companyId });
    box.innerHTML = `<h3>Incident reports</h3><form class="form" id="irs"><div class="two"><label>Hours the employee has to explain<input type="number" name="h" min="1" max="240" value="${esc(s.explain_hours)}"></label>
      <span class="s">Head of Plant Operation (signs decisions): <b>${esc(s.head || "none on the organizational chart")}</b></span></div><div class="eerr"></div><button class="btn" type="submit">Save</button></form>`;
    const f = box.querySelector("#irs");
    f.onsubmit = async (ev) => { ev.preventDefault(); try { await rpc("iaf_ir_settings_save", { p_company: companyId, p_hours: Number(f.h.value) }); toast("Saved ✔"); } catch (e) { f.querySelector(".eerr").innerHTML = errBox(e); } };
  } catch (e) { box.innerHTML = errBox(e); }
}
