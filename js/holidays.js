// Holiday calendar (administrator / HR staff, desktop): add by hand, load the Philippine national list as proposals, confirm / dismiss.
const KIND = { regular: "Regular holiday", special_non_working: "Special non-working", special_working: "Special working day", local: "Local holiday" };
const fmtD = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
let st = { co: null, year: new Date().getFullYear() };

export async function renderHolidays(el, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let companies; try { companies = await rpc("iaf_my_companies"); } catch (e) { el.innerHTML = errBox(e); return; }
  const cur = companies.find((c) => c.id === st.co) || companies.find((c) => c.id === state.empCompany) || companies[0]; st.co = cur.id;
  let list; try { list = await rpc("iaf_holiday_list", { p_company: cur.id, p_year: st.year }); } catch (e) { el.innerHTML = errBox(e); return; }
  const reload = () => renderHolidays(el, ctx), proposed = list.filter((h) => h.status === "proposed").length;
  el.innerHTML = `<div class="only-mobile"><p class="s">The holiday calendar is managed on a computer.</p></div><div class="only-desktop">
    <div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === cur.id ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>
    <div class="card"><div class="between"><h3>Holidays ${st.year}</h3><span><button class="btn sm" data-y="-1">‹</button> <button class="btn sm" data-y="1">›</button></span></div>
      <p class="s">Regular and special non-working holidays are not counted as leave days. Special working days are counted as normal work days. Holy Week, Chinese New Year and Eid change every year: add them when they are proclaimed.</p>
      ${proposed ? `<div class="alert warn"><b>${proposed} holiday${proposed > 1 ? "s" : ""} waiting for your confirmation.</b> They do not count until confirmed. <button class="btn sm" id="confirmall">Confirm all</button></div>` : ""}
      <div class="hlist">${list.map((h) => `<div class="between hrow ${h.status}" data-id="${esc(h.id)}"><span><b>${esc(fmtD(h.date))}</b> — ${esc(h.name)} <span class="chip">${esc(KIND[h.kind])}</span>${h.status === "proposed" ? ' <span class="chip warn">Proposed</span>' : h.status === "dismissed" ? ' <span class="chip">Dismissed</span>' : ""}${h.note ? `<br><small>${esc(h.note)}</small>` : ""}</span>
        <span>${h.status === "proposed" ? '<button class="link" data-do="confirm">Confirm</button> <button class="link" data-do="dismiss">Dismiss</button>' : h.status === "dismissed" ? '<button class="link" data-do="confirm">Restore</button>' : ""} <button class="link" data-do="delete">Delete</button></span></div>`).join("") || "<small>No holidays for this year yet.</small>"}</div>
      <div class="btns"><button class="btn" id="seed">Load the Philippine national holidays ${st.year}</button><label class="s"><input type="checkbox" id="allco"> for all my companies</label></div></div>
    <div class="card"><h3>Add a holiday</h3><form class="form" id="hform"><div class="two"><label>Date<input type="date" name="d" required></label><label>Name<input name="n" maxlength="120" required placeholder="e.g. Caloocan Day"></label></div>
      <div class="two"><label>Type<select name="k"><option value="regular">Regular holiday</option><option value="special_non_working">Special non-working day</option><option value="special_working">Special working day</option><option value="local">Local holiday</option></select></label><label>Note (optional)<input name="note" maxlength="300" placeholder="e.g. Proclamation no."></label></div>
      <label class="check"><input type="checkbox" name="all"><span>Add to all my companies</span></label><div class="eerr"></div><button class="btn primary" type="submit">Add holiday</button></form>
      <p class="s">An automatic online check for new government and local announcements will be added with the e-mail notifications; it will appear here as proposals for you to confirm.</p></div></div>`;
  el.querySelectorAll("[data-co]").forEach((b) => (b.onclick = () => { st.co = b.dataset.co; reload(); }));
  el.querySelectorAll("[data-y]").forEach((b) => (b.onclick = () => { st.year += Number(b.dataset.y); reload(); }));
  const run = async (fn, msg) => { try { await fn(); toast(msg); reload(); } catch (e) { toast(e.message, true); } };
  el.querySelector("#seed").onclick = () => run(async () => { const n = await rpc("iaf_holiday_seed", { p_company: cur.id, p_year: st.year, p_all: el.querySelector("#allco").checked }); if (!n) throw new Error("Nothing new to propose — they are already listed."); }, "Proposed ✔ please confirm them below");
  const ca = el.querySelector("#confirmall"); if (ca) ca.onclick = () => run(() => rpc("iaf_holiday_confirm_all", { p_company: cur.id, p_year: st.year }), "Confirmed ✔");
  el.querySelectorAll("[data-do]").forEach((b) => (b.onclick = () => { const id = b.closest("[data-id]").dataset.id; if (b.dataset.do === "delete" && !confirm("Delete this holiday?")) return; run(() => rpc("iaf_holiday_decide", { p_id: id, p_action: b.dataset.do }), "Done ✔"); }));
  const f = el.querySelector("#hform");
  f.onsubmit = async (ev) => { ev.preventDefault(); const err = f.querySelector(".eerr"); err.innerHTML = ""; try { await rpc("iaf_holiday_save", { p_company: cur.id, p_date: f.d.value, p_name: f.n.value, p_kind: f.k.value, p_note: f.note.value || null, p_all: f.all.checked }); toast("Added ✔"); st.year = Number(f.d.value.slice(0, 4)); reload(); } catch (e) { err.innerHTML = errBox(e); } };
}
