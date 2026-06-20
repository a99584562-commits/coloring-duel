// colorize.js — turns an uploaded LINE-ART image into an interactive coloring
// page: detect the black contours, find the enclosed white areas between them,
// and let each area be flood-filled with any colour on click.
//
// The pipeline is DETERMINISTIC (same pixels + same options → identical region
// map), so two peers rebuild the exact same coloring page from the same PNG
// without a server. Colours are stored as absolute packed RGB per region, so a
// filled board renders identically on both sides regardless of any palette.

// ---- image helpers ---------------------------------------------------------

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

export function downscaleToImageData(img, maxDim = 820) {
  const ratio = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * ratio))
  const h = Math.max(1, Math.round(img.height * ratio))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // flatten any transparency onto white (line art is often transparent PNG)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

export function imageDataToDataURL(imageData) {
  const c = document.createElement('canvas')
  c.width = imageData.width
  c.height = imageData.height
  c.getContext('2d').putImageData(imageData, 0, 0)
  return c.toDataURL('image/png') // lossless → both peers decode identical pixels
}

export async function dataURLToImageData(dataURL) {
  const img = await loadImage(dataURL)
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  return ctx.getImageData(0, 0, img.width, img.height)
}

// ---- colour packing --------------------------------------------------------

export function packRGB(r, g, b) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
}
export function unpackRGB(v) {
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}
export function hexToPacked(hex) {
  return parseInt(hex.slice(1), 16) | 0
}
export function packedToHex(v) {
  return '#' + (v & 0xffffff).toString(16).padStart(6, '0')
}
export function rgbToCss(rgb) {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
}

const PAPER = [252, 252, 253]

// ---- pipeline --------------------------------------------------------------

export function buildColoringPage(imageData, opts = {}) {
  const threshold = clamp(opts.threshold ?? 185, 60, 245)
  const minArea = clamp(opts.minArea ?? 12, 1, 4000)
  const closeRadius = clamp(opts.closeRadius ?? 2, 0, 6)
  const w = imageData.width
  const h = imageData.height
  const n = w * h
  const data = imageData.data

  // 1) luminance + smooth ink coverage (0..255) for anti-aliased line rendering
  const lum = new Uint8Array(n)
  const ink = new Uint8Array(n)
  const INK_LO = 50  // <= this is solid black line
  const INK_HI = 205 // >= this is clean paper
  for (let p = 0; p < n; p++) {
    const i = p * 4
    const l = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8
    lum[p] = l
    let a = (INK_HI - l) / (INK_HI - INK_LO)
    a = a < 0 ? 0 : a > 1 ? 1 : a
    ink[p] = Math.round(a * 255)
  }

  // 2) barrier mask = dark line pixels, then dilate to close gaps in the
  //    contour (open line art leaks across hairline gaps otherwise)
  let barrierD = new Uint8Array(n)
  for (let p = 0; p < n; p++) barrierD[p] = lum[p] < threshold ? 1 : 0
  for (let i = 0; i < closeRadius; i++) barrierD = dilate(barrierD, w, h)

  // 3) connected components over the fillable (non-barrier) pixels
  const regionMap = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  let regionCount = 0
  for (let s = 0; s < n; s++) {
    if (barrierD[s] || regionMap[s] !== -1) continue
    const id = regionCount++
    let sp = 0
    stack[sp++] = s
    regionMap[s] = id
    while (sp > 0) {
      const q = stack[--sp]
      const x = q % w, y = (q / w) | 0
      if (x > 0)     { const t = q - 1; if (!barrierD[t] && regionMap[t] === -1) { regionMap[t] = id; stack[sp++] = t } }
      if (x < w - 1) { const t = q + 1; if (!barrierD[t] && regionMap[t] === -1) { regionMap[t] = id; stack[sp++] = t } }
      if (y > 0)     { const t = q - w; if (!barrierD[t] && regionMap[t] === -1) { regionMap[t] = id; stack[sp++] = t } }
      if (y < h - 1) { const t = q + w; if (!barrierD[t] && regionMap[t] === -1) { regionMap[t] = id; stack[sp++] = t } }
    }
  }

  // 4) drop tiny speck regions (anti-alias noise, dotted screentones)
  const size = new Int32Array(regionCount)
  for (let p = 0; p < n; p++) if (regionMap[p] >= 0) size[regionMap[p]]++
  const keep = new Int32Array(regionCount).fill(-1)
  let finalCount = 0
  for (let r = 0; r < regionCount; r++) if (size[r] >= minArea) keep[r] = finalCount++
  for (let p = 0; p < n; p++) {
    const r = regionMap[p]
    regionMap[p] = r < 0 ? -1 : keep[r]
  }

  // 5) grow region labels under the ink lines so fills tuck neatly beneath the
  //    contour (no white halo). Each pass assigns an unlabeled pixel the label
  //    of a labeled 4-neighbour (smallest id wins → deterministic).
  growLabels(regionMap, w, h, closeRadius + 2)

  // 6) per-region pixel index lists (for fast fill + render)
  const finalSize = new Int32Array(finalCount)
  for (let p = 0; p < n; p++) { const r = regionMap[p]; if (r >= 0) finalSize[r]++ }
  const regionPixels = new Array(finalCount)
  for (let r = 0; r < finalCount; r++) regionPixels[r] = new Int32Array(finalSize[r])
  const cursor = new Int32Array(finalCount)
  for (let p = 0; p < n; p++) { const r = regionMap[p]; if (r >= 0) regionPixels[r][cursor[r]++] = p }

  return {
    width: w,
    height: h,
    regionCount: finalCount,
    regionMap,
    regionPixels,
    ink, // Uint8Array alpha 0..255 — the black contour, anti-aliased
    original: data, // the uploaded image (reference / peek)
  }
}

function dilate(mask, w, h) {
  const out = new Uint8Array(mask.length)
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) { out[p] = 1; continue }
    const x = p % w, y = (p / w) | 0
    if ((x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) ||
        (y > 0 && mask[p - w]) || (y < h - 1 && mask[p + w])) out[p] = 1
  }
  return out
}

function growLabels(label, w, h, iters) {
  for (let it = 0; it < iters; it++) {
    const snapshot = Int32Array.from(label)
    let changed = false
    for (let p = 0; p < label.length; p++) {
      if (snapshot[p] !== -1) continue
      const x = p % w, y = (p / w) | 0
      let best = -1
      if (x > 0)     { const v = snapshot[p - 1]; if (v >= 0 && (best < 0 || v < best)) best = v }
      if (x < w - 1) { const v = snapshot[p + 1]; if (v >= 0 && (best < 0 || v < best)) best = v }
      if (y > 0)     { const v = snapshot[p - w]; if (v >= 0 && (best < 0 || v < best)) best = v }
      if (y < h - 1) { const v = snapshot[p + w]; if (v >= 0 && (best < 0 || v < best)) best = v }
      if (best >= 0) { label[p] = best; changed = true }
    }
    if (!changed) break
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ---- rendering -------------------------------------------------------------

// Brush layer sentinels: BRUSH_NONE = no override (use region fill);
// BRUSH_ERASE = force paper here (manual eraser).
export const BRUSH_NONE = -1
export const BRUSH_ERASE = -2

// Resolve the base colour at pixel p: brush layer wins over region fill.
function baseAt(page, regionColor, brush, p, out) {
  const b = brush ? brush[p] : BRUSH_NONE
  if (b === BRUSH_ERASE) { out[0] = PAPER[0]; out[1] = PAPER[1]; out[2] = PAPER[2]; return }
  if (b >= 0) { out[0] = (b >> 16) & 255; out[1] = (b >> 8) & 255; out[2] = b & 255; return }
  const r = page.regionMap[p]
  const c = r >= 0 ? regionColor[r] : -1
  if (c >= 0) { out[0] = (c >> 16) & 255; out[1] = (c >> 8) & 255; out[2] = c & 255; return }
  out[0] = PAPER[0]; out[1] = PAPER[1]; out[2] = PAPER[2]
}

// Full render of a board: region fills + free-hand brush layer + ink on top.
export function renderBoard(page, regionColor, brush) {
  const { width: w, height: h, ink } = page
  const n = w * h
  const out = new ImageData(w, h)
  const d = out.data
  const c = [0, 0, 0]
  for (let p = 0; p < n; p++) {
    baseAt(page, regionColor, brush, p, c)
    const k = 1 - ink[p] / 255
    const i = p * 4
    d[i] = c[0] * k
    d[i + 1] = c[1] * k
    d[i + 2] = c[2] * k
    d[i + 3] = 255
  }
  return out
}

// Re-paint a specific set of pixels in-place (fast click / brush path).
export function paintPixels(imageData, page, regionColor, brush, pixels) {
  const d = imageData.data
  const ink = page.ink
  const c = [0, 0, 0]
  for (let idx = 0; idx < pixels.length; idx++) {
    const p = pixels[idx]
    baseAt(page, regionColor, brush, p, c)
    const k = 1 - ink[p] / 255
    const i = p * 4
    d[i] = c[0] * k
    d[i + 1] = c[1] * k
    d[i + 2] = c[2] * k
  }
}

// Backwards-compatible: render with region fills only (no brush layer).
export function renderPage(page, regionColor) {
  return renderBoard(page, regionColor, null)
}

// The uploaded image as ImageData (comparison reference + "peek original").
export function renderOriginal(page) {
  const out = new ImageData(page.width, page.height)
  out.data.set(page.original)
  return out
}
