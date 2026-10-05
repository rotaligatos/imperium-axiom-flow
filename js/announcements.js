// Announcements, events and emergency notices. HR / administrator post on a computer; everyone reads on Home (phone or desktop).
const KIND = { announcement: "📢 Announcement", event: "📅 Event", emergency: "🚨 Emergency" };
const fmtD = (iso) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", year: "numeric", month: "short", day: "numeric" }) : "");
const t12 = (h) => { if (!h) return ""; const [a, m] = h.split(":").map(Number); return `${((a + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${a < 12 ? "AM" : "PM"}`; };

// Home: red banner for unacknowledged emergencies + list of notices. `list` comes from iaf_my_announcements.
export function noticesHtml(list, esc) {
  if (!list || !list.length) return "";
  const body = (a) => `<div class="nt-body">${esc(a.body || "").replace(/\n/g, "<br>")}</div>`;
  const when = (a) => (a.kind === "event" ? `<div class="s">${esc(fmtD(a.event_date))}${a.event_time ? " · " + esc(t12(a.event_time)) : ""}${a.place ? " · " + esc(a.place) : ""}</div>` : "");
  const em = list.filter((a) => a.kind === "emergency");
  const rest = list.filter((a) => a.kind !== "emergency");
  return em.map((a) => `<div class="emerg${a.acked ? " done" : ""}" data-nid="${esc(a.id)}"><b>${KIND.emergency}: ${esc(a.title)}</b>${body(a)}
      ${a.acked ? `<div class="s">✔ You confirmed you read this.</div>` : `<button class="btn" data-ack="${esc(a.id)}">I have read this</button>`}</div>`).join("")
    + (rest.length ? `<div class="card notices"><h3>Announcements &amp; events</h3>${rest.map((a) => `<details class="nt${a.pinned ? " pin" : ""}"><summary>${a.pinned ? "📌 " : ""}${esc(a.title)}${a.kind === "event" ? ` <small>${esc(fmtD(a.event_date))}</small>` : ""}</summary>${when(a)}${body(a)}</details>`).join("")}</div>` : "");
}

let co = null;
export async function renderNotices(el, ctx) {
  const { rpc, esc, toast, errBox, state } = ctx;
  el.innerHTML = `<div class="empty">Loading…</div>`;
  let companies; try { companies = await rpc("iaf_my_companies"); } catch (e) { el.innerHTML = errBox(e); return; }
  const cur = companies.find((c) => c.id === co) || companies.find((c) => c.id === state.empCompany) || companies[0]; co = cur.id;
  let list, lk; try { [list, lk] = await Promise.all([rpc("iaf_announcement_list", { p_company: cur.id }), rpc("iaf_org_lookups", { p_company: cur.id })]); } catch (e) { el.innerHTML = errBox(e); return; }
  const depts = lk.departments || [], reload = () => renderNotices(el, ctx);
  el.innerHTML = `<div class="only-mobile"><p class="s">Posting notices is done on a computer. You can read them on Home.</p></div><div class="only-desktop">
    <div class="cotabs">${companies.map((c) => `<button class="cotab${c.id === cur.id ? " on" : ""}" data-co="${esc(c.id)}">${esc(c.short_code)}</button>`).join("")}</div>
    <div class="twocol"><div class="card"><h3 id="nform-h">Post a notice</h3>
      <form class="form" id="nf"><div class="egrid">
        <label>Type<select name="kind"><option value="announcement">Announcement</option><option value="event">Event</option><option value="emergency">Emergency (must be acknowledged)</option></select></label>
        <label>To<select name="dept"><option value="">Whole company</option>${depts.map((d) => `<option value="${esc(d.id)}">${d.parent_id ? "— " : ""}${esc(d.name)}</option>`).join("")}</select></label>
        <label class="wide">Title<input name="title" maxlength="120" required></label>
        <label class="wide">Message<textarea name="body" rows="4" maxlength="4000"></textarea></label>
        <label class="ev">Event date<input name="edate" type="date"></label><label class="ev">Time<input name="etime" type="time"></label><label class="ev wide">Place<input name="place" maxlength="120"></label>
        <label>Show from<input name="from" type="date"></label><label>Show until (blank = until removed)<input name="to" type="date"></label>
        <label class="tick"><input type="checkbox" name="pin"> Pin to the top</label></div>
        <div class="eerr"></div><div class="btns"><button class="btn primary" type="submit">Post</button><button class="btn" type="button" id="ncancel" hidden>Cancel edit</button></div></form></div>
    <div class="card"><h3>Posted notices</h3>${list.map((a) => `<div class="nrow" data-id="${esc(a.id)}"><div class="between"><span><b>${esc(a.title)}</b> <span class="chip${a.kind === "emergency" ? " bad" : ""}">${esc(a.kind)}</span>${a.pinned ? " 📌" : ""}<br>
        <small>${esc(a.dept || "Whole company")} · from ${esc(fmtD(a.starts_on))}${a.ends_on ? " to " + esc(fmtD(a.ends_on)) : ""}${a.kind === "event" ? " · event " + esc(fmtD(a.event_date)) : ""}</small></span>
        <span><button class="link" data-edit>Edit</button> <button class="link" data-rm>Remove</button></span></div>
        ${a.kind === "emergency" ? `<div class="s">Read by <b>${a.acked}</b> of ${a.audience}${a.unacked && a.unacked.length ? ` — not yet: ${esc(a.unacked.join(", "))}` : ""}</div>` : ""}</div>`).join("") || "<small>Nothing posted.</small>"}</div></div></div>`;
  el.querySelectorAll("[data-co]").forEach((b) => (b.onclick = () => { co = b.dataset.co; reload(); }));
  const f = el.querySelector("#nf"); let editing = null;
  const sync = () => el.querySelectorAll(".ev").forEach((x) => (x.hidden = f.kind.value !== "event")); f.kind.onchange = sync; sync();
  f.onsubmit = async (ev) => { ev.preventDefault(); const err = f.querySelector(".eerr"); err.innerHTML = ""; const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    if (f.kind.value === "emergency" && !confirm("Post this as an EMERGENCY notice? Everyone in the audience will see a red banner and must confirm they read it.")) { btn.disabled = false; return; }
    try { await rpc("iaf_announcement_save", { p_company: cur.id, p_id: editing, p_kind: f.kind.value, p_title: f.title.value, p_body: f.body.value, p_dept: f.dept.value || null,
        p_event_date: f.kind.value === "event" ? f.edate.value || null : null, p_event_time: f.kind.value === "event" ? f.etime.value || null : null, p_place: f.kind.value === "event" ? f.place.value : null,
        p_starts: f.from.value || null, p_ends: f.to.value || null, p_pinned: f.pin.checked }); toast(editing ? "Saved ✔" : "Posted ✔"); reload(); } catch (e) { err.innerHTML = errBox(e); btn.disabled = false; } };
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => { const a = list.find((x) => x.id === b.closest("[data-id]").dataset.id); editing = a.id;
    f.kind.value = a.kind; f.dept.value = a.dept_id || ""; f.title.value = a.title; f.body.value = a.body || ""; f.edate.value = a.event_date || ""; f.etime.value = a.event_time || ""; f.place.value = a.place || "";
    f.from.value = a.starts_on || ""; f.to.value = a.ends_on || ""; f.pin.checked = !!a.pinned; sync(); el.querySelector("#nform-h").textContent = "Edit notice"; f.querySelector("button[type=submit]").textContent = "Save";
    const c = el.querySelector("#ncancel"); c.hidden = false; c.onclick = reload; f.scrollIntoView({ block: "nearest" }); }));
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { if (!confirm("Remove this notice for everyone?")) return; try { await rpc("iaf_announcement_delete", { p_id: b.closest("[data-id]").dataset.id }); toast("Removed ✔"); reload(); } catch (e) { toast(e.message, true); } }));
}
