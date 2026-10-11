// Code of Conduct guide (supervisors and up, HR, admin).
// Search the Code by words, or describe an incident and let the AI point to the offenses that may apply.
// Guide only: HR decides per the Code. The manager or Head of Plant Operation may recommend a lighter penalty.
// The offense count restarts every calendar year (records stay in the employee's file).
import { fnCall } from "./api.js";

const ORD = ["1st", "2nd", "3rd", "4th", "5th"];
const ROM = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
let st = { tab: "search", q: "", art: "", sec: "", incident: "", explanation: "", ai: null };

export async function renderCoc(el, ctx) {
  const { rpc, esc, toast, errBox } = ctx;
  let meta;
  try { meta = await rpc("iaf_coc_meta"); } catch (e) { el.innerHTML = errBox(e); return; }
  if (!meta.can_see) { el.innerHTML = `<div class="empty">The Code of Conduct guide is for supervisors and up.</div>`; return; }
  if (!meta.version) { el.innerHTML = `<div class="empty">No Code of Conduct loaded yet.</div>`; return; }
  const v = meta.version, arts = meta.articles || [];
  const reload = () => renderCoc(el, ctx);
  const secsOf = (a) => ((arts.find((x) => x.article === a) || {}).sections || []).sort((x, y) => ROM.indexOf(x.section) - ROM.indexOf(y.section));
  el.innerHTML = `<div class="card cochead"><div class="between"><div><h2 class="nm">${esc(v.title)}</h2>
      <p class="s">Effective ${esc(new Date(v.effective_on + "T00:00:00").toLocaleDateString("en-PH", { month: "long", year: "numeric" }))} · ${meta.total} offenses · reviewed by ${esc(v.reviewed_by || "")} · approved by ${esc(v.approved_by || "")}</p></div></div>
      <p class="s">A guide for leaders. HR decides the penalty per the Code. The manager or the Head of Plant Operation may recommend a lighter penalty. The offense count restarts every calendar year; past records stay in the file.</p>
      <div class="cotabs"><button class="cotab${st.tab === "search" ? " on" : ""}" data-tab="search">🔎 Search the Code</button><button class="cotab${st.tab === "ai" ? " on" : ""}" data-tab="ai">✨ Ask AI about an incident</button></div></div>
    <div id="cocbody"></div>`;
  el.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { st.tab = b.dataset.tab; reload(); }));
  const body = el.querySelector("#cocbody");
  if (st.tab === "ai") return aiTab(body, ctx, meta);

  body.innerHTML = `<div class="pfilters cocf"><input id="cq" type="search" placeholder="Search words, e.g. late, fight, phone, PPE, drunk" value="${esc(st.q)}">
      <select id="ca"><option value="">All articles</option>${arts.map((a) => `<option value="${esc(a.article)}" ${st.art === a.article ? "selected" : ""}>Art. ${esc(a.article)} — ${esc(cap(a.title))}</option>`).join("")}</select>
      <select id="cs" ${st.art ? "" : "disabled"}><option value="">All sections</option>${st.art ? secsOf(st.art).map((s) => `<option value="${esc(s.section)}" ${st.sec === s.section ? "selected" : ""}>Sec. ${esc(s.section)} — ${esc(s.title)}</option>`).join("") : ""}</select></div>
    <div id="cres">${'<div class="empty small">Loading…</div>'}</div>`;
  const run = async () => {
    const box = body.querySelector("#cres");
    try {
      const rows = await rpc("iaf_coc_search", { p_q: st.q || null, p_article: st.art || null, p_section: st.sec || null, p_ids: null });
      box.innerHTML = rows.length ? `<p class="s">${rows.length} offense${rows.length === 1 ? "" : "s"}${st.q ? ` matching “${esc(st.q)}”` : ""}</p>` + rows.map((o) => offenseCard(o, esc, meta.can_edit)).join("")
        : `<div class="empty">Nothing found for “${esc(st.q)}”. Try other words, or use <b>Ask AI</b> and describe what happened.</div>`;
      wireNotes(box, ctx, run);
    } catch (e) { box.innerHTML = errBox(e); }
  };
  let t; body.querySelector("#cq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); run(); }, 300); };
  body.querySelector("#ca").onchange = (e) => { clearTimeout(t); st.q = body.querySelector("#cq").value.trim(); st.art = e.target.value; st.sec = ""; reload(); };
  body.querySelector("#cs").onchange = (e) => { clearTimeout(t); st.q = body.querySelector("#cq").value.trim(); st.sec = e.target.value; run(); };
  run();
}

const cap = (s) => String(s || "").toLowerCase().replace(/(^|[\s(/&-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bIct\b/, "ICT").replace(/\b(And|Of|Against|With|The)\b/g, (w) => w.toLowerCase());
const hl = (s, esc) => esc(s).replace(/«/g, "<mark>").replace(/»/g, "</mark>");
export function ladder(p, esc) {
  return `<div class="ladder">${p.map((x, i) => x === "n/a" ? "" : `<span class="rung ${/Dismissal/.test(x) ? "dis" : /Warning/.test(x) ? "warn" : ""}"><small>${ORD[i]}</small>${esc(x.replace(" Suspension", " susp."))}</span>`).join("")}</div>`;
}
function offenseCard(o, esc, canEdit, extra = "") {
  return `<div class="card coc" data-id="${esc(o.id)}"><div class="s"><b>Art. ${esc(o.article)} · Sec. ${esc(o.section)} · ${esc(o.no)}</b> — ${esc(o.section_title)}</div>
    <p class="coct">${o.snippet ? hl(o.snippet, esc) : esc(o.text)}</p>${ladder(o.penalties, esc)}
    ${o.note ? `<div class="alert warn"><b>Note:</b> ${esc(o.note)}</div>` : ""}${extra}
    ${canEdit ? `<div class="btns only-desktop"><button class="link" data-note="${esc(o.id)}">${o.note ? "Edit note" : "Add note (HR)"}</button></div>` : ""}</div>`;
}
function wireNotes(box, { rpc, toast }, after) {
  box.querySelectorAll("[data-note]").forEach((b) => (b.onclick = async () => {
    const cur = b.closest(".coc").querySelector(".alert")?.textContent.replace(/^Note:\s*/, "") || "";
    const n = prompt("Note on this offense (for example a newer memo that changes it). Leave empty to remove.", cur);
    if (n === null) return;
    try { await rpc("iaf_coc_note_save", { p_id: b.dataset.note, p_note: n }); toast("Saved ✔"); after(); } catch (e) { toast(e.message, true); }
  }));
}

function aiTab(body, ctx, meta) {
  const { esc, errBox } = ctx;
  const r = st.ai;
  body.innerHTML = `<div class="card"><h3>Describe what happened</h3>
      <p class="s">Write the facts: what, when, where, who saw it, any damage or amount, how many times this month. The AI suggests which parts of the Code may apply. It does not decide.</p>
      <form class="form" id="aif"><label>Incident<textarea name="inc" rows="5" maxlength="6000" placeholder="e.g. On Oct 9 at 2 PM, a forklift operator drove the forklift fast inside the warehouse and hit a rack. Damage about ₱8,000. Two co-workers saw it.">${esc(st.incident)}</textarea></label>
      <label><span>Employee's written explanation <span class="opt">(optional)</span></span><textarea name="exp" rows="3" maxlength="6000">${esc(st.explanation)}</textarea></label>
      <div class="eerr"></div><button class="btn primary" type="submit">✨ Find what applies</button></form></div>
    <div id="aires">${r ? aiResult(r, esc, meta) : ""}</div>`;
  const f = body.querySelector("#aif");
  f.onsubmit = async (ev) => {
    ev.preventDefault(); const btn = f.querySelector("button"); f.querySelector(".eerr").innerHTML = "";
    st.incident = f.inc.value; st.explanation = f.exp.value;
    if (st.incident.trim().length < 15) { f.querySelector(".eerr").innerHTML = errBox(new Error("Describe what happened in a few sentences first.")); return; }
    btn.disabled = true; btn.textContent = "Reading the Code… (up to a minute)";
    try { st.ai = await fnCall("iaf-coc-ai", { incident: st.incident, explanation: st.explanation || null }, 120000);
      body.querySelector("#aires").innerHTML = aiResult(st.ai, esc, meta); }
    catch (e) { f.querySelector(".eerr").innerHTML = errBox(e); }
    btn.disabled = false; btn.textContent = "✨ Find what applies";
  };
}
function aiResult(r, esc, meta) {
  return `<div class="card"><h3>What the AI found</h3><p>${esc(r.summary || "")}</p>
      <p class="s">Guide only. HR decides per the Code. The manager or the Head of Plant Operation may recommend a lighter penalty. Count the employee's offenses of the same kind this calendar year to know which column applies.</p></div>
    ${(r.matches || []).map((o) => offenseCard(o, esc, false, `<div class="why"><span class="chip ${o.fit === "strong" ? "ok" : "mute"}">${o.fit === "strong" ? "Strong fit" : "Possible"}</span> ${esc(o.why)}</div>`)).join("") || `<div class="empty">No offense in the Code clearly fits.</div>`}
    ${(r.questions || []).length ? `<div class="card"><h3>Confirm before deciding</h3><ul class="warnlist">${r.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}
    ${(r.explanation_points || []).length ? `<div class="card"><h3>From the employee's explanation</h3><ul class="warnlist">${r.explanation_points.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}`;
}
