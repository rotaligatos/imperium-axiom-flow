// Policies & Memos library.
// - Everyone reads what reaches them (company-wide, their department, their access level).
// - HR, department heads (for their departments) and Head of Plant Operation and up (plant-wide) publish.
// - Upload first: the AI reads the memo and fills the form (topics with reasons, questions when unsure,
//   the memo it replaces, possible conflicts with company/HR policy, parts of the app it may change).
// - Built for hundreds of memos: search inside the memo text, filters, pages, detail beside the list.
import { storageUpload, storageBlob, fnCall, openStoredFile } from "./api.js";

const BUCKET = "iaf-memos", PAGE = 25;
const VIS = { everyone: "Everyone", supervisors: "Supervisors and up", hr: "HR only (confidential)" };
const ST = { active: "In force", superseded: "Replaced", retired: "Retired" };
const fmtD = (iso) => (iso ? new Date(String(iso).slice(0, 10) + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "");
let q = { search: "", topic: "", company: "", year: "", status: "active", offset: 0, sel: null, mode: null, draft: null };
const HKIND = { regular: "Regular holiday", special_non_working: "Special non-working", special_working: "Special working day", local: "Local holiday" };
// open one memo from another page (e.g. a holiday that came from a memo)
export function openMemo(id) { q.sel = id; q.status = "all"; q.mode = null; q.draft = null; location.hash = "#/policies"; }
let cache = { topics: null, opts: null };

export async function renderPolicies(el, ctx) {
  const { rpc, esc, toast, errBox } = ctx;
  try {
    if (!cache.topics) cache.topics = await rpc("iaf_policy_topics");
    if (!cache.opts) cache.opts = await rpc("iaf_policy_publish_options");
  } catch (e) { el.innerHTML = errBox(e); return; }
  const { topics, opts } = cache;
  const reload = () => renderPolicies(el, ctx);
  const yr = new Date().getFullYear();

  if (q.mode === "upload" || q.mode === "edit" || q.mode === "new") return renderForm(el, ctx, reload);

  let res, conflicts = 0;
  try {
    res = await rpc("iaf_policy_browse", { p_search: q.search || null, p_topic: q.topic || null, p_company: q.company || null, p_year: q.year ? Number(q.year) : null,
      p_status: q.status || "active", p_limit: PAGE, p_offset: q.offset, p_issuer: null });
    if (opts.hr) conflicts = (await rpc("iaf_policy_browse", { p_status: "conflict", p_limit: 1, p_offset: 0 }).catch(() => ({ total: 0 }))).total || 0;
  } catch (e) { el.innerHTML = errBox(e); return; }
  const rows = res.rows || [], total = res.total || 0;

  const chips = (ts) => (ts || []).map((t) => `<span class="chip tchip" title="${esc(t.reason || "")}">${esc(t.name)}</span>`).join(" ");
  const row = (d) => `<a class="row prow${q.sel === d.id ? " on" : ""}" href="javascript:void 0" data-sel="${esc(d.id)}"><div class="grow">
      <div class="t">${d.memo_no ? `<b>${esc(d.memo_no)}</b> · ` : ""}${esc(d.title)}</div>
      <div class="s">${esc(fmtD(d.issued_on))}${d.issued_on ? " · " : ""}${esc(d.issued_by)}${d.audience === "departments" ? ` → ${esc((d.audience_depts || []).join(", "))}` : ` · ${esc(d.company)}`}</div>
      <div class="tchips">${chips(d.topics)}${d.conflict_open ? ' <span class="chip bad">May conflict with company policy</span>' : ""}${d.status !== "active" ? ` <span class="chip mute">${ST[d.status]}</span>` : ""}${d.file_path ? "" : ' <span class="chip mute">no file</span>'}</div>
      ${d.snippet ? `<div class="snip">…${esc(d.snippet).replace(/«/g, "<mark>").replace(/»/g, "</mark>")}…</div>` : ""}</div></a>`;

  const filt = `<div class="card pfilters">
      <div class="pbar"><input id="psearch" type="search" placeholder="Search memo no., title or any word in the memo…" value="${esc(q.search)}">
        ${opts.can_publish ? `<span class="only-desktop"><button class="btn primary" id="pupload">⬆ Upload memo</button> <button class="btn" id="pnew">+ Without file</button></span>` : ""}</div>
      <div class="pbar sm">
        <select id="ptopic"><option value="">All topics</option>${topics.filter((t) => t.is_active).map((t) => `<option value="${esc(t.id)}" ${q.topic === t.id ? "selected" : ""}>${esc(t.name)} (${t.count})</option>`).join("")}</select>
        <select id="pco"><option value="">All companies</option>${(opts.companies || []).map((c) => `<option value="${esc(c.id)}" ${q.company === c.id ? "selected" : ""}>${esc(c.short_code)}</option>`).join("")}</select>
        <select id="pyear"><option value="">Any year</option>${Array.from({ length: 8 }, (_, i) => yr + 1 - i).map((y) => `<option ${String(y) === q.year ? "selected" : ""}>${y}</option>`).join("")}</select>
        <select id="pst"><option value="active" ${q.status === "active" ? "selected" : ""}>In force</option><option value="superseded" ${q.status === "superseded" ? "selected" : ""}>Replaced</option>
          <option value="retired" ${q.status === "retired" ? "selected" : ""}>Retired</option><option value="all" ${q.status === "all" ? "selected" : ""}>All</option>
          ${opts.hr ? `<option value="conflict" ${q.status === "conflict" ? "selected" : ""}>May conflict with company policy</option>` : ""}</select>
        ${q.search || q.topic || q.company || q.year || q.status !== "active" ? `<button class="link" id="pclear">Clear filters</button>` : ""}</div>
      ${opts.can_publish ? `<p class="s only-mobile">Uploading memos is done on a computer.</p>` : ""}
      ${conflicts && q.status !== "conflict" ? `<div class="alert bad">⚠ <b>${conflicts}</b> department memo${conflicts > 1 ? "s" : ""} may conflict with company policy. <button class="link" id="pconf">Review</button></div>` : ""}</div>`;
  const pager = total > PAGE ? `<div class="between pager"><span class="s">${q.offset + 1}–${Math.min(q.offset + PAGE, total)} of ${total}</span><span>
      <button class="btn sm" data-pg="-1" ${q.offset === 0 ? "disabled" : ""}>‹ Prev</button> <button class="btn sm" data-pg="1" ${q.offset + PAGE >= total ? "disabled" : ""}>Next ›</button></span></div>`
    : `<p class="s">${total} memo${total === 1 ? "" : "s"}</p>`;
  el.innerHTML = filt + `<div class="split ${q.sel ? "has-detail" : ""}"><section class="pane-list">${pager}<div class="list">${rows.length ? rows.map(row).join("") : `<div class="empty">No memos found.</div>`}</div>${total > PAGE ? pager : ""}</section>
    <section class="pane-detail" id="pdet">${q.sel ? `<div class="empty loading">Loading…</div>` : `<div class="empty">Select a memo to read it.</div>`}</section></div>`;

  let t; const s = el.querySelector("#psearch"); s.oninput = () => { clearTimeout(t); t = setTimeout(() => { q.search = s.value; q.offset = 0; q.focusSearch = true; reload(); }, 450); };
  if (q.focusSearch) { q.focusSearch = false; s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  const on = (id, fn) => { const x = el.querySelector(id); if (x) x.onchange = x.onclick = fn; };
  el.querySelector("#ptopic").onchange = (e) => { q.topic = e.target.value; q.offset = 0; reload(); };
  el.querySelector("#pco").onchange = (e) => { q.company = e.target.value; q.offset = 0; reload(); };
  el.querySelector("#pyear").onchange = (e) => { q.year = e.target.value; q.offset = 0; reload(); };
  el.querySelector("#pst").onchange = (e) => { q.status = e.target.value; q.offset = 0; reload(); };
  on("#pclear", () => { Object.assign(q, { search: "", topic: "", company: "", year: "", status: "active", offset: 0 }); reload(); });
  on("#pconf", () => { q.status = "conflict"; q.offset = 0; reload(); });
  on("#pupload", () => { q.mode = "upload"; q.draft = null; reload(); });
  on("#pnew", () => { q.mode = "new"; q.draft = {}; reload(); });
  el.querySelectorAll("[data-pg]").forEach((b) => (b.onclick = () => { q.offset = Math.max(0, q.offset + Number(b.dataset.pg) * PAGE); reload(); }));
  el.querySelectorAll("[data-sel]").forEach((a) => (a.onclick = () => { q.sel = a.dataset.sel; reload(); }));
  if (q.sel) renderDetail(el.querySelector("#pdet"), ctx, reload);
}

async function renderDetail(box, ctx, reload) {
  const { rpc, esc, toast, errBox } = ctx;
  let d; try { d = await rpc("iaf_policy_get", { p_id: q.sel }); } catch (e) { box.innerHTML = `<a class="back" href="javascript:void 0" data-back>‹ Back to list</a>` + errBox(e); box.querySelector("[data-back]").onclick = () => { q.sel = null; reload(); }; return; }
  const ai = d.ai_reading || {};
  box.innerHTML = `<a class="back" href="javascript:void 0" data-back>‹ Back to list</a><div class="card">
      <div class="between"><h2 class="nm">${esc(d.title)}</h2><span class="chip ${d.status === "active" ? "ok" : "mute"}">${ST[d.status]}</span></div>
      <dl>${d.memo_no ? `<dt>Memo no.</dt><dd>${esc(d.memo_no)}</dd>` : ""}${d.issued_on ? `<dt>Issued</dt><dd>${esc(fmtD(d.issued_on))}</dd>` : ""}${d.effective_on ? `<dt>Effective</dt><dd>${esc(fmtD(d.effective_on))}</dd>` : ""}
        <dt>Issued by</dt><dd>${esc(d.issued_by)}${d.signatories ? ` — ${esc(d.signatories)}` : ""}</dd>
        <dt>For</dt><dd>${d.audience === "departments" ? `${esc((d.audience_depts || []).join(", "))} (${esc(d.company)})` : d.company === "All companies" ? "All companies" : (d.company_ids || []).length > 1 ? `All employees of ${esc(d.company)}` : `Whole company (${esc(d.company)})`}${d.visibility !== "everyone" ? ` · ${esc(VIS[d.visibility])}` : ""}</dd>
        <dt>Topics</dt><dd>${(d.topics || []).map((t) => `<span class="chip tchip" title="${esc(t.reason || "")}">${esc(t.name)}</span>`).join(" ")}</dd>
        ${d.supersedes ? `<dt>Replaces</dt><dd><a href="javascript:void 0" data-go="${esc(d.supersedes.id)}">${esc(d.supersedes.memo_no || "")} ${esc(d.supersedes.title)}</a></dd>` : ""}
        ${d.replaced_by ? `<dt>Replaced by</dt><dd><a href="javascript:void 0" data-go="${esc(d.replaced_by.id)}">${esc(d.replaced_by.memo_no || "")} ${esc(d.replaced_by.title)}</a></dd>` : ""}</dl>
      ${d.summary ? `<p>${esc(d.summary)}</p>` : ""}
      <div class="btns">${d.file_path ? `<button class="btn primary" data-open="${esc(d.file_path)}">📄 Open ${esc(d.file_name || "memo")}</button>` : `<span class="s">No file attached.</span>`}
        ${d.full_text ? `<button class="btn" data-full>Show full text</button>` : ""}</div>
      <pre class="fulltext" hidden>${esc(d.full_text || "")}</pre></div>
    ${d.conflict_open || (ai.conflicts || []).length ? `<div class="card"><h3>${d.conflict_open ? "⚠ May conflict with company policy" : "Checked against company policy"}</h3>
      ${(ai.conflicts || []).map((c) => `<div class="alert ${d.conflict_open ? "bad" : "warn"}"><b>${esc(c.memo_no || "")} ${esc(c.title || "")}</b><br>${esc(c.issue || "")}</div>`).join("")}
      ${d.conflict_open ? `<p class="s">HR should talk with the issuing department and record what was agreed.</p>${ctx.state && cache.opts.hr ? `<div class="form"><label>What was agreed<textarea id="cnote" rows="2" maxlength="1000" placeholder="e.g. Department will follow HRMD-26-29; memo revised"></textarea></label><button class="btn" id="cres">Mark aligned with company policy</button></div>` : ""}`
        : d.conflict_note ? `<p class="s">HR: ${esc(d.conflict_note)}</p>` : ""}</div>` : ""}
    ${d.can_edit && (ai.app_impacts || []).length ? `<div class="card"><h3>May change how the app works</h3><p class="s">Read by the AI from this memo. Holidays go to the Holidays page (box below). Other setting changes are reviewed and approved by HR (coming in a later update).</p>
      ${(ai.app_impacts || []).map((x) => `<div class="impact"><b>${esc(x.area || "")}</b>: ${esc(x.proposed || "")}${x.current ? `<br><small>Now: ${esc(x.current)}</small>` : ""}${x.effective_on ? `<br><small>From ${esc(fmtD(x.effective_on))}</small>` : ""}</div>`).join("")}</div>` : ""}
    ${holidayCard(d, ai, esc)}
    ${d.can_edit ? `<div class="btns only-desktop"><button class="btn" data-edit>Edit</button><button class="btn" data-up>${d.file_path ? "Replace file" : "Attach file"}</button>${d.file_path ? `<button class="btn" data-aifill title="The AI reads the stored file and fills in missing details. You check before saving.">✨ Fill in from file</button>` : ""}
      ${d.status === "active" ? `<button class="btn" data-st="superseded">Mark replaced</button><button class="btn danger" data-st="retired">Retire</button>` : `<button class="btn" data-st="active">Bring back</button>`}</div>` : ""}`;
  box.querySelector("[data-back]").onclick = () => { q.sel = null; reload(); };
  box.querySelectorAll("[data-go]").forEach((a) => (a.onclick = () => { q.sel = a.dataset.go; q.status = "all"; reload(); }));
  const full = box.querySelector("[data-full]"); if (full) full.onclick = () => { const p = box.querySelector(".fulltext"); p.hidden = !p.hidden; full.textContent = p.hidden ? "Show full text" : "Hide full text"; };
  const op = box.querySelector("[data-open]"); if (op) op.onclick = async () => { op.disabled = true; try { await openStoredFile(BUCKET, op.dataset.open); } catch (x) { toast(x.message, true); } op.disabled = false; };
  box.querySelectorAll("[data-st]").forEach((b) => (b.onclick = async () => { if (b.dataset.st === "retired" && !confirm("Retire this memo? Employees will no longer see it.")) return; try { await rpc("iaf_policy_status", { p_id: d.id, p_status: b.dataset.st }); toast("Done ✔"); reload(); } catch (x) { toast(x.message, true); } }));
  const af = box.querySelector("[data-aifill]"); if (af) af.onclick = async () => {
    af.disabled = true; af.textContent = "Reading the memo… (up to a minute)";
    try {
      const blob = await storageBlob(BUCKET, d.file_path);
      const coId = d.company_id || cache.opts?.companies?.[0]?.id || null;
      const out = await fnCall("iaf-policy-ai", { file_base64: await toB64(blob), media_type: /\.pdf$/i.test(d.file_path) ? "application/pdf" : (blob.type || "image/jpeg"), file_name: d.file_name || d.file_path.split("/").pop(), company_id: coId, memo_id: d.id }, 150000);
      q.mode = "edit"; q.draft = mergeReading(d, out.reading); reload();
    } catch (x) { toast(x.message, true); af.disabled = false; af.textContent = "✨ Fill in from file"; }
  };
  const ed = box.querySelector("[data-edit]"); if (ed) ed.onclick = () => { q.mode = "edit"; q.draft = d; reload(); };
  const up = box.querySelector("[data-up]"); if (up) up.onclick = () => pickFile(async (f) => { await uploadFile(rpc, d.id, f); toast("File saved ✔"); reload(); }, toast);
  wireHolidayCard(box, d, ai, ctx, reload);
  const cr = box.querySelector("#cres"); if (cr) cr.onclick = async () => { try { await rpc("iaf_policy_conflict_resolve", { p_id: d.id, p_note: box.querySelector("#cnote").value }); toast("Marked aligned ✔"); reload(); } catch (x) { toast(x.message, true); } };
}

function pickFile(onFile, toast) {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf,image/*";
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { await onFile(f); } catch (x) { toast(x.message, true); } };
  inp.click();
}
async function uploadFile(rpc, id, f) {
  if (f.size > 15 * 1024 * 1024) throw new Error("File is too big (15 MB max).");
  const path = `${id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
  await storageUpload(BUCKET, path, f); await rpc("iaf_policy_file_set", { p_id: id, p_path: path, p_name: f.name, p_size: f.size });
}
const toB64 = (f) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = () => bad(new Error("Could not read the file.")); r.readAsDataURL(f); });

// ---------- upload / add / edit ----------
async function renderForm(el, ctx, reload) {
  const { rpc, esc, toast, errBox } = ctx;
  const { topics, opts } = cache;
  const cancel = () => { q.mode = null; q.draft = null; reload(); };
  const myCos = opts.companies || [];
  // step 1 of upload: pick the file, AI reads it
  if (q.mode === "upload" && !q.draft) {
    el.innerHTML = `<div class="card only-desktop"><h3>Upload a memo</h3>
        <p class="s">Choose the memo (PDF or a clear photo). The AI reads it and fills in the details, the topics it belongs to, and whether it replaces an earlier memo${opts.hr ? "" : " or may conflict with company (HR) policy"}. You check everything before saving.</p>
        <div class="form"><div class="two"><label>Company<select id="uco">${myCos.map((c) => `<option value="${esc(c.id)}">${esc(c.short_code)}</option>`).join("")}</select></label>
          <label>Memo file<input type="file" id="ufile" accept="application/pdf,image/*"></label></div>
          <div class="eerr"></div><div class="btns"><button class="btn primary" id="uread" disabled>Read with AI</button><button class="btn" id="umanual">Fill in by hand</button><button class="btn" id="ucancel">Cancel</button></div></div></div>
      <div class="only-mobile"><p class="s">Uploading memos is done on a computer.</p><button class="btn" id="ucancel2">Back</button></div>`;
    const file = el.querySelector("#ufile"), read = el.querySelector("#uread");
    file.onchange = () => (read.disabled = !file.files[0]);
    el.querySelector("#ucancel").onclick = cancel; el.querySelector("#ucancel2").onclick = cancel;
    el.querySelector("#umanual").onclick = () => { q.draft = { company_id: el.querySelector("#uco").value, _file: file.files[0] || null }; reload(); };
    read.onclick = async () => {
      const f = file.files[0]; if (!f) return; const err = el.querySelector(".eerr"); err.innerHTML = "";
      if (f.size > 15 * 1024 * 1024) { err.innerHTML = errBox(new Error("File is too big (15 MB max).")); return; }
      read.disabled = true; read.textContent = "Reading the memo… (this can take up to a minute)";
      try {
        const out = await fnCall("iaf-policy-ai", { file_base64: await toB64(f), media_type: f.type || "application/pdf", file_name: f.name, company_id: el.querySelector("#uco").value }, 150000);
        q.draft = fromReading(out.reading, el.querySelector("#uco").value); q.draft._file = f; reload();
      } catch (x) { err.innerHTML = errBox(x) + `<p class="s">You can still <b>Fill in by hand</b>.</p>`; read.disabled = false; read.textContent = "Read with AI"; }
    };
    return;
  }
  const d = q.draft || {};
  const ai = d._ai || null;
  const someIds = new Set((d.company_ids || []).map(String));
  let coId = opts.hr && myCos.length > 1 && someIds.size > 1 ? "some" : d.company_id === null ? "" : d.company_id || myCos[0]?.id || "";
  if (!opts.hr && (!coId || !myCos.some((c) => c.id === coId))) coId = myCos[0]?.id || "";
  const isSome = coId === "some";
  const coOpt = (id) => myCos.find((c) => c.id === id);
  const deptsOf = (cid) => (opts.departments || []).filter((x) => x.company_id === cid && (opts.hr || x.mine || coOpt(cid)?.plantwide));
  const topicSel = new Map((d.topics || []).map((t) => [t.id, t]));
  const aiTopic = new Map(((ai && ai.topics) || []).map((t) => [t.id, t]));
  const audDepts = new Set((d.audience_dept_ids || []).map(String));
  let index = []; try { index = await rpc("iaf_policy_index"); } catch {}
  const sup = d.supersedes_id || "";
  const canPlant = (cid) => opts.hr || !!coOpt(cid)?.plantwide;
  const holItems = opts.hr && ai ? holidayItems(ai, myCos) : [];
  const aud = coId === "some" ? "all" : d.audience || (canPlant(coId) ? "all" : "departments");
  const file0 = d._file || null;

  el.innerHTML = `<div class="card only-desktop"><div class="between"><h3>${q.mode === "edit" ? "Edit memo" : ai ? "Check what the AI read" : "Add a memo"}</h3>${d._file ? `<span class="s">File: ${esc(d._file.name)}</span>` : ""}</div>
    ${ai ? `<p class="s">Filled in by the AI from the memo. Please check every field before saving.</p>` : ""}
    ${ai && (d._diffs || []).length ? `<div class="alert warn"><b>The AI read something different from what is saved.</b> Choose which one to keep:
      <table class="difft">${d._diffs.map((x, i) => `<tr><th>${esc(x.label)}</th><td><small>Saved</small><br>${esc(x.saved)}</td><td><small>AI read</small><br>${esc(x.ai)}</td><td><button type="button" class="btn" data-useai="${i}">Use AI's</button></td></tr>`).join("")}</table></div>` : ""}
    ${ai && (file0 || d.file_path) ? `<div class="alert ${((ai.questions || []).length) ? "warn" : ""} askai">${(ai.questions || []).length ? `<b>The AI is not sure about these. Answer what you know, then press Ask again:</b>` : `<b>Something wrong?</b> Tell the AI and press Ask again.`}
      ${(ai.questions || []).map((x, i) => `<label class="aq"><span>${esc(x)}</span><input data-ans="${i}" maxlength="1000" placeholder="Your answer" value="${esc((d._answers || {})[x] || "")}"></label>`).join("")}
      <label class="aq"><span>Anything else the AI got wrong?</span><textarea id="ainote" rows="2" maxlength="2000" placeholder="e.g. This memo is for WCLI and CWLI. Issued Sept 3, 2026.">${esc(d._note || "")}</textarea></label>
      <div class="btns"><button type="button" class="btn primary" id="askagain">Ask again</button></div></div>` : ""}
    ${ai && (ai.conflicts || []).length ? `<div class="alert bad"><b>⚠ This memo may conflict with company (HR) policy:</b><ul class="warnlist">${ai.conflicts.map((c) => `<li><b>${esc(c.memo_no || "")} ${esc(c.title || "")}</b> — ${esc(c.issue || "")}</li>`).join("")}</ul>
      Please consult HR for alignment before publishing. If you publish now, HR is notified to review it.</div>` : ""}
    <form class="form" id="mform">
      <div class="two"><label>Memo no.<input name="memo" maxlength="60" value="${esc(d.memo_no || "")}"></label><label>Title<input name="ttl" maxlength="200" required value="${esc(d.title || "")}"></label></div>
      <div class="two"><label>Date issued<input type="date" name="ion" value="${esc(d.issued_on || "")}"></label><label>Takes effect<input type="date" name="eff" value="${esc(d.effective_on || "")}"></label></div>
      <div class="two"><label>Company<select name="co">${opts.hr ? `<option value="" ${coId === "" ? "selected" : ""}>All companies</option>` : ""}${myCos.map((c) => `<option value="${esc(c.id)}" ${coId === c.id ? "selected" : ""}>${esc(c.short_code)}</option>`).join("")}${opts.hr && myCos.length > 2 ? `<option value="some" ${isSome ? "selected" : ""}>Some companies…</option>` : ""}</select>
          ${isSome ? `<span class="cochecks">${myCos.map((c) => `<label class="check"><input type="checkbox" name="cos" value="${esc(c.id)}" ${someIds.has(c.id) ? "checked" : ""}><span>${esc(c.short_code)}</span></label>`).join("")}</span>` : ""}</label>
        <label>Issued by<select name="iss"><option value="">HR / Management</option>${(opts.departments || []).filter((x) => !isSome && (!coId || x.company_id === coId) && (opts.hr || x.mine || canPlant(x.company_id))).map((x) => `<option value="${esc(x.id)}" ${d.issued_by_dept_id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label></div>
      <label>Signed / noted by<input name="sig" maxlength="300" value="${esc(d.signatories || "")}"></label>
      <fieldset class="fs"><legend>Who is the memo for?</legend>
        <label class="check"><input type="radio" name="aud" value="all" ${aud === "all" ? "checked" : ""} ${canPlant(coId) ? "" : "disabled"}><span>${isSome ? "All employees of the ticked companies" : coId ? "Whole company (plant-wide)" : "All companies"}${canPlant(coId) ? "" : " <small>(HR or Head of Plant Operation only)</small>"}</span></label>
        <label class="check"><input type="radio" name="aud" value="departments" ${aud === "departments" && !isSome ? "checked" : ""} ${coId && !isSome ? "" : "disabled"}><span>Only these departments:</span></label>
        <div class="deptgrid">${isSome ? "<small>A memo for several companies goes to all their employees.</small>" : coId ? deptsOf(coId).map((x) => `<label class="check"><input type="checkbox" name="dept" value="${esc(x.id)}" ${audDepts.has(x.id) ? "checked" : ""}><span>${esc(x.name)}</span></label>`).join("") || "<small>No departments you can publish for.</small>" : "<small>Choose a company first.</small>"}</div>
        ${ai && (ai.applies_to?.unmatched_departments || []).length ? `<small>The memo mentions: ${esc(ai.applies_to.unmatched_departments.join(", "))} — not found as departments; tick the right ones.</small>` : ""}</fieldset>
      <label>Who can read it<select name="vis">${Object.entries(VIS).filter(([k]) => k !== "hr" || opts.hr).map(([k, v]) => `<option value="${k}" ${(d.visibility || "everyone") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <fieldset class="fs"><legend>Topics (tick all that apply)</legend><div class="topicgrid">
        ${topics.filter((t) => t.is_active).map((t) => { const a = aiTopic.get(t.id), on = topicSel.has(t.id) || (a && a.confident);
          return `<label class="check tpick${a && !a.confident ? " unsure" : ""}"><input type="checkbox" name="topic" value="${esc(t.id)}" ${on ? "checked" : ""}><span>${esc(t.name)}${a ? `<small>${a.confident ? "AI" : "AI is not sure — is it about this?"}: ${esc(a.reason)}</small>` : ""}</span></label>`; }).join("")}
        </div>${ai && (ai.new_topics || []).length ? `<div class="s">The AI suggests a new topic: ${ai.new_topics.map((n) => `<b>${esc(n.name)}</b>${opts.hr ? ` <button type="button" class="link" data-newtopic="${esc(n.name)}">Add it</button>` : ""}`).join(", ")}${opts.hr ? "" : " (HR can add new topics)"}</div>` : ""}</fieldset>
      <label>Replaces an earlier memo<select name="sup"><option value="">— none —</option>${index.filter((m) => m.id !== d.id).map((m) => `<option value="${esc(m.id)}" ${sup === m.id ? "selected" : ""}>${esc(m.memo_no || "")} ${esc(m.title)} ${m.status !== "active" ? `(${ST[m.status]})` : ""}</option>`).join("")}</select>
        ${ai && ai.supersedes ? `<small>AI: ${ai.supersedes.id ? "" : `mentions ${esc(ai.supersedes.memo_no)} (not on file). `}${esc(ai.supersedes.reason || "")}</small>` : ""}</label>
      <label>Summary (what employees need to know)<textarea name="sum" rows="4" maxlength="4000">${esc(d.summary || "")}</textarea></label>
      <details><summary>Full text of the memo (used for search)</summary><textarea name="full" rows="10" maxlength="60000">${esc(d.full_text || "")}</textarea></details>
      ${!d._file && q.mode !== "edit" ? `<label>Memo file (optional)<input type="file" name="file" accept="application/pdf,image/*"></label>` : ""}
      ${ai && (ai.app_impacts || []).length ? `<div class="alert"><b>This memo may change how the app works:</b><ul class="warnlist">${ai.app_impacts.map((x) => `<li><b>${esc(x.area || "")}</b>: ${esc(x.proposed || "")}${x.current ? ` <small>(now: ${esc(x.current)})</small>` : ""}</li>`).join("")}</ul><small>Saved with the memo.${holItems.length ? " Holidays are handled in the box below." : ""}</small></div>` : ""}
      ${holItems.length ? `<fieldset class="fs"><legend>Holidays in this memo</legend><p class="s">Ticked days are sent to the Holidays page as <b>proposed</b> when you save. Confirm them there to make them count.</p>
        ${holItems.map((h, i) => `<label class="check"><input type="checkbox" name="hol" value="${i}" ${h.action === "add" && !h.exists ? "checked" : ""} ${h.action === "add" ? "" : "disabled"}><span><b>${esc(fmtD(h.date))}</b> — ${esc(h.name)} <span class="chip">${esc(HKIND[h.kind] || h.kind)}</span> <span class="chip">${esc(h.company)}</span>${h.action === "cancel" ? " <small>The memo cancels / moves this day: remove it on the Holidays page.</small>" : ""}${h.note ? `<br><small>${esc(h.note)}</small>` : ""}</span></label>`).join("")}</fieldset>` : ""}
      <div class="eerr"></div>
      <div class="btns"><button class="btn primary" type="submit">${ai && (ai.conflicts || []).length && !opts.hr ? "Publish (HR will review)" : "Save memo"}</button><button class="btn" type="button" id="mcancel">Cancel</button></div></form></div>
    <div class="only-mobile"><p class="s">Memos are uploaded and edited on a computer.</p></div>`;

  const f = el.querySelector("#mform");
  el.querySelector("#mcancel").onclick = cancel;
  const keep = () => { q.draft = { ...d, ...collect(), _file: d._file || f.file?.files?.[0] || null, _ai: ai }; };
  f.co.onchange = () => { keep(); const v = f.co.value; q.draft.company_id = v === "" || v === "some" ? null : v; q.draft.company_ids = v === "some" ? (q.draft.company_ids?.length > 1 ? q.draft.company_ids : myCos.map((c) => c.id)) : []; q.draft.audience_dept_ids = []; if (v === "some") q.draft.audience = "all"; reload(); };
  const FIELD = { memo_no: "memo", title: "ttl", issued_on: "ion", effective_on: "eff", signatories: "sig", summary: "sum" };
  el.querySelectorAll("[data-useai]").forEach((b) => (b.onclick = () => { const x = d._diffs[Number(b.dataset.useai)]; f.elements[FIELD[x.k]].value = x.ai; b.closest("tr").remove(); }));
  const ask = el.querySelector("#askagain"); if (ask) ask.onclick = async () => {
    const qs = (ai.questions || []), answers = qs.map((x, i) => ({ question: x, answer: el.querySelector(`[data-ans="${i}"]`).value })).filter((a) => a.answer.trim());
    const note = el.querySelector("#ainote").value;
    if (!answers.length && !note.trim()) { toast("Answer a question or write what the AI got wrong first.", true); return; }
    ask.disabled = true; ask.textContent = "Reading again… (up to a minute)";
    try {
      const blob = file0 || await storageBlob(BUCKET, d.file_path);
      const name = file0 ? file0.name : (d.file_name || d.file_path.split("/").pop());
      const mt = /\.pdf$/i.test(name) ? "application/pdf" : (blob.type || "image/jpeg");
      const coId2 = f.co.value || myCos[0]?.id || null;
      const out = await fnCall("iaf-policy-ai", { file_base64: await toB64(blob), media_type: mt, file_name: name, company_id: coId2, memo_id: d.id || undefined, answers, note }, 150000);
      keep(); const prevAns = { ...(d._answers || {}) }; answers.forEach((a) => (prevAns[a.question] = a.answer));
      q.draft = mergeReading(q.draft, out.reading); q.draft._answers = prevAns; q.draft._note = note; q.draft._file = file0;
      toast("The AI read it again ✔ Check the highlighted parts."); reload();
    } catch (x) { toast(x.message, true); ask.disabled = false; ask.textContent = "Ask again"; }
  };
  el.querySelectorAll("[data-newtopic]").forEach((b) => (b.onclick = async () => { try { await rpc("iaf_policy_topic_save", { p_id: null, p_name: b.dataset.newtopic, p_description: null, p_active: true }); cache.topics = null; keep(); toast("Topic added ✔"); reload(); } catch (x) { toast(x.message, true); } }));
  function collect() {
    const tIds = [...f.querySelectorAll("input[name=topic]:checked")].map((i) => i.value);
    return { memo_no: f.memo.value, title: f.elements.ttl.value, issued_on: f.elements.ion.value || null, effective_on: f.eff.value || null, issued_by_dept_id: f.iss.value || null,
      signatories: f.sig.value, audience: (f.querySelector("input[name=aud]:checked") || {}).value || "all", audience_dept_ids: [...f.querySelectorAll("input[name=dept]:checked")].map((i) => i.value),
      visibility: f.vis.value, topics: tIds.map((id) => ({ id })), supersedes_id: f.sup.value || null, summary: f.sum.value, full_text: f.full.value,
      company_ids: f.co.value === "some" ? [...f.querySelectorAll("input[name=cos]:checked")].map((i) => i.value) : [] };
  }
  f.onsubmit = async (ev) => {
    ev.preventDefault(); const err = f.querySelector(".eerr"); err.innerHTML = ""; const btn = f.querySelector("button[type=submit]");
    const v = collect(); const file = d._file || f.file?.files?.[0] || null;
    if (!v.topics.length) { err.innerHTML = errBox(new Error("Tick at least one topic.")); return; }
    if (v.audience === "departments" && !v.audience_dept_ids.length) { err.innerHTML = errBox(new Error("Tick the department(s) the memo is for.")); return; }
    if (file && file.size > 15 * 1024 * 1024) { err.innerHTML = errBox(new Error("File is too big (15 MB max).")); return; }
    const some = f.co.value === "some";
    if (some && v.company_ids.length < 2) { err.innerHTML = errBox(new Error("Tick at least 2 companies (or choose one company).")); return; }
    btn.disabled = true; btn.textContent = "Saving…";
    const topicsOut = v.topics.map((t) => { const a = aiTopic.get(t.id); return { id: t.id, source: a ? "ai" : "hr", reason: a?.reason || null }; });
    const reading = ai ? { ...ai, full_text: undefined } : null;
    try {
      const id = await rpc("iaf_policy_save2", { p_id: q.mode === "edit" ? d.id : null, p_company: some ? null : f.co.value || null, p_memo_no: v.memo_no, p_title: v.title, p_issued_on: v.issued_on, p_effective_on: v.effective_on,
        p_signatories: v.signatories, p_summary: v.summary, p_visibility: v.visibility, p_topics: topicsOut, p_supersedes: v.supersedes_id, p_full_text: v.full_text || null,
        p_ai_reading: reading, p_issued_by_dept: v.issued_by_dept_id, p_audience: v.audience, p_depts: v.audience === "departments" ? v.audience_dept_ids : [] });
      if (opts.hr && (some || (d.company_ids || []).length)) await rpc("iaf_policy_companies_set", { p_id: id, p_companies: some ? v.company_ids : (f.co.value ? [f.co.value] : []) });
      let holMsg = "";
      const holPick = [...f.querySelectorAll("input[name=hol]:checked")].map((i) => holItems[Number(i.value)]);
      if (holPick.length) {
        try { const r = await rpc("iaf_holiday_from_memo", { p_memo: id, p_items: holPick.map((h) => ({ date: h.date, name: h.name, kind: h.kind, company_id: h.company_id, note: h.note })) });
          holMsg = r.added ? ` ${r.added} holiday day(s) sent to the Holidays page — confirm them there.` : " The holidays were already on the Holidays page."; }
        catch (x) { holMsg = " Holidays were not added (" + x.message + ")."; }
      }
      let fileErr = null;
      if (file) { btn.textContent = "Uploading the file…"; try { await uploadFile(rpc, id, file); } catch (x) { fileErr = x; } }
      cache.topics = null; q.mode = null; q.draft = null; q.sel = id; q.status = "all";
      if (fileErr) toast("Memo saved, but the file did not upload (" + fileErr.message + "). Press “Attach file” on the memo to try again.", true);
      else toast((ai && (ai.conflicts || []).length && !opts.hr ? "Published ✔ HR will review the possible conflict" : "Saved ✔") + holMsg);
      reload();
    } catch (x) { err.innerHTML = errBox(x); btn.disabled = false; btn.textContent = "Save memo"; }
  };
}

// AI reading over an existing memo: the AI fills empty fields; what was typed by hand stays. Topics: keep existing + add confident AI ones.
function mergeReading(d, r) {
  const a = fromReading(r, d.company_id), out = { ...d, _ai: r };
  const empty = (v) => v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
  const LBL = { memo_no: "Memo no.", title: "Title", issued_on: "Date issued", effective_on: "Takes effect", signatories: "Signed / noted by", summary: "Summary" };
  out._diffs = [];
  for (const k of ["memo_no", "title", "issued_on", "effective_on", "signatories", "summary", "full_text", "issued_by_dept_id", "supersedes_id"]) {
    if (empty(out[k]) && !empty(a[k])) out[k] = a[k];
    else if (LBL[k] && !empty(a[k]) && String(out[k]).trim().toLowerCase() !== String(a[k]).trim().toLowerCase()) out._diffs.push({ k, label: LBL[k], saved: String(out[k]), ai: String(a[k]) });
  }
  if (empty(d.audience_dept_ids) && !empty(a.audience_dept_ids) && d.company_id) { out.audience = a.audience; out.audience_dept_ids = a.audience_dept_ids; }
  if (!(d.company_ids || []).length && (a.company_ids || []).length > 1 && !d.id) { out.company_ids = a.company_ids; out.company_id = null; }
  const ids = new Set((d.topics || []).map((t) => t.id)); out.topics = [...(d.topics || []), ...a.topics.filter((t) => !ids.has(t.id))];
  return out;
}
// AI reading -> form draft
function fromReading(r, coId) {
  const ids = r.applies_to?.company_ids || [];
  const co = r.applies_to?.all_companies ? null : (ids.length === 1 ? ids[0] : ids.length > 1 ? null : coId);
  return { company_ids: !r.applies_to?.all_companies && ids.length > 1 ? ids : [], memo_no: r.memo_no, title: r.title, issued_on: r.issued_on, effective_on: r.effective_on, signatories: r.signatories, summary: r.summary, full_text: r.full_text,
    company_id: co, issued_by_dept_id: r.issuer?.is_hr ? null : r.issuer?.dept_id || null, audience: r.applies_to?.audience || "all",
    audience_dept_ids: (r.applies_to?.departments || []).map((x) => x.id), visibility: r.visibility || "everyone",
    topics: (r.topics || []).filter((t) => t.confident).map((t) => ({ id: t.id })), supersedes_id: r.supersedes?.id || null, _ai: r };
}

// AI holidays -> one line per day and company (only companies HR handles)
function holidayItems(ai, myCos, existing = []) {
  const out = [];
  for (const h of ai.holidays || []) for (const cid of h.company_ids || []) {
    const c = myCos.find((x) => x.id === cid); if (!c) continue;
    out.push({ ...h, company_id: cid, company: c.short_code, exists: existing.some((e) => e.company_id === cid && e.date === h.date) });
  }
  return out.sort((a, b) => (a.date + a.company).localeCompare(b.date + b.company));
}

// ---------- holidays declared by a memo (HR) ----------
function memoHolidayTalk(ai) {
  return (ai.holidays || []).length || (ai.app_impacts || []).some((x) => /holiday|non-working/i.test(`${x.area} ${x.proposed}`));
}
function holidayCard(d, ai, esc) {
  const hr = !!cache.opts?.hr, have = d.holidays || [];
  if (!hr && !have.length) return "";
  const myCos = (cache.opts?.companies || []);
  const pending = hr ? holidayItems(ai, myCos, have).filter((h) => h.action === "add" && !h.exists) : [];
  const talk = memoHolidayTalk(ai) || have.length;
  const coTicks = myCos.map((c) => `<label class="check"><input type="checkbox" name="hco" value="${esc(c.id)}" ${(d.company_ids || []).includes(c.id) || d.company_id === c.id || (!d.company_id && !(d.company_ids || []).length) ? "checked" : ""}><span>${esc(c.short_code)}</span></label>`).join("");
  const form = `<form class="form" id="hmform"><div class="two"><label>From<input type="date" name="from" required value="${esc(d.effective_on || "")}"></label><label>To (same day if one day)<input type="date" name="to"></label></div>
        <div class="two"><label>Name<input name="name" maxlength="120" required placeholder="e.g. ASEAN Summit (NCR)"></label><label>Type<select name="kind">${Object.entries(HKIND).map(([k, v]) => `<option value="${k}" ${k === "special_non_working" ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
        <div class="cochecks"><span class="s">For:</span> ${coTicks}</div><div class="eerr"></div>
        <button class="btn" type="submit">Send to the Holidays page</button></form>`;
  const manual = hr ? `<details ${talk && !pending.length && !have.length ? "open" : ""}><summary>${have.length || pending.length ? "Add other days by hand" : "Add the holiday days of this memo"}</summary>${form}</details>` : "";
  if (!talk && hr) return `<div class="card only-desktop"><details><summary>Does this memo declare a holiday?</summary>${form}</details></div>`;
  return `<div class="card" id="memohol"><h3>🎌 Holidays from this memo</h3>
    ${have.length ? `<div class="hlist">${have.map((h) => `<div class="row"><span><b>${esc(fmtD(h.date))}</b> — ${esc(h.name)} <span class="chip">${esc(HKIND[h.kind] || h.kind)}</span> <span class="chip">${esc(h.company)}</span></span><span class="chip ${h.status === "active" ? "ok" : h.status === "proposed" ? "warn" : "mute"}">${h.status === "active" ? "On the calendar" : h.status === "proposed" ? "Waiting for HR to confirm" : "Dismissed"}</span></div>`).join("")}</div>
      ${hr && have.some((h) => h.status === "proposed") ? `<p class="s">Confirm them on the <a href="#/holidays">Holidays page</a> so they count (leave days, schedules).</p>` : ""}` : hr ? `<p class="s">Not on the Holidays page yet.</p>` : ""}
    ${pending.length ? `<div class="only-desktop"><p class="s">The AI found these days in the memo. Tick the ones to send to the Holidays page (as proposed):</p>
      ${pending.map((h, i) => `<label class="check"><input type="checkbox" name="hp" value="${i}" checked><span><b>${esc(fmtD(h.date))}</b> — ${esc(h.name)} <span class="chip">${esc(HKIND[h.kind] || h.kind)}</span> <span class="chip">${esc(h.company)}</span></span></label>`).join("")}
      <div class="btns"><button class="btn primary" id="hpadd">Send to the Holidays page</button></div></div>` : ""}
    ${(ai.holidays || []).some((h) => h.action === "cancel") ? `<div class="alert warn">The memo cancels or moves: ${(ai.holidays || []).filter((h) => h.action === "cancel").map((h) => `${esc(fmtD(h.date))} ${esc(h.name)}`).join(", ")}. Remove or dismiss it on the <a href="#/holidays">Holidays page</a>.</div>` : ""}
    <div class="only-desktop">${manual}</div></div>`;
}
function wireHolidayCard(box, d, ai, ctx, reload) {
  const { rpc, toast } = ctx;
  const card = box.querySelector("#memohol") || box; const myCos = cache.opts?.companies || [];
  const send = async (items, btn) => {
    if (!items.length) { toast("Tick at least one day.", true); return; }
    if (btn) btn.disabled = true;
    try {
      const r = await rpc("iaf_holiday_from_memo", { p_memo: d.id, p_items: items });
      toast(r.added ? `${r.added} day(s) sent ✔ Confirm them on the Holidays page.${r.skipped ? ` ${r.skipped} already had a holiday.` : ""}` : "Already on the Holidays page — nothing new.", !r.added);
      reload();
    } catch (x) { toast(x.message, true); if (btn) btn.disabled = false; }
  };
  const add = card.querySelector("#hpadd");
  if (add) add.onclick = () => {
    const pending = holidayItems(ai, myCos, d.holidays || []).filter((h) => h.action === "add" && !h.exists);
    const pick = [...card.querySelectorAll("input[name=hp]:checked")].map((i) => pending[Number(i.value)]);
    send(pick.map((h) => ({ date: h.date, name: h.name, kind: h.kind, company_id: h.company_id, note: h.note })), add);
  };
  const mf = box.querySelector("#hmform");
  if (mf) mf.onsubmit = (ev) => {
    ev.preventDefault(); const err = mf.querySelector(".eerr"); err.innerHTML = "";
    const from = mf.from.value, to = mf.to.value || from, cos = [...mf.querySelectorAll("input[name=hco]:checked")].map((i) => i.value);
    if (!from || to < from) { err.innerHTML = ctx.errBox(new Error("Check the dates: To must be on or after From.")); return; }
    if (!cos.length) { err.innerHTML = ctx.errBox(new Error("Tick at least one company.")); return; }
    const days = []; for (let t = new Date(from + "T00:00:00"); ; t.setDate(t.getDate() + 1)) { const k = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; if (k > to) break; days.push(k); if (days.length > 31) break; }
    if (days.length > 31) { err.innerHTML = ctx.errBox(new Error("31 days at most at a time.")); return; }
    send(days.flatMap((day) => cos.map((c) => ({ date: day, name: mf.name.value, kind: mf.kind.value, company_id: c }))), mf.querySelector("button[type=submit]"));
  };
}
