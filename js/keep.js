// Re-render a page without losing the reader's place: keeps the page height while it reloads,
// then puts back the window scroll and the scroll of inner lists / the org tree.
const SCROLLERS = ".otree,.tscroll,.pane-list,.people,.list,.imp";
export async function keepPlace(el, fn) {
  const y = window.scrollY, x = window.scrollX;
  const inner = [...el.querySelectorAll(SCROLLERS)].map((n) => [n.scrollTop, n.scrollLeft]);
  const open = [...el.querySelectorAll("details")].map((d) => d.open);
  el.style.minHeight = el.offsetHeight + "px";
  try { return await fn(); }
  finally {
    const ns = el.querySelectorAll(SCROLLERS);
    inner.forEach(([t, l], i) => { if (ns[i]) { ns[i].scrollTop = t; ns[i].scrollLeft = l; } });
    const ds = el.querySelectorAll("details"); if (ds.length === open.length) open.forEach((o, i) => { ds[i].open = o; });
    el.style.minHeight = "";
    window.scrollTo(x, y);
  }
}
