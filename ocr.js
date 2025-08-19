const PROBE_TEMPLATE_DATAURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACIAAAAmCAYAAACh1knUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAARGSURBVFhH7VfraxNZFPffsVarVdfHLosLKuJ+2Ao+UFmVZRFW8IsLfhHEj+IDUdo0fUSr1lfV1eqqSFkXn7UivkCwm0nSTPNqG9ukTZvHJHM8586dZB53kpSUZVn8DT9IJr9z7m/uPffMzTz4j+D/YiTDWTtqNJLmrB1VGMkzKniFZ97Aq88uuBvaA+f8q8DlXczY4V8MXYGV8CC6H95PdMNo9iNGaFe1qGgkr05CJD0ArdIKaPYugVYcuF1aJCT9TnQjb8ibYST7CVQo8EzlUdZIFk3clHcXB5iNkU7GRngYOcCzlYejkZSahEvyeuGAs2Gztw6uBJsgqcg8sxhCIzOFBFwMroHOwBJh8tmw2Tuf8c7wLp5dDJsRRU1Db/hnYdJa6MFlehw7giOo2kAW2IwEUn1zMhNWUs14vEshU0jykcwwGSmoOfD414BLcjbSKjVACxYssZOzBetAo3afNKLYDrz/d+wwH80Mk5FA6mmx8kWJiLRr2O6RlsOT0SMwmLwFL8dboHtoYzG23M5qRSZyQT5iCQYjKjwdO8oalCiRW6pn7PCtRt1xyBUmeRxAjl1Z+JC4iM3tO4w3xxpJhTs4dZdHllA0UlAVuD3sXKSUoN23HIan+3mECGmIpvtR7zyjlOdF/CTXl1A0klezOL1rhcFESjAwfoarnaC9e17GjwlzEClPb+gXTW5A0Qht2w6f89q6pW9gSolxdXmEZwbYgGwWLXlo93RJK7myhKqN9Mg7uLIyCpirK/BDDUYcq70BHo2Jt50IVG835T1oxF4rdM9dzgj1kJ6hJlugxrk10hv6jStLMBhR4FZoR7E5mRM0QF/0d1TRaazyGSOnZuC6vB0HXWDJoxl5ET/NlSUUjVAf6Y+fQqG4yC4Hf0QN7QqFqcshi8vs8X8rzENGBqfuc2UJBiPUWR9hM6pntCZo8zViHSVQVdnIZD6GA9Yz6vFunFViG/aiRM5+JDAZoWrvxncNVbbRBNGFXXUs8w5VlY28nTjPntxYI/r3ntBPXGWGyQgNEsBpExmhaf4zvJdpyoEV6vBOoRGXtKy6ty+BtnFnYIXJhJZoPhZxPQRTz7hSjHcTl4TvKnq4P+RtWIlVnkcIkfRrWyK9iC8MrYNY+gNXGqHCP5MPoU1aLTRyFmdjTPFxrR22pckURvAEvtWWSJ/qZu9CuBehPmD+P0MzSSZIIzJCLaEvehDtik/1tmK9Lm9hT25NpBu5geuvv9ys8OOu6wpsEBrRZ/RacCNXm2Eyoqp5+GvkEAvQT1s629HEczyvKOoMKTntmM7HoX/0BJsB46lNM1KHvcp+BCDYaoQSXQ1uwiB9KRqx4/4K4ekBrqgMKshPyduWPHXwILIffxF3ZmGx5tRpuIb/1Dz+7/E4eJzfnT0UbPX3owewia3CutrH74ohNEKgZUphh5wLjOck/skZjkb+bXw1YsVXI2YAfAGs8LSsCIEo2AAAAABJRU5ErkJggg==";

const PROBE_REGION = { x: 0.13, y: 0.45, w: 0.05, h: 0.45 }; // % of frame
const EVENT_REGION = { x: 0.12, y: 0.175, w: 0.2, h: 0.05 }; // % of frame

const MATCH_STRIDE = 2;
const MATCH_THRESHOLD = 0.85;
const MAX_MS_PER_SCAN = 60;

const OCR_OPTS = { lang: "eng", psm: 6 }; // 6 = block of text (ribbon often has 2 lines)
const TRIGGER_COOLDOWN_MS = 1500;

const captureBtn   = document.getElementById("captureBtn");
const videoEl      = document.getElementById("captureVideo");
const suggestions  = document.getElementById("suggestions");

const SCAN_TIME_KEY = "umasearch-scantime";
function getScanDelay() {
  const v = localStorage.getItem(SCAN_TIME_KEY) || "3000";
  const n = Number(v);
  return Number.isFinite(n) && n > 200 ? n : 3000;
}

let mediaStream = null;
let captureTimer = null;
let lastTriggerTs = 0;

const canvas = document.createElement("canvas");
const ctx    = canvas.getContext("2d", { willReadFrequently: true });

let tpl = null; // {w,h,gray,mean,std}
function toGray(imgData) {
  const { data, width, height } = imgData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i], g = data[i+1], b = data[i+2];
    gray[j] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
  }
  return { gray, width, height };
}
function stats(gray) {
  let s = 0, s2 = 0;
  const n = gray.length;
  for (let i = 0; i < n; i++) { const v = gray[i]; s += v; s2 += v*v; }
  const mean = s / n;
  const v2 = Math.max(1e-6, s2 / n - mean * mean);
  return { mean, std: Math.sqrt(v2) };
}

function _toGray(imgData) {
  const { data, width, height } = imgData;
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i], g = data[i+1], b = data[i+2];
    gray[j] = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
  }
  return { gray, width, height };
}
function _stats(gray) {
  let s = 0, s2 = 0;
  const n = gray.length;
  for (let i = 0; i < n; i++) { const v = gray[i]; s += v; s2 += v*v; }
  const mean = s / n;
  const v2 = Math.max(1e-6, s2 / n - mean * mean);
  return { mean, std: Math.sqrt(v2) };
}

async function _decodeToCanvasFromBlob(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d", { willReadFrequently: true }).drawImage(bmp, 0, 0);
    return c;
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "sync";
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function _decodeToCanvasFromDataURL(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return _decodeToCanvasFromBlob(blob);
}

async function loadTemplate(src) {
  let canvasFromImg;

  if (PROBE_TEMPLATE_DATAURL) {
    canvasFromImg = await _decodeToCanvasFromDataURL(PROBE_TEMPLATE_DATAURL);
  } else {
    const res = await fetch(src, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch template ${src}: ${res.status} ${res.statusText}`);

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/")) {
      const snippet = (await res.text()).slice(0, 200);
      throw new Error(`Template is not an image (content-type: "${ct}"). First bytes: ${snippet}`);
    }

    const blob = await res.blob();
    canvasFromImg = await _decodeToCanvasFromBlob(blob);
  }

  const id = canvasFromImg.getContext("2d", { willReadFrequently: true })
                          .getImageData(0, 0, canvasFromImg.width, canvasFromImg.height);
  const g = _toGray(id);
  const st = _stats(g.gray);
  tpl = { w: g.width, h: g.height, gray: g.gray, mean: st.mean, std: st.std };
  console.info(`[ocr] Template loaded ${g.width}x${g.height}`);
}

function nccScore(frameGray, fW, x, y, tplObj) {
  const { w: tw, h: th, gray: tGray, mean: tMean, std: tStd } = tplObj;
  let sum = 0, sum2 = 0, sumCross = 0;
  for (let j = 0; j < th; j++) {
    const fy = (y + j) * fW;
    const tj = j * tw;
    for (let i = 0; i < tw; i++) {
      const fv = frameGray[fy + x + i];
      const tv = tGray[tj + i];
      sum += fv; sum2 += fv * fv; sumCross += fv * tv;
    }
  }
  const n = tw * th;
  const fMean = sum / n;
  const fVar  = Math.max(1e-6, sum2 / n - fMean * fMean);
  const fStd  = Math.sqrt(fVar);
  const num   = sumCross - n * fMean * tMean;
  const den   = n * fStd * tStd;
  return den > 0 ? (num / den) : 0;
}
function matchTemplateInRegion(frameImgData, probeRect, tplObj) {
  const { width: fW, height: fH } = frameImgData;
  const frameGray = toGray(frameImgData).gray;

  const { w: tw, h: th } = tplObj;
  const x0 = probeRect.x, y0 = probeRect.y;
  const x1 = x0 + Math.max(0, probeRect.w - tw);
  const y1 = y0 + Math.max(0, probeRect.h - th);

  let best = { score: -1, x: x0, y: y0 };
  const tStart = performance.now();

  for (let y = y0; y <= y1; y += MATCH_STRIDE) {
    for (let x = x0; x <= x1; x += MATCH_STRIDE) {
      const s = nccScore(frameGray, fW, x, y, tplObj);
      if (s > best.score) best = { score: s, x, y };
    }
    if (performance.now() - tStart > MAX_MS_PER_SCAN) break;
  }
  return best;
}

function setSuggestion(msg) { if (suggestions) suggestions.textContent = msg || ""; }
function mayTrigger() {
  const now = performance.now();
  if (now - lastTriggerTs < TRIGGER_COOLDOWN_MS) return false;
  lastTriggerTs = now;
  return true;
}

function cleanTitle(raw) {
  if (!raw) return "";

  let t = raw
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ");

  const lines = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const noRibbon = lines.filter(l => !/support\s*card\s*event/i.test(l));

  t = (noRibbon.length ? noRibbon.join(" ") : lines.join(" "));

  t = t
    .replace(/\s*\*\s*/g, " ") // stray bullets
    .replace(/\s*\.\s*/g, ". ")
    .replace(/\s*\|\s*/g, " I ") // pipe -> capital I (very common on this font)
    .replace(/\s{2,}/g, " ")
    .replace(/^[^A-Za-z0-9]+/, "") // leading junk
    .trim();

  if (t && t === t.toLowerCase()) {
    t = t.replace(/\b([a-z])([a-z]*)\b/g, (_, a, b) => a.toUpperCase() + b);
  }
  t = t.replace(/[^A-Za-z0-9 '"\-\?\!\:\,\.\&\(\)]/g, "").trim();

  return t;
}

async function ocrEventRect(eventRectPx) {
  const sub = document.createElement("canvas");
  sub.width = eventRectPx.w; sub.height = eventRectPx.h;
  const sctx = sub.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(canvas, eventRectPx.x, eventRectPx.y, eventRectPx.w, eventRectPx.h, 0, 0, eventRectPx.w, eventRectPx.h);

  const blob = await new Promise(res => sub.toBlob(res, "image/png"));
  const url = URL.createObjectURL(blob);
  try {
    const r = await Tesseract.recognize(url, OCR_OPTS.lang, { logger: () => {} });
    const raw = (r?.data?.text || "").trim();
    return cleanTitle(raw);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function scanFrame() {
  if (!tpl) return;
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  if (!vw || !vh) return;

  canvas.width = vw; canvas.height = vh;
  ctx.drawImage(videoEl, 0, 0, vw, vh);
  const frameData = ctx.getImageData(0, 0, vw, vh);

  const probeRectPx = {
    x: Math.round(PROBE_REGION.x * vw),
    y: Math.round(PROBE_REGION.y * vh),
    w: Math.round(PROBE_REGION.w * vw),
    h: Math.round(PROBE_REGION.h * vh)
  };
  const eventRectPx = {
    x: Math.round(EVENT_REGION.x * vw),
    y: Math.round(EVENT_REGION.y * vh),
    w: Math.round(EVENT_REGION.w * vw),
    h: Math.round(EVENT_REGION.h * vh)
  };

  const match = matchTemplateInRegion(frameData, probeRectPx, tpl);

  if (match.score >= MATCH_THRESHOLD) {
    setSuggestion(`UI found (${Math.round(match.score*100)}%). Reading title…`);
    if (!mayTrigger()) return;

    const title = (await ocrEventRect(eventRectPx)).trim();
    if (title) {
      setSuggestion(`Detected: “${title}” — searching…`);
      if (typeof window.performSearch === "function") {
        window.performSearch(title); // search.js renders the results
      } else if (typeof performSearch === "function") {
        performSearch(title);
      } else {
        console.warn("[ocr] performSearch() not found.");
      }
    } else {
      setSuggestion("UI found, but OCR produced no text.");
    }
  } else {
    setSuggestion("Waiting for UI…");
  }
}

let isCapturing = false;
let stopBtn = null;

async function startCapture() {
  try {
    await loadTemplate(PROBE_TEMPLATE_DATAURL);

    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false
    });
    videoEl.srcObject = mediaStream;

    if (captureTimer) clearInterval(captureTimer);
    const delay = getScanDelay();
    setSuggestion("Screen capture started. Waiting for UI…");

    captureBtn.style.display = "none";
    if (!stopBtn) {
      stopBtn = document.createElement("button");
      stopBtn.id = "stopCaptureBtn";
      stopBtn.className = "capture-btn";
      stopBtn.textContent = "Stop Capture";
      stopBtn.onclick = stopCapture;
      captureBtn.parentNode.insertBefore(stopBtn, captureBtn.nextSibling);
    }
    stopBtn.style.display = "";

    isCapturing = true;

    videoEl.onloadedmetadata = () => {
      videoEl.play().then(() => {
        scanFrame();
        captureTimer = setInterval(scanFrame, delay);
      });
    };

    mediaStream.getVideoTracks()[0].addEventListener("ended", stopCapture);
  } catch (err) {
    console.error("capture/template error:", err);
    setSuggestion("Screen capture failed (permissions or template).");
    stopCapture();
  }
}

function stopCapture() {
  if (captureTimer) clearInterval(captureTimer);
  captureTimer = null;
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  setSuggestion("Capture stopped.");
  videoEl.srcObject = null;

  if (stopBtn) stopBtn.style.display = "none";
  captureBtn.style.display = "";
  isCapturing = false;
}

captureBtn?.addEventListener("click", startCapture);
