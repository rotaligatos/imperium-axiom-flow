// Policies & Memos library. Everyone reads what their visibility allows; HR / administrator manage it (desktop only).
import { storageUpload, storageBlob } from "./api.js";
const CATS = ["Leave", "Attendance", "Conduct", "Payroll", "Safety", "General"];
const VIS = { everyone: "Everyone", supervisors: "Supervisors and up", hr: "HR only (confidential)" };
const ST = { active: "In force", superseded: "Replaced", retired: "Retired" };
const BUCKET = "iaf-memos";
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "");
let q = { search: "", cat: "", edit: null };

export async function renderPolicies(el, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  const manage = !!(state.canPeople || state.isAdmin);
  let list, companies = [];
  try { list = await rpc("iaf_policy_list", { p_search: q.search || null, p_category: q.cat || null }); if (manage) companies = await rpc("iaf_my_companies").catch(() => []); } catch (e) { el.innerHTML = errBox(e); return; }
  const reload = () => renderPolicies(el, ctx);
  const card = (d) => `<div class="card pol ${d.status !== "active" ? "dim" : ""}" data-id="${esc(d.id)}">
    <div class="between"><h3>${esc(d.title)}</h3><span class="chip">${esc(d.category)}</span></div>
    <p class="s">${d.memo_no ? `<b>${esc(d.memo_no)}</b> · ` : ""}${esc(fmtD(d.issued_on))}${d.signatories ? ` · ${esc(d.signatories)}` : ""} · ${esc(d.company)}${d.status !== "active" ? ` · <b>${ST[d.status]}</b>` : ""}${d.visibility !== "everyone" ? ` · ${esc(VIS[d.visibility])}` : ""}</p>
    ${d.summary ? `<p>${esc(d.summary)}</p>` : ""}
    <div class="btns">${d.file_path ? `<button class="btn sm" data-open="${esc(d.file_path)}">📄 Open ${esc(d.file_name || "file")}</button>` : `<span class="s">No file attached yet.</span>`}
      ${manage ? `<span class="only-desktop"> <button class="link" data-edit="${esc(d.id)}">Edit</button> <button class="link" data-up="${esc(d.id)}">${d.file_path ? "Replace file" : "Upload file"}</button>
        ${d.status === "active" ? `<button class="link" data-st="superseded">Mark replaced</button> <button class="link" data-st="retired">Retire</button>` : `<button class="link" data-st="active">Bring back</button>`}</span>` : ""}</div></div>`;
  const e = q.edit === "new" ? {} : list.find((d) => d.id === q.edit);
  const form = manage && q.edit && (q.edit === "new" || e) ? `<div class="card only-desktop"><h3>${q.edit === "new" ? "Add a policy or memo" : "Edit"}</h3><form class="form" id="pform">
    <div class="two"><label>Memo no.<input name="memo" maxlength="60" value="${esc(e.memo_no || "")}" placeholder="HRMD-26-31"></label><label>Date issued<input type="date" name="on" value="${esc(e.issued_on || "")}"></label></div>
    <label>Title<input name="title" maxlength="200" required value="${esc(e.title || "")}"></label>
    <div class="two"><label>Category<select name="cat">${CATS.map((c) => `<option ${e.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>Company<select name="co"><option value="">All companies</option>${companies.map((c) => `<option value="${esc(c.id)}" ${e.company_id === c.id ? "selected" : ""}>${esc(c.short_code)}</option>`).join("")}</select></label></div>
    <div class="two"><label>Who can read it<select name="vis">${Object.entries(VIS).map(([k, v]) => `<option value="${k}" ${(e.visibility || "everyone") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Signed by<input name="sig" maxlength="300" value="${esc(e.signatories || "")}"></label></div>
    <label>Short summary (what employees need to know)<textarea name="sum" rows="4" maxlength="4000">${esc(e.summary || "")}</textarea></label>
    <div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Save</button> <button class="btn" type="button" id="pcancel">Cancel</button></div></form></div>` : "";
  el.innerHTML = `<div class="card"><div class="between"><div class="form" style="display:flex;gap:8px;flex-wrap:wrap"><input id="psearch" type="search" placeholder="Search memos…" value="${esc(q.search)}">
      <select id="pcat"><option value="">All categories</option>${CATS.map((c) => `<option ${q.cat === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      ${manage ? `<button class="btn primary only-desktop" id="padd">Add</button>` : ""}</div>
      ${manage ? `<p class="s only-mobile">Policies are added and edited on a computer.</p>` : ""}</div>
    ${form}${list.length ? list.map(card).join("") : `<div class="empty">No policies or memos found.</div>`}`;
  let t; const s = el.querySelector("#psearch"); s.oninput = () => { clearTimeout(t); t = setTimeout(() => { q.search = s.value; reload(); }, 400); };
  el.querySelector("#pcat").onchange = (ev) => { q.cat = ev.target.value; reload(); };
  const add = el.querySelector("#padd"); if (add) add.onclick = () => { q.edit = "new"; reload(); };
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => { q.edit = b.dataset.edit; reload(); }));
  const pc = el.querySelector("#pcancel"); if (pc) pc.onclick = () => { q.edit = null; reload(); };
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { const blob = await storageBlob(BUCKET, b.dataset.open); const url = URL.createObjectURL(blob); window.open(url, "_blank") || (location.href = url); } catch (x) { toast(x.message, true); } b.disabled = false; }));
  el.querySelectorAll("[data-st]").forEach((b) => (b.onclick = async () => { try { await rpc("iaf_policy_status", { p_id: b.closest("[data-id]").dataset.id, p_status: b.dataset.st }); toast("Done ✔"); reload(); } catch (x) { toast(x.message, true); } }));
  el.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf,image/*";
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return; if (f.size > 15 * 1024 * 1024) return toast("File is too big (15 MB max).", true);
      const id = b.dataset.up, path = `${id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
      try { await storageUpload(BUCKET, path, f); await rpc("iaf_policy_file_set", { p_id: id, p_path: path, p_name: f.name, p_size: f.size }); toast("File saved ✔"); reload(); } catch (x) { toast(x.message, true); } };
    inp.click(); }));
  const pf = el.querySelector("#pform"); if (pf) pf.onsubmit = async (ev) => { ev.preventDefault(); const f = pf.elements, btn = pf.querySelector("button[type=submit]"); btn.disabled = true;
    try { await rpc("iaf_policy_save", { p_id: q.edit === "new" ? null : q.edit, p_company: f.co.value || null, p_memo_no: f.memo.value, p_title: f.title.value, p_category: f.cat.value, p_issued_on: f.on.value || null,
        p_signatories: f.sig.value, p_summary: f.sum.value, p_visibility: f.vis.value, p_status: e.status || "active" }); q.edit = null; toast("Saved ✔"); reload(); }
    catch (x) { pf.querySelector(".eerr").innerHTML = errBox(x); btn.disabled = false; } };
}
