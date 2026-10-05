// Tiny dependency-free PDF writer: one or more pages, Helvetica (regular/bold), lines, rects,
// text, and Flate-compressed RGB images with an alpha mask. Coordinates use a TOP-LEFT origin in points.
import { W_H, W_HB } from "./pdfdata.js";

const MAP = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "★": "*", "•": "-", " ": " " };
const clean = (s) => String(s ?? "").replace(/[‘’“”–—…★• ]/g, (c) => MAP[c]).replace(/[\r\n\t]+/g, " ")
  .replace(/[^\x20-\xff]/g, "?");
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const n = (x) => (Math.round(x * 100) / 100).toString();
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class Pdf {
  constructor(w, h) { this.w = w; this.h = h; this.pages = []; this.imgs = []; this.ops = []; }
  // ---- measuring -----------------------------------------------------------------------
  width(str, size, bold) {
    const t = bold ? W_HB : W_H; let w = 0;
    for (const ch of clean(str)) { const c = ch.charCodeAt(0); w += (t[c - 32] ?? 556); }
    return (w * size) / 1000;
  }
  // Shortens text with "..." so it fits in maxW.
  fit(str, size, bold, maxW) {
    str = clean(str); if (this.width(str, size, bold) <= maxW) return str;
    while (str.length > 1 && this.width(str + "...", size, bold) > maxW) str = str.slice(0, -1);
    return str + "...";
  }
  // Greedy word-wrap; returns array of lines.
  wrap(str, size, bold, maxW) {
    const words = clean(str).split(" ").filter(Boolean), lines = []; let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (this.width(t, size, bold) <= maxW) cur = t;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur); return lines;
  }
  // ---- drawing -------------------------------------------------------------------------
  _y(y) { return this.h - y; }
  color(rgb, stroke) { const [r, g, b] = rgb.map((v) => n(v / 255)); this.ops.push(`${r} ${g} ${b} ${stroke ? "RG" : "rg"}`); }
  line(x1, y1, x2, y2, lw = 0.6, rgb = [0, 0, 0]) {
    this.ops.push("q"); this.color(rgb, true); this.ops.push(`${n(lw)} w ${n(x1)} ${n(this._y(y1))} m ${n(x2)} ${n(this._y(y2))} l S Q`);
  }
  rect(x, y, w, h, { fill, stroke = [0, 0, 0], lw = 0.6 } = {}) {
    this.ops.push("q");
    if (fill) this.color(fill, false);
    if (stroke) this.color(stroke, true);
    this.ops.push(`${n(lw)} w ${n(x)} ${n(this._y(y + h))} ${n(w)} ${n(h)} re ${fill && stroke ? "B" : fill ? "f" : "S"} Q`);
  }
  text(str, x, y, { size = 8, bold = false, align = "left", rgb = [0, 0, 0] } = {}) {
    str = clean(str); if (!str) return;
    const w = this.width(str, size, bold);
    if (align === "center") x -= w / 2; else if (align === "right") x -= w;
    this.ops.push(`q ${rgb.map((v) => n(v / 255)).join(" ")} rg BT /${bold ? "F2" : "F1"} ${n(size)} Tf ${n(x)} ${n(this._y(y))} Td (${esc(str)}) Tj ET Q`);
  }
  check(x, y, size, on) {          // checkbox, top-left at (x,y)
    this.rect(x, y, size, size, { lw: 0.6 });
    if (on) { this.line(x + size * 0.2, y + size * 0.55, x + size * 0.42, y + size * 0.8, 1.2); this.line(x + size * 0.42, y + size * 0.8, x + size * 0.85, y + size * 0.18, 1.2); }
  }
  image(img, x, y, w, h) {
    let i = this.imgs.indexOf(img); if (i < 0) { this.imgs.push(img); i = this.imgs.length - 1; }
    this.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(this._y(y + h))} cm /Im${i} Do Q`);
  }
  // Raw RGBA-less image from the generated module: {w,h,rgb(b64 zlib),a(b64 zlib)}
  static logo(d) { return { w: d.w, h: d.h, rgb: b64(d.rgb), a: b64(d.a) }; }
  newPage() { this.pages.push(this.ops.join("\n")); this.ops = []; }
  // ---- serialise -----------------------------------------------------------------------
  build(info = {}) {
    if (this.ops.length || !this.pages.length) this.newPage();
    const enc = new TextEncoder(), chunks = [], offs = []; let len = 0;
    const push = (u8) => { chunks.push(u8); len += u8.length; };
    const str = (s) => push(Uint8Array.from(s, (c) => c.charCodeAt(0) & 255));
    const obj = (id, body, stream) => {
      offs[id] = len; str(`${id} 0 obj\n${body}`);
      if (stream) { str("\nstream\n"); push(stream); str("\nendstream"); }
      str("\nendobj\n");
    };
    // ids: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then images (2 each), then pages (2 each)
    const imgBase = 6, pageBase = imgBase + this.imgs.length * 2, kids = [];
    str("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    this.pages.forEach((_, i) => kids.push(`${pageBase + i * 2} 0 R`));
    obj(2, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${this.pages.length} >>`);
    obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    obj(5, `<< /Title (${esc(clean(info.title || "Document"))}) /Producer (Imperium Axiom Flow) >>`);
    this.imgs.forEach((im, i) => {
      const id = imgBase + i * 2;
      obj(id, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${id + 1} 0 R /Length ${im.rgb.length} >>`, im.rgb);
      obj(id + 1, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${im.a.length} >>`, im.a);
    });
    const xo = this.imgs.map((_, i) => `/Im${i} ${imgBase + i * 2} 0 R`).join(" ");
    this.pages.forEach((content, i) => {
      const id = pageBase + i * 2, c = enc.encode(content);   // content is latin1-safe (clean())
      const bytes = Uint8Array.from(content, (ch) => ch.charCodeAt(0) & 255);
      obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.w)} ${n(this.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xo} >> >> /Contents ${id + 1} 0 R >>`);
      obj(id + 1, `<< /Length ${bytes.length} >>`, bytes); void c;
    });
    const total = pageBase + this.pages.length * 2, xref = len;
    str(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let i = 1; i < total; i++) str(String(offs[i]).padStart(10, "0") + " 00000 n \n");
    str(`trailer\n<< /Size ${total} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }
}
