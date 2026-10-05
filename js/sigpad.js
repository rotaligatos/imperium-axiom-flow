// Finger / mouse signature pad. Draws on a canvas, exports a transparent PNG (base64, no prefix) of the trimmed signature.
export function mountPad(host, { onSave, onCancel }) {
  host.innerHTML = `<canvas class="pad" width="640" height="220" aria-label="Draw your signature here"></canvas>
    <div class="btns"><button type="button" class="btn" data-p="clear">Clear</button><button type="button" class="btn" data-p="upload">Upload a picture</button><button type="button" class="btn" data-p="cancel">Cancel</button><button type="button" class="btn primary" data-p="save">Save signature</button></div>
    <input type="file" accept="image/png,image/jpeg,image/webp" data-p="file" hidden>
    <p class="s" id="padmsg">Draw your signature with your finger or mouse — or upload a picture of it (dark ink on white paper works best).</p>`;
  const cv = host.querySelector("canvas"), cx = cv.getContext("2d"); let drawing = false, last = null, ink = false;
  cx.lineWidth = 4; cx.lineCap = "round"; cx.lineJoin = "round"; cx.strokeStyle = "#0b1b2e";
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
  cv.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); cx.beginPath(); cx.moveTo(...last); cx.lineTo(last[0] + 0.1, last[1] + 0.1); cx.stroke(); ink = true; e.preventDefault(); });
  cv.addEventListener("pointermove", (e) => { if (!drawing) return; const p = pos(e); cx.beginPath(); cx.moveTo(...last); cx.lineTo(...p); cx.stroke(); last = p; e.preventDefault(); });
  const stop = () => { drawing = false; }; cv.addEventListener("pointerup", stop); cv.addEventListener("pointercancel", stop);
  host.querySelector("[data-p=clear]").onclick = () => { cx.clearRect(0, 0, cv.width, cv.height); ink = false; };
  const file = host.querySelector("[data-p=file]"), msg = host.querySelector("#padmsg");
  host.querySelector("[data-p=upload]").onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    if (f.size > 8e6) { msg.textContent = "That picture is too large (max 8 MB)."; return; }
    try {
      const bmp = await createImageBitmap(f); cx.clearRect(0, 0, cv.width, cv.height);
      const sc = Math.min(cv.width / bmp.width, cv.height / bmp.height), w = bmp.width * sc, h = bmp.height * sc;
      cx.drawImage(bmp, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
      const im = cx.getImageData(0, 0, cv.width, cv.height), d = im.data;       // white paper -> transparent, keep the ink
      for (let i = 0; i < d.length; i += 4) { const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (l > 225) d[i + 3] = 0; else if (l > 170) d[i + 3] = Math.round(((225 - l) / 55) * d[i + 3]); }
      cx.putImageData(im, 0, 0); ink = true; msg.textContent = "Check the picture, then tap Save signature.";
    } catch { msg.textContent = "Could not read that picture. Try a PNG or JPG."; }
    file.value = "";
  };
  host.querySelector("[data-p=cancel]").onclick = () => onCancel && onCancel();
  host.querySelector("[data-p=save]").onclick = async () => {
    if (!ink) { host.querySelector("#padmsg").textContent = "Please draw your signature first."; return; }
    // trim to the inked area
    const d = cx.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = 0, y1 = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (d[(y * cv.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(cv.width - 1, x1 + pad); y1 = Math.min(cv.height - 1, y1 + pad);
    const out = document.createElement("canvas"); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1; out.getContext("2d").drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    const b = host.querySelector("[data-p=save]"); b.disabled = true;
    try { await onSave(out.toDataURL("image/png").split(",")[1]); } catch (e) { host.querySelector("#padmsg").textContent = e.message || "Could not save"; b.disabled = false; }
  };
}

// Decode a stored PNG (base64) to raw pixels for the PDF writer: {w,h,rgb,a} (zlib-compressed when the browser supports it).
export async function pngToPdfImage(b64) {
  const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0); const px = g.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3), a = new Uint8Array(w * h);
  for (let i = 0, j = 0, k = 0; i < px.length; i += 4) { rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2]; a[k++] = px[i + 3]; }
  const z = async (u8) => { if (typeof CompressionStream === "undefined") return { d: u8, f: false };
    const s = new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate")); return { d: new Uint8Array(await new Response(s).arrayBuffer()), f: true }; };
  const [r, al] = await Promise.all([z(rgb), z(a)]);
  return { w, h, rgb: r.d, a: al.d, flate: r.f && al.f };
}
