'use strict';

const API_URL     = '/api/frets/calculate';
const STORAGE_KEY = 'fretCalcParams';
const MM_PER_IN   = 25.4;

// Dimension fields that need unit conversion (all stored/sent in mm)
const DIM_FIELDS = [
  { id: 'scaleLength',         mmMin: 100,   mmMax: 2000,  mmStep: 0.5,  inStep: 0.02  },
  { id: 'nutWidth',            mmMin: 10,    mmMax: null,  mmStep: 0.5,  inStep: 0.02  },
  { id: 'width12thFret',       mmMin: 10,    mmMax: null,  mmStep: 0.5,  inStep: 0.02  },
  { id: 'radiusValue',         mmMin: 50,    mmMax: 5000,  mmStep: 0.5,  inStep: 0.05  },
  { id: 'nutSlotWidth',        mmMin: 0.5,   mmMax: 15,    mmStep: 0.5,  inStep: 0.02  },
  { id: 'nutSlotDistance',     mmMin: -20,   mmMax: 0,     mmStep: 0.5,  inStep: 0.02  },
  { id: 'tangWidth',           mmMin: 0.1,   mmMax: 3.0,   mmStep: 0.01, inStep: 0.001 },
  { id: 'fretExtensionAmount', mmMin: -10,   mmMax: 20,    mmStep: 0.5,  inStep: 0.02  },
];
// inlaySize, inlayHeight, inlayDoubleOffset are mm-fixed range sliders — not in DIM_FIELDS.

const PRESETS = [
  { name: 'Classical Guitar (650 mm)',       scaleLength: 650, nutWidth: 52, width12thFret: 60, numberOfFrets: 19, radius: 0   },
  { name: 'Electric Guitar 25.5" (648 mm)',  scaleLength: 648, nutWidth: 42, width12thFret: 52, numberOfFrets: 22, radius: 184 },
  { name: 'Electric Guitar 24.75" (628 mm)', scaleLength: 628, nutWidth: 42, width12thFret: 52, numberOfFrets: 22, radius: 305 },
  { name: 'Electric Guitar 25" (635 mm)',    scaleLength: 635, nutWidth: 42, width12thFret: 52, numberOfFrets: 22, radius: 254 },
  { name: 'Bass Guitar 34" (864 mm)',        scaleLength: 864, nutWidth: 42, width12thFret: 55, numberOfFrets: 20, radius: 305 },
  { name: 'Bass Guitar 30" (762 mm)',        scaleLength: 762, nutWidth: 40, width12thFret: 53, numberOfFrets: 20, radius: 254 },
  { name: 'Ukulele Soprano (345 mm)',        scaleLength: 345, nutWidth: 35, width12thFret: 42, numberOfFrets: 14, radius: 0   },
  { name: 'Mandolin (350 mm)',               scaleLength: 350, nutWidth: 34, width12thFret: 40, numberOfFrets: 17, radius: 0   },
  { name: 'Violin (330 mm)',                 scaleLength: 330, nutWidth: 24, width12thFret: 30, numberOfFrets: 0,  radius: 0   },
];

let lastResponse = null;
let debounceTimer = null;
let prevUnit = 'mm';

let currentInlayPresetId = 'circle';
let inlayPresets         = [];

// ── Cross-tab sync to Fretboard Lighting ──────────────────────
const LIGHTING_SYNC_KEY = 'luthertools-lighting-sync';
let lightingSyncChannel = null;
try { lightingSyncChannel = new BroadcastChannel('luthertools-sync'); } catch (_) {}

function publishLightingSync() {
  try {
    const req = buildRequest();
    const payload = {
      scaleLength:       req.scaleLength,
      numberOfFrets:     req.numberOfFrets,
      nutWidth:          req.nutWidth,
      width12thFret:     req.width12thFret,
      inlayDoubleOffset: req.inlayDoubleOffset,
      showInlays:        req.showInlays,
      doubleInlays:      req.doubleInlays,
      inlayPosition:     req.inlayPosition,
      inlaySize:         req.inlaySize,
    };
    localStorage.setItem(LIGHTING_SYNC_KEY, JSON.stringify(payload));
    if (lightingSyncChannel) lightingSyncChannel.postMessage(payload);
  } catch (_) {}
}

// ── Initialisation ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadInlayPresets();
  populatePresets();
  M.Sidenav.init(document.querySelectorAll('.sidenav'));
  M.Collapsible.init(document.getElementById('inputSections'), {
    accordion: true,
    onOpenEnd: saveState,
    onCloseEnd: saveState,
  });
  M.FormSelect.init(document.querySelectorAll('select'));
  M.Dropdown.init(document.querySelectorAll('.dropdown-trigger'), {
    constrainWidth: false,
    coverTrigger: false,
    alignment: 'left',
  });

  restoreState();
  M.updateTextFields();
  updateUnitHints();
  updateShapeFields();

  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('input', scheduleCalculate);
  });

  bindDimSlider('inlaySize',          'inlaySizeVal');
  bindDimSlider('inlayHeight',        'inlayHeightVal');
  bindDimSlider('inlayDoubleOffset',  'inlayDoubleOffsetVal');
  bindSlider('inlayShrinkWidth1224',  'inlayShrinkWidth1224Val');
  bindSlider('inlayShrinkHeight1224', 'inlayShrinkHeight1224Val');
  bindSlider('inlayShrinkWidth',    'inlayShrinkWidthVal');
  bindSlider('inlayGrowHeight',     'inlayGrowHeightVal');
  bindSlider('inlayTrapezoid',      'inlayTrapezoidVal');
  bindSlider('inlayParallelogram',  'inlayParallelogramVal');
  snapToZeroOnDblClick('inlayShrinkWidth1224',  'inlayShrinkWidth1224Val');
  snapToZeroOnDblClick('inlayShrinkHeight1224', 'inlayShrinkHeight1224Val');
  snapToZeroOnDblClick('inlayShrinkWidth',   'inlayShrinkWidthVal');
  snapToZeroOnDblClick('inlayGrowHeight',    'inlayGrowHeightVal');
  snapToZeroOnDblClick('inlayTrapezoid',     'inlayTrapezoidVal');
  snapToZeroOnDblClick('inlayParallelogram', 'inlayParallelogramVal');
  refreshDimSliderDisplays();

  document.getElementById('unit').addEventListener('change', onUnitSwitch);
  document.getElementById('preset').addEventListener('change', applyPreset);

  ['showFretNumbers','showCenterLine','showWidthAnnotations',
   'showInlays','doubleInlays','showBoundingBox','showRadius',
   'showNutSlot','showPinholes'].forEach(id => {
    document.getElementById(id).addEventListener('change', scheduleCalculate);
  });

  document.getElementById('radiusPreset').addEventListener('change', () => {
    const mmVal = document.getElementById('radiusPreset').value;
    if (mmVal !== '') {
      const unit = document.getElementById('unit').value;
      const displayVal = unit === 'inch'
        ? (parseFloat(mmVal) / MM_PER_IN).toFixed(4)
        : mmVal;
      document.getElementById('radiusValue').value = displayVal;
      M.updateTextFields();
    }
    scheduleCalculate();
  });

  document.getElementById('inlayPreset').addEventListener('change', function () {
    currentInlayPresetId = this.value;
    updateShapeFields();
    scheduleCalculate();
  });
  document.getElementById('inlayPosition').addEventListener('change', scheduleCalculate);
  document.getElementById('inlayDoubleOrientation').addEventListener('change', scheduleCalculate);

  const cpCanvas = document.getElementById('customPathCanvas');
  cpCanvas.addEventListener('mousedown',   customPathMouseDown);
  cpCanvas.addEventListener('mousemove',   customPathMouseMove);
  cpCanvas.addEventListener('mouseup',     customPathMouseUp);
  cpCanvas.addEventListener('mouseleave',  () => { customPathDrag = null; });
  cpCanvas.addEventListener('contextmenu', customPathContextMenu);
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey) { customPathCmdHeld = true; customPathUpdateCursor(); }
  });
  document.addEventListener('keyup', e => {
    if (!e.metaKey && !e.ctrlKey) { customPathCmdHeld = false; customPathUpdateCursor(); }
  });

  // SVG import — file input + drag-and-drop on canvas
  const cpFileInput = document.getElementById('customPathFileInput');
  cpFileInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) { const r = new FileReader(); r.onload = ev => customPathImportSvg(ev.target.result); r.readAsText(f); }
    cpFileInput.value = '';
  });
  cpCanvas.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  cpCanvas.addEventListener('drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.type === 'image/svg+xml' || f.name.endsWith('.svg'))) {
      const r = new FileReader(); r.onload = ev => customPathImportSvg(ev.target.result); r.readAsText(f);
    }
  });

  customPathRedraw();

  saveState();
  calculate();
});

// ── Presets ───────────────────────────────────────────────────
function populatePresets() {
  const sel = document.getElementById('preset');
  PRESETS.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
}

async function loadInlayPresets() {
  try {
    const res = await fetch('/api/frets/inlay-presets');
    if (!res.ok) throw new Error();
    inlayPresets = await res.json();
  } catch (_) {
    inlayPresets = [{ id: 'circle', name: 'Circle' }];
  }
  const sel = document.getElementById('inlayPreset');
  inlayPresets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  sel.value = currentInlayPresetId;
}

function applyPreset() {
  const idx = parseInt(document.getElementById('preset').value, 10);
  if (isNaN(idx)) return;
  const p = PRESETS[idx];
  const unit = document.getElementById('unit').value;
  const fromMm = v => unit === 'inch' ? (v / MM_PER_IN).toFixed(4) : v;
  document.getElementById('scaleLength').value   = fromMm(p.scaleLength);
  document.getElementById('numberOfFrets').value = p.numberOfFrets;
  document.getElementById('nutWidth').value       = fromMm(p.nutWidth);
  document.getElementById('width12thFret').value  = fromMm(p.width12thFret);
  if (p.radius !== undefined) {
    document.getElementById('radiusValue').value = fromMm(p.radius);
    const rpEl = document.getElementById('radiusPreset');
    rpEl.value = String(p.radius);
    M.FormSelect.init(rpEl);
  }
  M.updateTextFields();
  calculate();
}

// ── Unit switching ────────────────────────────────────────────
function onUnitSwitch() {
  const unit = document.getElementById('unit').value;
  if (unit === prevUnit) return;
  const toIn = unit === 'inch';
  DIM_FIELDS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = parseFloat(el.value);
    if (!isNaN(v)) {
      el.value = toIn ? (v / MM_PER_IN).toFixed(4) : (v * MM_PER_IN).toFixed(2);
    }
  });
  updateInputConstraints(unit);
  prevUnit = unit;
  updateUnitHints();
  refreshDimSliderDisplays();
  M.updateTextFields();
  scheduleCalculate();
}

function updateInputConstraints(unit) {
  const toIn = unit === 'inch';
  DIM_FIELDS.forEach(({ id, mmMin, mmMax, mmStep, inStep }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.min  = mmMin != null ? (toIn ? (mmMin / MM_PER_IN).toFixed(4) : mmMin) : '';
    el.max  = mmMax != null ? (toIn ? (mmMax / MM_PER_IN).toFixed(4) : mmMax) : '';
    el.step = toIn ? inStep : mmStep;
  });
}

function updateUnitHints() {
  const unit = document.getElementById('unit').value;
  const label = unit === 'inch' ? 'in' : 'mm';
  document.querySelectorAll('.unit-hint').forEach(el => el.textContent = label);
  document.querySelectorAll('.range-hint').forEach(el => {
    el.textContent = unit === 'inch' ? el.dataset.inch : el.dataset.mm;
  });
}

// ── Slider helpers ────────────────────────────────────────────
function bindSlider(id, valId) {
  const el = document.getElementById(id), valEl = document.getElementById(valId);
  el.addEventListener('input', () => { valEl.textContent = parseFloat(el.value).toFixed(2); scheduleCalculate(); });
}

// ── Custom inlay polygon editor ──────────────────────────────
// customPathPoints holds segments (not just points). Each entry is a flat array:
//   length 2 -> [x, y]               (first entry: start point, otherwise: line to)
//   length 4 -> [cx, cy, x, y]       (quadratic Bezier: control + end)
// All coords are normalized to [0, 1]. Clicking near the first vertex (≥3 segments)
// closes the path. In Arc mode, two clicks define a quadratic segment: click 1 sets
// the control handle (shown in orange), click 2 sets the end point.
//
// Mouse interaction:
//   - Click empty area: add a line vertex (Line mode) or a Q segment whose control
//     starts on the midpoint (Arc mode) — drag the control square to shape it later
//   - Click near first vertex (≥3 segs): close gesture
//   - Click on an existing edge: insert vertex (or convert L→Q in Arc mode)
//   - Drag a vertex / control point: move it
//   - Shift-drag anywhere: translate the whole polygon
//   - Right-click or Shift-click a vertex: delete that segment
//   - Right-click or Shift-click a control point of a Q segment: drop it (Q → L)
let customPathPoints = [];
let customPathArcMode = false;
let customPathClosed = true;   // true → render filled closed area; false → open lines only
let customPathDrag = null;     // { mode, target, downXn, downYn, moved, ... }
let customPathCmdHeld = false; // true while Cmd (Mac) or Ctrl (Win) is pressed
const CUSTOM_PATH_VB         = 100;
const CUSTOM_PATH_MARGIN     = 30;                                      // extra VB units outside the window on each side
const CUSTOM_PATH_CANVAS_VB  = CUSTOM_PATH_VB + 2 * CUSTOM_PATH_MARGIN; // 160 — total canvas VB width/height
const CUSTOM_PATH_SNAP_DIST = 6;
// Point-hit is intentionally bigger than segment-hit so clicks just outside a vertex's
// visible circle still latch onto the vertex (drag intent) rather than landing on the
// segment line that touches it and inserting a stray vertex.
const CUSTOM_PATH_POINT_HIT_RADIUS    = 5;
const CUSTOM_PATH_SEGMENT_HIT_RADIUS  = 3;
// Wider "missed drag" radius used at mouseup time to suppress click-add / segment-insert
// when the click is close to any point. Helpful for Q segments whose curve passes very
// near an endpoint — without this, clicks within ~5–8 vb of an endpoint land on the
// curve and silently insert a (de Casteljau) vertex that doesn't change the shape.
const CUSTOM_PATH_NEAR_POINT_RADIUS   = 8;
const CUSTOM_PATH_HIT_RADIUS = CUSTOM_PATH_POINT_HIT_RADIUS;     // back-compat alias
const CUSTOM_PATH_DRAG_THRESHOLD  = 1.5; // viewBox units of movement before a drag actually starts
const CUSTOM_PATH_CLICK_THRESHOLD = 0.8; // movement above this turns a release into a no-op (was a missed drag, not a click)

function customPathSegEnd(seg) {
  return seg.length === 2 ? [seg[0], seg[1]]
       : seg.length === 4 ? [seg[2], seg[3]]
       : seg.length === 6 ? [seg[4], seg[5]]
       : [0, 0];
}

function customPathEventPos(evt) {
  const svg  = document.getElementById('customPathCanvas');
  const rect = svg.getBoundingClientRect();
  // Map mouse into the extended viewBox space (origin at -MARGIN, total = CANVAS_VB)
  const xv = ((evt.clientX - rect.left) / rect.width)  * CUSTOM_PATH_CANVAS_VB - CUSTOM_PATH_MARGIN;
  const yv = ((evt.clientY - rect.top)  / rect.height) * CUSTOM_PATH_CANVAS_VB - CUSTOM_PATH_MARGIN;
  const ext = (CUSTOM_PATH_MARGIN / CUSTOM_PATH_VB) + 0.05; // ~0.35
  return {
    xn: Math.max(-ext, Math.min(1 + ext, xv / CUSTOM_PATH_VB)),
    yn: Math.max(-ext, Math.min(1 + ext, yv / CUSTOM_PATH_VB)),
  };
}

// Build the list of editable points (vertices + control points) for hit testing.
// Each target carries the segment index and the byte-offset where its [x, y] lives.
function customPathHitTargets() {
  const out = [];
  customPathPoints.forEach((seg, i) => {
    if (seg.length === 2) {
      out.push({ kind: 'vertex', segIndex: i, coordOffset: 0, x: seg[0], y: seg[1] });
    } else if (seg.length === 4) {
      out.push({ kind: 'cp',     segIndex: i, coordOffset: 0, x: seg[0], y: seg[1] });
      out.push({ kind: 'vertex', segIndex: i, coordOffset: 2, x: seg[2], y: seg[3] });
    } else if (seg.length === 6) {
      out.push({ kind: 'cp',     segIndex: i, coordOffset: 0, x: seg[0], y: seg[1] });
      out.push({ kind: 'cp',     segIndex: i, coordOffset: 2, x: seg[2], y: seg[3] });
      out.push({ kind: 'vertex', segIndex: i, coordOffset: 4, x: seg[4], y: seg[5] });
    }
  });
  return out;
}

// Distance from point (px, py) to line segment (x0, y0)–(x1, y1). Returns { dist, t }.
function customPathDistToLine(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  const cx = x0 + t * dx, cy = y0 + t * dy;
  return { dist: Math.sqrt((px - cx) ** 2 + (py - cy) ** 2), t };
}

// Approximate distance to a quadratic Bezier by sampling 24 segments along it.
function customPathDistToQuad(px, py, x0, y0, cx, cy, x1, y1) {
  let best = { dist: Infinity, t: 0 };
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const d = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
    if (d < best.dist) best = { dist: d, t };
  }
  return best;
}

// Hit-test against segment edges (lines + curves). Returns { segIndex, t, prev } or null.
function customPathSegmentHit(xn, yn) {
  let best = null;
  let bestDist = CUSTOM_PATH_SEGMENT_HIT_RADIUS;
  for (let i = 1; i < customPathPoints.length; i++) {
    const prev = customPathSegEnd(customPathPoints[i - 1]);
    const seg  = customPathPoints[i];
    let r;
    if (seg.length === 2) {
      r = customPathDistToLine(xn, yn, prev[0], prev[1], seg[0], seg[1]);
    } else if (seg.length === 4) {
      r = customPathDistToQuad(xn, yn, prev[0], prev[1], seg[0], seg[1], seg[2], seg[3]);
    } else continue;
    const dVb = r.dist * CUSTOM_PATH_VB;
    if (dVb < bestDist) {
      bestDist = dVb;
      best = { segIndex: i, t: r.t, prev };
    }
  }
  // Also test the implicit closing edge (the SVG Z line from the last endpoint back
  // to the start). It isn't a segment in the data model, so we flag the hit with
  // isClosing and handle it specially in the click path.
  if (customPathPoints.length >= 3) {
    const last  = customPathSegEnd(customPathPoints[customPathPoints.length - 1]);
    const start = customPathPoints[0];
    const r = customPathDistToLine(xn, yn, last[0], last[1], start[0], start[1]);
    const dVb = r.dist * CUSTOM_PATH_VB;
    if (dVb < bestDist) {
      bestDist = dVb;
      best = { segIndex: -1, t: r.t, prev: last, isClosing: true };
    }
  }
  return best;
}

// Insert a new vertex on the segment that was hit. Splits L→L+L or Q→Q+Q via de Casteljau.
function customPathInsertOnSegment(hit, xn, yn) {
  const i    = hit.segIndex;
  const prev = hit.prev;
  const seg  = customPathPoints[i];
  const t    = hit.t;

  if (seg.length === 2) {
    customPathPoints.splice(i, 0, [xn, yn]);
  } else if (seg.length === 4) {
    const p0 = prev;
    const p1 = [seg[0], seg[1]];
    const p2 = [seg[2], seg[3]];
    const u  = 1 - t;
    const q0 = [u * p0[0] + t * p1[0], u * p0[1] + t * p1[1]];
    const q1 = [u * p1[0] + t * p2[0], u * p1[1] + t * p2[1]];
    const r  = [u * q0[0] + t * q1[0], u * q0[1] + t * q1[1]];
    customPathPoints.splice(i, 1,
      [q0[0], q0[1], r[0], r[1]],
      [q1[0], q1[1], p2[0], p2[1]]
    );
  }
}

// Vertices win ties over control points (so a vertex on top of a cp is grabbed first).
function customPathHitTest(xn, yn) {
  let best = null;
  let bestDist = CUSTOM_PATH_POINT_HIT_RADIUS;
  for (const t of customPathHitTargets()) {
    const dx = (t.x - xn) * CUSTOM_PATH_VB;
    const dy = (t.y - yn) * CUSTOM_PATH_VB;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d > bestDist) continue;
    if (best === null || (t.kind === 'vertex' && best.kind !== 'vertex') || d < bestDist - 0.5) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

function customPathDeleteTarget(target) {
  const i = target.segIndex;
  if (target.kind === 'cp') {
    const seg = customPathPoints[i];
    if (seg.length === 4) {
      customPathPoints[i] = [seg[2], seg[3]]; // Q → L
    } else if (seg.length === 6) {
      customPathPoints[i] = (target.coordOffset === 0)
        ? [seg[2], seg[3], seg[4], seg[5]]    // C without c1 → Q with c2
        : [seg[0], seg[1], seg[4], seg[5]];   // C without c2 → Q with c1
    }
  } else {
    if (i === 0) {
      // Promote next segment's endpoint to the new start
      if (customPathPoints.length === 1) {
        customPathPoints = [];
      } else {
        const next = customPathPoints[1];
        const newStart = customPathSegEnd(next);
        customPathPoints[0] = [newStart[0], newStart[1]];
        customPathPoints.splice(1, 1);
      }
    } else {
      customPathPoints.splice(i, 1);
    }
  }
}

function customPathClick(evt) {
  const { xn: x, yn: y } = customPathEventPos(evt);

  if (customPathPoints.length === 0) {
    customPathPoints.push([x, y]);
    customPathRedraw();
    scheduleCalculate();
    return;
  }

  // Click on existing edge: in Line mode (or on a Q segment) split it and insert a vertex.
  // In Arc mode on an L segment, promote it to a Q with the click as the control point.
  // Cmd/Ctrl+click toggles L↔Q regardless of mode (no vertex inserted).
  // Checked BEFORE the close-to-start gesture so the first edge (which starts at the
  // start vertex) doesn't get swallowed by the close-snap radius.
  const segHit = customPathSegmentHit(x, y);
  if (segHit) {
    const cmd = evt.metaKey || evt.ctrlKey;
    if (cmd) {
      if (segHit.isClosing) {
        // Closing edge is always a straight Z — Cmd+click adds a Q arc on it.
        customPathPoints.push([x, y, customPathPoints[0][0], customPathPoints[0][1]]);
      } else {
        const seg = customPathPoints[segHit.segIndex];
        if (seg.length === 2) {
          // L → Q: click position becomes the control handle.
          customPathPoints[segHit.segIndex] = [x, y, seg[0], seg[1]];
        } else if (seg.length === 4) {
          // Q → L: drop the control point.
          customPathPoints[segHit.segIndex] = [seg[2], seg[3]];
        }
        // Cubic (length 6): no-op — Cmd+click on a cubic is ignored.
      }
      customPathRedraw();
      scheduleCalculate();
      return;
    }
    if (segHit.isClosing) {
      // Click on the implicit closing edge (last endpoint → start).
      // Line mode: insert a vertex — the closing line is split in two.
      // Arc mode: turn the closing edge into a Q whose endpoint is the start, with
      //   the click as its control handle. Adds a bezier handle on the line — no new
      //   vertex; the user can drag the new control square afterwards to shape it.
      if (customPathArcMode) {
        customPathPoints.push([x, y, customPathPoints[0][0], customPathPoints[0][1]]);
      } else {
        customPathPoints.push([x, y]);
      }
    } else {
      const seg = customPathPoints[segHit.segIndex];
      if (customPathArcMode && seg.length === 2) {
        // Convert this L into a Q with the click as its control handle. No vertex
        // is inserted — endpoints stay where they were.
        customPathPoints[segHit.segIndex] = [x, y, seg[0], seg[1]];
      } else {
        customPathInsertOnSegment(segHit, x, y);
      }
    }
    customPathRedraw();
    scheduleCalculate();
    return;
  }

  if (customPathArcMode) {
    // Place the control point on the midpoint of the line from the previous endpoint
    // to the click — the curve initially looks like a straight line, and the user can
    // drag the new control square afterwards to shape it.
    const prev = customPathSegEnd(customPathPoints[customPathPoints.length - 1]);
    const cpx  = (prev[0] + x) / 2;
    const cpy  = (prev[1] + y) / 2;
    customPathPoints.push([cpx, cpy, x, y]);
  } else {
    customPathPoints.push([x, y]);
  }
  customPathRedraw();
  scheduleCalculate();
}

function customPathMouseDown(evt) {
  // Right-click → delete on hit
  if (evt.button === 2) {
    evt.preventDefault();
    const { xn, yn } = customPathEventPos(evt);
    const hit = customPathHitTest(xn, yn);
    if (hit) {
      customPathDeleteTarget(hit);
      customPathRedraw();
      scheduleCalculate();
    }
    return;
  }
  if (evt.button !== 0) return;

  const { xn, yn } = customPathEventPos(evt);

  // Shift-drag → translate the entire polygon (snapshot positions + bbox for clean delta math)
  if (evt.shiftKey) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const seg of customPathPoints) {
      for (let k = 0; k < seg.length; k += 2) {
        if (seg[k]     < minX) minX = seg[k];
        if (seg[k]     > maxX) maxX = seg[k];
        if (seg[k + 1] < minY) minY = seg[k + 1];
        if (seg[k + 1] > maxY) maxY = seg[k + 1];
      }
    }
    customPathDrag = {
      mode:    'translate',
      downXn:  xn,
      downYn:  yn,
      moved:   false,
      original: customPathPoints.map(seg => seg.slice()),
      origBBox: { minX, minY, maxX, maxY },
    };
    return;
  }

  customPathDrag = {
    mode:   'point',
    target: customPathHitTest(xn, yn),
    downXn: xn,
    downYn: yn,
    moved:  false,
  };
}

let _customPathLastXn = -1, _customPathLastYn = -1;
function customPathUpdateCursor() {
  if (_customPathLastXn < 0 || customPathDrag) return;
  const svg = document.getElementById('customPathCanvas');
  if (!svg) return;
  const ptHit = customPathHitTest(_customPathLastXn, _customPathLastYn);
  if (ptHit) { svg.style.cursor = 'grab'; return; }
  if (customPathPoints.length >= 1 && customPathSegmentHit(_customPathLastXn, _customPathLastYn)) {
    svg.style.cursor = customPathCmdHeld ? 'pointer' : 'cell';
  } else {
    svg.style.cursor = 'crosshair';
  }
}

function customPathMouseMove(evt) {
  const svg = document.getElementById('customPathCanvas');
  const { xn, yn } = customPathEventPos(evt);
  _customPathLastXn = xn;
  _customPathLastYn = yn;

  if (!customPathDrag) {
    // Hover cursor: Shift-hover signals "translate" if there's a path to move.
    if (evt.shiftKey && customPathPoints.length > 0) {
      svg.style.cursor = 'move';
    } else {
      const ptHit = customPathHitTest(xn, yn);
      if (ptHit) {
        svg.style.cursor = 'grab';
      } else if (customPathPoints.length >= 1 && customPathSegmentHit(xn, yn)) {
        // Cmd/Ctrl held over a segment → pointer signals "toggle L↔Q" instead of insert
        svg.style.cursor = customPathCmdHeld ? 'pointer' : 'cell';
      } else {
        svg.style.cursor = 'crosshair';
      }
    }
    return;
  }

  const dxN  = xn - customPathDrag.downXn;
  const dyN  = yn - customPathDrag.downYn;
  const dist = Math.sqrt(dxN * dxN + dyN * dyN) * CUSTOM_PATH_VB;
  if (dist > (customPathDrag.maxDist || 0)) customPathDrag.maxDist = dist;
  if (!customPathDrag.moved && dist > CUSTOM_PATH_DRAG_THRESHOLD) {
    customPathDrag.moved = true;
  }
  if (!customPathDrag.moved) return;

  if (customPathDrag.mode === 'translate') {
    svg.style.cursor = 'grabbing';
    const orig = customPathDrag.original;
    // Constrain the translation delta so the polygon's bounding box stays within
    // [0, 1]. Clamping each point independently (the previous behavior) deformed
    // the shape when individual points hit the canvas edge.
    const bb = customPathDrag.origBBox;
    const cdx = Math.max(-bb.minX, Math.min(1 - bb.maxX, dxN));
    const cdy = Math.max(-bb.minY, Math.min(1 - bb.maxY, dyN));
    for (let i = 0; i < orig.length; i++) {
      const o = orig[i];
      const next = o.slice();
      for (let k = 0; k < o.length; k += 2) {
        next[k]     = o[k]     + cdx;
        next[k + 1] = o[k + 1] + cdy;
      }
      customPathPoints[i] = next;
    }
    customPathRedraw();
    return;
  }

  // mode === 'point'
  if (customPathDrag.target) {
    svg.style.cursor = 'grabbing';
    const t = customPathDrag.target;
    const oldX = customPathPoints[t.segIndex][t.coordOffset];
    const oldY = customPathPoints[t.segIndex][t.coordOffset + 1];
    customPathPoints[t.segIndex][t.coordOffset]     = xn;
    customPathPoints[t.segIndex][t.coordOffset + 1] = yn;
    // Closed-via-arc paths have a final Q whose endpoint is the start coords. When the
    // user drags the start vertex, sync any matching segment endpoints so the closing
    // edge follows along instead of leaving a stranded white dot at the old start spot.
    if (t.segIndex === 0 && t.coordOffset === 0) {
      const eps = 0.0005;
      for (let i = 1; i < customPathPoints.length; i++) {
        const seg = customPathPoints[i];
        const endOff = seg.length - 2;
        if (endOff >= 0
            && Math.abs(seg[endOff]     - oldX) < eps
            && Math.abs(seg[endOff + 1] - oldY) < eps) {
          seg[endOff]     = xn;
          seg[endOff + 1] = yn;
        }
      }
    }
    customPathRedraw();
  }
}

function customPathMouseUp(evt) {
  if (!customPathDrag) return;
  const drag = customPathDrag;
  customPathDrag = null;

  if (drag.moved) {
    scheduleCalculate();
    return;
  }

  // Shift-press without a drag → treat as a no-op (avoids a foot-gun where releasing
  // without moving would, say, delete a point you were about to translate).
  if (drag.mode === 'translate') return;

  // No drag — treat as click
  if (drag.target) {
    // Tap on existing point: only the start vertex has the close gesture
    if (drag.target.kind === 'vertex' && drag.target.segIndex === 0
        && customPathPoints.length >= 3) {
      customPathRedraw();
      scheduleCalculate();
    }
    return;
  }

  // Suppress accidental adds: if the cursor wobbled more than the click threshold,
  // assume the user was trying to drag a nearby point but missed the hit radius.
  if ((drag.maxDist || 0) > CUSTOM_PATH_CLICK_THRESHOLD) return;

  // Wider drag-intent suppression: if the click is close to any vertex/cp (beyond
  // the strict point-hit radius), treat it as a missed drag instead of a click.
  // This stops curves that pass near an endpoint from absorbing intended grabs.
  // The close-to-start gesture (≥3 segments) takes priority before this filter.
  const { xn, yn } = customPathEventPos(evt);
  if (customPathPoints.length >= 3) {
    const [sx, sy] = customPathPoints[0];
    const dxs = (sx - xn) * CUSTOM_PATH_VB;
    const dys = (sy - yn) * CUSTOM_PATH_VB;
    if (Math.sqrt(dxs * dxs + dys * dys) <= CUSTOM_PATH_SNAP_DIST) {
      customPathRedraw();
      scheduleCalculate();
      return;
    }
  }
  const nearR2 = CUSTOM_PATH_NEAR_POINT_RADIUS * CUSTOM_PATH_NEAR_POINT_RADIUS;
  for (const t of customPathHitTargets()) {
    const dx = (t.x - xn) * CUSTOM_PATH_VB;
    const dy = (t.y - yn) * CUSTOM_PATH_VB;
    if (dx * dx + dy * dy < nearR2) return;
  }

  customPathClick(evt);
}

function customPathContextMenu(evt) {
  evt.preventDefault();
}

function customPathRedraw() {
  const svg = document.getElementById('customPathCanvas');
  if (!svg) return;
  const modeBtn = document.getElementById('customPathModeBtn');
  if (modeBtn) {
    const icon = customPathArcMode ? 'gesture' : 'horizontal_rule';
    modeBtn.innerHTML = `<i class="material-icons" style="font-size:14px;line-height:14px;vertical-align:middle">${icon}</i>`;
    modeBtn.title = customPathArcMode ? 'Arc segments' : 'Line segments';
    modeBtn.style.background  = customPathArcMode ? '#fff3e0' : '#e8f5e9';
    modeBtn.style.color       = customPathArcMode ? '#e65100' : '#2e7d32';
    modeBtn.style.borderColor = customPathArcMode ? '#ffe0b2' : '#c8e6c9';
  }
  const closedBtn = document.getElementById('customPathClosedBtn');
  if (closedBtn) {
    const icon = customPathClosed ? 'category' : 'polyline';
    closedBtn.innerHTML = `<i class="material-icons" style="font-size:14px;line-height:14px;vertical-align:middle">${icon}</i>`;
    closedBtn.title = customPathClosed ? 'Closed (filled area)' : 'Open (lines only)';
    closedBtn.style.background  = customPathClosed ? '#e3f2fd' : '#fff';
    closedBtn.style.color       = customPathClosed ? '#0277bd' : '#455a64';
    closedBtn.style.borderColor = customPathClosed ? '#bbdefb' : '#cfd8dc';
  }

  // Background: gray outside area already set by CSS; white window rect + border
  const M  = CUSTOM_PATH_MARGIN;
  const VB = CUSTOM_PATH_VB;
  const background = [
    // white fill inside window
    `<rect x="0" y="0" width="${VB}" height="${VB}" fill="white"/>`,
    // grid lines (inside window only)
    ...[25, 50, 75].flatMap(g => [
      `<line x1="${g}" y1="0" x2="${g}" y2="${VB}" stroke="#eceff1" stroke-width="0.4"/>`,
      `<line x1="0" y1="${g}" x2="${VB}" y2="${g}" stroke="#eceff1" stroke-width="0.4"/>`,
    ]),
    // dashed window border
    `<rect x="0" y="0" width="${VB}" height="${VB}" fill="none" stroke="#90caf9" stroke-width="0.6" stroke-dasharray="2,2"/>`,
    // clip path used by the shape preview
    `<clipPath id="cpwin"><rect x="0" y="0" width="${VB}" height="${VB}"/></clipPath>`,
  ];

  let d = '';
  if (customPathPoints.length >= 1) {
    const [sx, sy] = customPathPoints[0];
    d = `M ${sx * CUSTOM_PATH_VB} ${sy * CUSTOM_PATH_VB}`;
    for (let i = 1; i < customPathPoints.length; i++) {
      const seg = customPathPoints[i];
      if (seg.length === 2) {
        d += ` L ${seg[0] * CUSTOM_PATH_VB} ${seg[1] * CUSTOM_PATH_VB}`;
      } else if (seg.length === 4) {
        d += ` Q ${seg[0] * CUSTOM_PATH_VB} ${seg[1] * CUSTOM_PATH_VB}`
           + ` ${seg[2] * CUSTOM_PATH_VB} ${seg[3] * CUSTOM_PATH_VB}`;
      } else if (seg.length === 6) {
        d += ` C ${seg[0] * CUSTOM_PATH_VB} ${seg[1] * CUSTOM_PATH_VB}`
           + ` ${seg[2] * CUSTOM_PATH_VB} ${seg[3] * CUSTOM_PATH_VB}`
           + ` ${seg[4] * CUSTOM_PATH_VB} ${seg[5] * CUSTOM_PATH_VB}`;
      }
    }
  }

  let shape = '';
  if (customPathClosed && customPathPoints.length >= 3) {
    shape = `<path d="${d} Z" fill="#bbdefb" fill-opacity="0.5" stroke="#0277bd" stroke-width="0.6" clip-path="url(#cpwin)"/>`;
  } else if (customPathPoints.length >= 1) {
    shape = `<path d="${d}" fill="none" stroke="#0277bd" stroke-width="0.6" clip-path="url(#cpwin)"/>`;
  }

  // Vertices (segment endpoints). Non-start vertices first, start last so it always
  // wins the z-order — needed because a closed-via-arc path may have a Q whose endpoint
  // sits exactly on the start coords, and a white circle drawn after a blue one would
  // otherwise hide the start.
  let verts = '';
  for (let i = 1; i < customPathPoints.length; i++) {
    const [vx, vy] = customPathSegEnd(customPathPoints[i]);
    verts += `<circle cx="${vx * CUSTOM_PATH_VB}" cy="${vy * CUSTOM_PATH_VB}" r="1.6" fill="#fff" stroke="#0277bd" stroke-width="0.6"/>`;
  }
  if (customPathPoints.length > 0) {
    const [sx, sy] = customPathPoints[0];
    verts += `<circle cx="${sx * CUSTOM_PATH_VB}" cy="${sy * CUSTOM_PATH_VB}" r="1.6" fill="#0277bd" stroke="#0277bd" stroke-width="0.6"/>`;
  }

  // Control points of committed Q/C segments — small grey marks + handle line
  const cps = customPathPoints.map((seg, i) => {
    if (seg.length !== 4 || i === 0) return '';
    const prevEnd = customPathSegEnd(customPathPoints[i - 1]);
    const cx = seg[0] * CUSTOM_PATH_VB;
    const cy = seg[1] * CUSTOM_PATH_VB;
    const ex = seg[2] * CUSTOM_PATH_VB;
    const ey = seg[3] * CUSTOM_PATH_VB;
    return `<line x1="${prevEnd[0] * CUSTOM_PATH_VB}" y1="${prevEnd[1] * CUSTOM_PATH_VB}" x2="${cx}" y2="${cy}" stroke="#cfd8dc" stroke-width="0.3" stroke-dasharray="1,1"/>`
         + `<line x1="${ex}" y1="${ey}" x2="${cx}" y2="${cy}" stroke="#cfd8dc" stroke-width="0.3" stroke-dasharray="1,1"/>`
         + `<rect x="${cx - 1.2}" y="${cy - 1.2}" width="2.4" height="2.4" fill="#fff" stroke="#9e9e9e" stroke-width="0.5"/>`;
  }).join('');

  svg.innerHTML = background.join('') + shape + cps + verts;
}

function customPathToggleMode() {
  customPathArcMode = !customPathArcMode;
  customPathRedraw();
}

function customPathToggleClosed() {
  customPathClosed = !customPathClosed;
  customPathRedraw();
  scheduleCalculate();
}

function customPathClear() {
  customPathPoints = [];
  customPathRedraw();
  scheduleCalculate();
}

// Rotate the entire polygon around its bounding-box centre.
// Default click = +15° (CW); Shift-click via the wrapping handler passes -15°.
function customPathRotate(degrees) {
  if (customPathPoints.length === 0) return;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const seg of customPathPoints) {
    for (let k = 0; k < seg.length; k += 2) {
      if (seg[k]     < minX) minX = seg[k];
      if (seg[k]     > maxX) maxX = seg[k];
      if (seg[k + 1] < minY) minY = seg[k + 1];
      if (seg[k + 1] > maxY) maxY = seg[k + 1];
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rad = degrees * Math.PI / 180;
  const cs  = Math.cos(rad);
  const sn  = Math.sin(rad);

  const rotated = customPathPoints.map(seg => {
    const next = seg.slice();
    for (let k = 0; k < seg.length; k += 2) {
      const dx = seg[k]     - cx;
      const dy = seg[k + 1] - cy;
      next[k]     = cx + dx * cs - dy * sn;
      next[k + 1] = cy + dx * sn + dy * cs;
    }
    return next;
  });

  // Keep the rotated bbox inside [0, 1] — translate to fit, scaling down only if the
  // rotated shape literally exceeds the canvas (45° rotation of an axis-aligned bbox).
  let nMinX = 1, nMinY = 1, nMaxX = 0, nMaxY = 0;
  for (const seg of rotated) {
    for (let k = 0; k < seg.length; k += 2) {
      if (seg[k]     < nMinX) nMinX = seg[k];
      if (seg[k]     > nMaxX) nMaxX = seg[k];
      if (seg[k + 1] < nMinY) nMinY = seg[k + 1];
      if (seg[k + 1] > nMaxY) nMaxY = seg[k + 1];
    }
  }
  const w = nMaxX - nMinX;
  const h = nMaxY - nMinY;
  let scale = 1;
  if (w > 1) scale = Math.min(scale, 1 / w);
  if (h > 1) scale = Math.min(scale, 1 / h);
  if (scale < 1) {
    for (const seg of rotated) {
      for (let k = 0; k < seg.length; k += 2) {
        seg[k]     = cx + (seg[k]     - cx) * scale;
        seg[k + 1] = cy + (seg[k + 1] - cy) * scale;
      }
    }
    nMinX = (nMinX - cx) * scale + cx; nMaxX = (nMaxX - cx) * scale + cx;
    nMinY = (nMinY - cy) * scale + cy; nMaxY = (nMaxY - cy) * scale + cy;
  }
  let tx = 0, ty = 0;
  if (nMinX < 0) tx = -nMinX;       else if (nMaxX > 1) tx = 1 - nMaxX;
  if (nMinY < 0) ty = -nMinY;       else if (nMaxY > 1) ty = 1 - nMaxY;
  if (tx !== 0 || ty !== 0) {
    for (const seg of rotated) {
      for (let k = 0; k < seg.length; k += 2) {
        seg[k]     += tx;
        seg[k + 1] += ty;
      }
    }
  }

  customPathPoints = rotated;
  customPathRedraw();
  scheduleCalculate();
}

function customPathRotateClick(evt) {
  customPathRotate(evt.shiftKey ? -15 : 15);
}

// ── SVG import ────────────────────────────────────────────────
function customPathImportClick() {
  document.getElementById('customPathFileInput').click();
}

function customPathImportSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) { alert('Could not parse SVG file.'); return; }

  // Try to find the first <path> element; fall back to first <polyline>/<polygon>/<rect>/<circle>
  let el = doc.querySelector('path');
  if (!el) {
    const poly = doc.querySelector('polyline,polygon');
    if (poly) {
      const pts = (poly.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      const d = pts.length >= 4
        ? 'M ' + pts[0] + ' ' + pts[1] + pts.slice(2).reduce((s, v, i) => s + (i % 2 === 0 ? ' L ' + v : ' ' + v), '') +
          (poly.tagName === 'polygon' ? ' Z' : '')
        : null;
      if (!d) { alert('No supported path found in SVG.'); return; }
      el = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', d);
    }
  }
  if (!el) { alert('No path element found in SVG.'); return; }

  const m = svgCompositeTransform(el);
  const segs = parseSvgD(el.getAttribute('d') || '');
  if (segs.length < 2) { alert('Path too short to import.'); return; }

  // Apply composite transform to all points
  const tSegs = segs.map(seg => {
    const out = [];
    for (let i = 0; i < seg.length; i += 2) {
      const [tx, ty] = svgApplyMatrix(m, seg[i], seg[i + 1]);
      out.push(tx, ty);
    }
    return out;
  });

  const normalized = normalizeSvgPath(tSegs);
  if (!normalized) { alert('Could not normalize path.'); return; }

  customPathPoints = normalized;
  customPathRedraw();
  scheduleCalculate();
}

// Walk up DOM collecting transforms; return composite matrix (row-major [a,b,c,d,e,f])
function svgCompositeTransform(el) {
  const mats = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const t = node.getAttribute('transform');
    if (t) mats.unshift(svgParseTransform(t));
    node = node.parentNode;
  }
  return mats.reduce((acc, m) => svgMulMatrix(acc, m), [1, 0, 0, 1, 0, 0]);
}

function svgParseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const fn = match[1];
    const args = match[2].trim().split(/[\s,]+/).map(Number);
    let tm;
    if (fn === 'matrix')    { tm = args; }
    else if (fn === 'translate') { tm = [1, 0, 0, 1, args[0] || 0, args[1] || 0]; }
    else if (fn === 'scale')     { const sx = args[0] || 1, sy = args[1] !== undefined ? args[1] : sx; tm = [sx, 0, 0, sy, 0, 0]; }
    else if (fn === 'rotate') {
      const ang = (args[0] || 0) * Math.PI / 180, cx2 = args[1] || 0, cy2 = args[2] || 0;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      tm = [cos, sin, -sin, cos, cx2 - cos * cx2 + sin * cy2, cy2 + sin * cx2 - cos * cy2];
    }
    else if (fn === 'skewX') { const t = Math.tan(args[0] * Math.PI / 180); tm = [1, 0, t, 1, 0, 0]; }
    else if (fn === 'skewY') { const t = Math.tan(args[0] * Math.PI / 180); tm = [1, t, 0, 1, 0, 0]; }
    else continue;
    m = svgMulMatrix(m, tm);
  }
  return m;
}

function svgMulMatrix(a, b) {
  return [
    a[0]*b[0] + a[2]*b[1],
    a[1]*b[0] + a[3]*b[1],
    a[0]*b[2] + a[2]*b[3],
    a[1]*b[2] + a[3]*b[3],
    a[0]*b[4] + a[2]*b[5] + a[4],
    a[1]*b[4] + a[3]*b[5] + a[5],
  ];
}

function svgApplyMatrix(m, x, y) {
  return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
}

// Parse an SVG path d attribute; returns array of flat-coord segments:
// [[x,y]] = start (M), [x,y] = line (L), [cpx,cpy,x,y] = Q, [c1x,c1y,c2x,c2y,x,y] = C
// Only the first subpath is used (stops at second M or Z; Z itself = line to start)
function parseSvgD(d) {
  const tokens = d.trim().match(/[MmZzLlHhVvCcSsQqTtAa]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) || [];
  const segs = [];
  let i = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCmd = '', lastCp = null;
  let started = false;

  function num() { return parseFloat(tokens[i++]); }

  while (i < tokens.length) {
    const tok = tokens[i];
    let cmd;
    if (/[A-Za-z]/.test(tok)) { cmd = tok; i++; } else { cmd = lastCmd; }
    lastCmd = cmd;

    if (cmd === 'Z' || cmd === 'z') {
      // Close subpath — add line back to start if not already there
      if (started && (cx !== sx || cy !== sy)) segs.push([sx, sy]);
      break; // first subpath done
    }
    if ((cmd === 'M' || cmd === 'm') && started) break; // second subpath

    const rel = cmd === cmd.toLowerCase();

    const addL = (x, y) => { cx = x; cy = y; segs.push([x, y]); lastCp = null; };
    const addQ = (qcx, qcy, x, y) => { cx = x; cy = y; lastCp = [qcx, qcy]; segs.push([qcx, qcy, x, y]); };
    const addC = (c1x, c1y, c2x, c2y, x, y) => { cx = x; cy = y; lastCp = [c2x, c2y]; segs.push([c1x, c1y, c2x, c2y, x, y]); };

    if (cmd === 'M' || cmd === 'm') {
      const x = num() + (rel && started ? cx : 0);
      const y = num() + (rel && started ? cy : 0);
      cx = x; cy = y; sx = x; sy = y;
      if (!started) { segs.push([x, y]); started = true; }
      else { addL(x, y); }
      lastCmd = rel ? 'l' : 'L'; // implicit lineto after M
    } else if (cmd === 'L' || cmd === 'l') {
      addL(num() + (rel ? cx : 0), num() + (rel ? cy : 0));
    } else if (cmd === 'H' || cmd === 'h') {
      addL(num() + (rel ? cx : 0), cy);
    } else if (cmd === 'V' || cmd === 'v') {
      addL(cx, num() + (rel ? cy : 0));
    } else if (cmd === 'Q' || cmd === 'q') {
      const qcx = num() + (rel ? cx : 0), qcy = num() + (rel ? cy : 0);
      const x   = num() + (rel ? cx : 0), y   = num() + (rel ? cy : 0);
      addQ(qcx, qcy, x, y);
    } else if (cmd === 'T' || cmd === 't') {
      const qcx = lastCp ? 2*cx - lastCp[0] : cx;
      const qcy = lastCp ? 2*cy - lastCp[1] : cy;
      addQ(qcx, qcy, num() + (rel ? cx : 0), num() + (rel ? cy : 0));
    } else if (cmd === 'C' || cmd === 'c') {
      const c1x = num() + (rel ? cx : 0), c1y = num() + (rel ? cy : 0);
      const c2x = num() + (rel ? cx : 0), c2y = num() + (rel ? cy : 0);
      const x   = num() + (rel ? cx : 0), y   = num() + (rel ? cy : 0);
      addC(c1x, c1y, c2x, c2y, x, y);
    } else if (cmd === 'S' || cmd === 's') {
      const c1x = lastCp ? 2*cx - lastCp[0] : cx;
      const c1y = lastCp ? 2*cy - lastCp[1] : cy;
      const c2x = num() + (rel ? cx : 0), c2y = num() + (rel ? cy : 0);
      const x   = num() + (rel ? cx : 0), y   = num() + (rel ? cy : 0);
      addC(c1x, c1y, c2x, c2y, x, y);
    } else if (cmd === 'A' || cmd === 'a') {
      const rx = Math.abs(num()), ry = Math.abs(num());
      const xRot = num(), large = num() !== 0, sweep = num() !== 0;
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      const arcs = svgArcToCubics(cx, cy, rx, ry, xRot, large, sweep, x, y);
      arcs.forEach(([c1x, c1y, c2x, c2y, ex, ey]) => addC(c1x, c1y, c2x, c2y, ex, ey));
    } else {
      i++; // unknown — skip token
    }
  }
  return segs;
}

// Convert SVG arc to one or more cubic bezier segments (SVG spec Appendix B)
function svgArcToCubics(x1, y1, rx, ry, xRotDeg, largeArc, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];

  const phi  = xRotDeg * Math.PI / 180;
  const cosp = Math.cos(phi), sinp = Math.sin(phi);

  const mx = (x1 - x2) / 2, my = (y1 - y2) / 2;
  const x1p =  cosp * mx + sinp * my;
  const y1p = -sinp * mx + cosp * my;

  let rx2 = rx * rx, ry2 = ry * ry;
  const x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  const lam = x1p2 / rx2 + y1p2 / ry2;
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; rx2 = rx*rx; ry2 = ry*ry; }

  const num1 = rx2*ry2 - rx2*y1p2 - ry2*x1p2;
  const den  = rx2*y1p2 + ry2*x1p2;
  const sq   = Math.sqrt(Math.max(0, num1 / den));
  const k    = (largeArc === sweep ? -1 : 1) * sq;
  const cxp  = k * rx * y1p / ry;
  const cyp  = -k * ry * x1p / rx;

  const cx   = cosp*cxp - sinp*cyp + (x1+x2)/2;
  const cy   = sinp*cxp + cosp*cyp + (y1+y2)/2;

  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;

  const dot = ux*vx + uy*vy;
  let da = Math.acos(Math.max(-1, Math.min(1, dot / Math.sqrt((ux*ux+uy*uy)*(vx*vx+vy*vy)))));
  if (ux*vy - uy*vx < 0) da = -da;
  if (sweep && da < 0) da += 2*Math.PI;
  if (!sweep && da > 0) da -= 2*Math.PI;

  const ang1 = Math.atan2(uy, ux);
  const nSegs = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 2)));
  const dt = da / nSegs;

  const cubics = [];
  for (let s = 0; s < nSegs; s++) {
    const a1 = ang1 + s * dt, a2 = ang1 + (s + 1) * dt;
    const alpha = Math.sin(dt) * (Math.sqrt(4 + 3*Math.tan(dt/2)*Math.tan(dt/2)) - 1) / 3;
    const ex1 = Math.cos(a1), ey1 = Math.sin(a1);
    const ex2 = Math.cos(a2), ey2 = Math.sin(a2);
    // P1, P2 on rotated ellipse; control points via tangent direction
    const c1x = cx + cosp*(rx*(ex1 - alpha*ey1)) - sinp*(ry*(ey1 + alpha*ex1));
    const c1y = cy + sinp*(rx*(ex1 - alpha*ey1)) + cosp*(ry*(ey1 + alpha*ex1));
    const c2x = cx + cosp*(rx*(ex2 + alpha*ey2)) - sinp*(ry*(ey2 - alpha*ex2));
    const c2y = cy + sinp*(rx*(ex2 + alpha*ey2)) + cosp*(ry*(ey2 - alpha*ex2));
    const epx = cx + cosp*rx*ex2 - sinp*ry*ey2;
    const epy = cy + sinp*rx*ex2 + cosp*ry*ey2;
    cubics.push([c1x, c1y, c2x, c2y, epx, epy]);
  }
  return cubics;
}

// Scale/translate all segments to fit [0,1]² using bounding box of endpoints only
function normalizeSvgPath(segs) {
  if (!segs.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const seg of segs) {
    const x = seg[seg.length - 2], y = seg[seg.length - 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const w = maxX - minX, h = maxY - minY;
  if (w < 1e-9 && h < 1e-9) return null;
  const scale = 1.0 / Math.max(w, h);
  const offX = (1.0 - w * scale) / 2 - minX * scale;
  const offY = (1.0 - h * scale) / 2 - minY * scale;
  return segs.map(seg => {
    const out = [];
    for (let i = 0; i < seg.length; i += 2) {
      out.push(seg[i] * scale + offX, seg[i+1] * scale + offY);
    }
    return out;
  });
}

function toggleInlayGroup(header) {
  const body = header.nextElementSibling;
  const icon = header.querySelector('.material-icons');
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  icon.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
  saveState();
}

function getAccordionActiveIndex() {
  const items = document.querySelectorAll('#inputSections > li');
  for (let i = 0; i < items.length; i++) if (items[i].classList.contains('active')) return i;
  return -1;
}

function getInlayGroupsState() {
  const state = {};
  document.querySelectorAll('[onclick^="toggleInlayGroup"]').forEach(h => {
    const span = h.querySelector('span');
    const body = h.nextElementSibling;
    if (span && body) state[span.textContent.trim()] = body.style.display !== 'none';
  });
  return state;
}

function matchInlaySlider(id, valId, value) {
  document.getElementById(id).value = value;
  document.getElementById(valId).textContent = parseFloat(value).toFixed(2);
  scheduleCalculate();
}

function snapToZeroOnDblClick(id, valId) {
  const el = document.getElementById(id), valEl = document.getElementById(valId);
  el.addEventListener('dblclick', () => {
    el.value = 0;
    valEl.textContent = '0.00';
    scheduleCalculate();
  });
}

function bindDimSlider(id, valId) {
  const el = document.getElementById(id), valEl = document.getElementById(valId);
  el.addEventListener('input', () => {
    const unit = document.getElementById('unit').value;
    const mm = parseFloat(el.value);
    valEl.textContent = unit === 'inch' ? (mm / MM_PER_IN).toFixed(3) + ' in' : mm.toFixed(1) + ' mm';
    scheduleCalculate();
  });
}

function refreshDimSliderDisplays() {
  const unit = document.getElementById('unit').value;
  [['inlaySize', 'inlaySizeVal'], ['inlayHeight', 'inlayHeightVal'], ['inlayDoubleOffset', 'inlayDoubleOffsetVal']].forEach(([id, valId]) => {
    const el = document.getElementById(id), valEl = document.getElementById(valId);
    if (!el || !valEl) return;
    const mm = parseFloat(el.value);
    if (isNaN(mm)) return;
    valEl.textContent = unit === 'inch' ? (mm / MM_PER_IN).toFixed(3) + ' in' : mm.toFixed(1) + ' mm';
  });
}

// ── Calculation ───────────────────────────────────────────────
function scheduleCalculate() {
  saveState();
  publishLightingSync();
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(calculate, 350);
}

async function calculate() {
  const req = buildRequest();
  if (!isValid(req)) return;
  setLoading(true);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    lastResponse = data;
    renderPreview(data);
    renderTable(data);
    document.getElementById('downloadBtn').classList.remove('disabled');
  } catch (e) {
    M.toast({ html: 'Cannot reach backend — make sure Spring Boot is running on port 8080.', displayLength: 4000 });
  } finally {
    setLoading(false);
  }
}

// Always sends mm to backend; converts from display unit if needed.
function buildRequest() {
  const unit = document.getElementById('unit').value;
  const toMm = v => unit === 'inch' ? v * MM_PER_IN : v;
  const presetIdx = parseInt(document.getElementById('preset').value, 10);
  return {
    scaleLength:          toMm(parseFloat(document.getElementById('scaleLength').value)),
    numberOfFrets:        parseInt(document.getElementById('numberOfFrets').value, 10),
    nutWidth:             toMm(parseFloat(document.getElementById('nutWidth').value)),
    width12thFret:        toMm(parseFloat(document.getElementById('width12thFret').value)),
    unit:                 'mm',
    showFretNumbers:      document.getElementById('showFretNumbers').checked,
    showCenterLine:       document.getElementById('showCenterLine').checked,
    showWidthAnnotations: document.getElementById('showWidthAnnotations').checked,
    showInlays:           document.getElementById('showInlays').checked,
    doubleInlays:         document.getElementById('doubleInlays').checked,
    showBoundingBox:      document.getElementById('showBoundingBox').checked,
    label:                isNaN(presetIdx) ? '' : PRESETS[presetIdx].name,
    showRadius:           document.getElementById('showRadius').checked,
    radiusValue:          toMm(parseFloat(document.getElementById('radiusValue').value)),
    radiusSteps:          parseInt(document.getElementById('radiusSteps').value, 10),
    showNutSlot:          document.getElementById('showNutSlot').checked,
    nutSlotWidth:         toMm(parseFloat(document.getElementById('nutSlotWidth').value)),
    nutSlotDistance:      toMm(parseFloat(document.getElementById('nutSlotDistance').value)),
    showPinholes:         document.getElementById('showPinholes').checked,
    tangWidth:            toMm(parseFloat(document.getElementById('tangWidth').value)),
    fretExtensionAmount:  toMm(parseFloat(document.getElementById('fretExtensionAmount').value)),
    inlayShape:           currentInlayPresetId,
    inlaySize:            parseFloat(document.getElementById('inlaySize').value),
    inlayHeight:          parseFloat(document.getElementById('inlayHeight').value),
    inlayPosition:           document.getElementById('inlayPosition').value,
    inlayDoubleOffset:       parseFloat(document.getElementById('inlayDoubleOffset').value),
    inlayDoubleOrientation:  document.getElementById('inlayDoubleOrientation').value,
    inlayShrinkWidth1224:    parseFloat(document.getElementById('inlayShrinkWidth1224').value),
    inlayShrinkHeight1224:   parseFloat(document.getElementById('inlayShrinkHeight1224').value),
    inlayShrinkWidth:        parseFloat(document.getElementById('inlayShrinkWidth').value),
    inlayGrowHeight:      parseFloat(document.getElementById('inlayGrowHeight').value),
    inlayTrapezoid:       parseFloat(document.getElementById('inlayTrapezoid').value) / 50,
    inlayParallelogram:   parseFloat(document.getElementById('inlayParallelogram').value) / 50,
    inlayCustomPath:      currentInlayPresetId === 'custom' ? customPathPoints : [],
    inlayCustomClosed:    customPathClosed,
  };
}

function isValid(req) {
  return !isNaN(req.scaleLength) && req.scaleLength >= 100 && req.scaleLength <= 2000 &&
         !isNaN(req.numberOfFrets) && req.numberOfFrets >= 0 && req.numberOfFrets <= 36 &&
         !isNaN(req.nutWidth) && req.nutWidth >= 10 &&
         !isNaN(req.width12thFret) && req.width12thFret >= 10;
}

// ── Rendering ─────────────────────────────────────────────────
function renderPreview(data) {
  const container = document.getElementById('svgContainer');
  const svgStr = data.svgContent
    .replace(/ width="[^"]*mm"/, '')
    .replace(/ height="[^"]*mm"/, '');
  container.innerHTML = svgStr;
  container.style.display = '';
  document.getElementById('emptyState').style.display = 'none';
}

function renderTable(data) {
  const card = document.getElementById('tableCard');
  const unit = document.getElementById('unit').value;
  const unitLabel = unit === 'inch' ? 'in' : 'mm';
  const conv = v => unit === 'inch' ? v / MM_PER_IN : v;
  document.getElementById('colNut').textContent   = `Distance from Nut (${unitLabel})`;
  document.getElementById('colSpace').textContent = `Slot Spacing (${unitLabel})`;
  if (data.fretPositions.length === 0) { card.style.display = 'none'; return; }
  document.getElementById('fretTableBody').innerHTML = data.fretPositions.map(fp => `
    <tr>
      <td>${fp.fretNumber}</td>
      <td>${conv(fp.distanceFromNut).toFixed(4)}</td>
      <td>${conv(fp.distanceFromPreviousFret).toFixed(4)}</td>
    </tr>`).join('');
  card.style.display = '';
}

// ── Download SVG ──────────────────────────────────────────────
// Embed the current configuration code into the root <svg> as a data attribute,
// a <desc> element, AND a visible <text> at the bottom edge so the export
// is fully reproducible and the code is human-readable on the rendered SVG.
function embedConfigInSvg(svgStr) {
  const code = encodeConfig(stateSnapshot());
  const vbMatch = svgStr.match(/viewBox="([\d.\-\s]+)"/);
  let textElement = '';
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/\s+/).map(parseFloat);
    if (parts.length === 4) {
      const [vx, vy, vw, vh] = parts;
      const tx = vx + vw / 2.0;
      const ty = vy + vh - 1.0;
      textElement =
        `<text x="${tx}" y="${ty}" font-size="2.0" fill="#9e9e9e" ` +
        `text-anchor="middle" font-family="sans-serif">config: ${code}</text>`;
    }
  }
  return svgStr.replace(/(<svg\b)([^>]*)(>)/,
    (_, open, attrs, close) =>
      `${open}${attrs} data-config="${code}"${close}<desc>config:${code}</desc>${textElement}`);
}

function downloadSvg() {
  if (!lastResponse) return;
  const unit = document.getElementById('unit').value;
  const scaleDisplay = unit === 'inch'
    ? (lastResponse.scaleLength / MM_PER_IN).toFixed(2)
    : lastResponse.scaleLength;
  const unitLabel = unit === 'inch' ? 'in' : 'mm';
  const blob = new Blob([embedConfigInSvg(lastResponse.svgContent)], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `fretboard-${scaleDisplay}${unitLabel}-${lastResponse.fretPositions.length}frets.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Download PDF (SVG → canvas → PNG → jsPDF) ─────────────────
async function downloadPdf() {
  if (!lastResponse) return;

  const { jsPDF } = window.jspdf;
  const margin = 10, pageW = 297, pageH = 210, usableW = pageW - 2 * margin;

  const svgEl = document.querySelector('#svgContainer svg');
  const vb    = svgEl?.getAttribute('viewBox')?.split(/\s+/);
  const svgW  = vb ? parseFloat(vb[2]) : 200;
  const svgH  = vb ? parseFloat(vb[3]) : 100;
  const aspect = svgW / svgH;

  const pxW = Math.round(usableW * (150 / 25.4));
  const pxH = Math.round(pxW / aspect);

  const svgStr = lastResponse.svgContent
    .replace(/(\swidth=")[0-9.]+mm"/, `$1${pxW}"`)
    .replace(/(\sheight=")[0-9.]+mm"/, `$1${pxH}"`);

  let imgData;
  try {
    imgData = await new Promise((resolve, reject) => {
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = pxW;
        canvas.height = pxH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, pxW, pxH);
        ctx.drawImage(img, 0, 0, pxW, pxH);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
      img.src = url;
    });
  } catch (e) {
    M.toast({ html: `PDF generation failed: ${e.message}`, displayLength: 4000 });
    return;
  }

  const displayUnit = document.getElementById('unit').value;
  const unitLabel   = displayUnit === 'inch' ? 'in' : 'mm';
  const conv        = v => displayUnit === 'inch' ? v / MM_PER_IN : v;

  const doc    = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const scaledH = usableW / aspect;
  let curY = margin;

  const presetIdx = parseInt(document.getElementById('preset').value, 10);
  const title = isNaN(presetIdx) ? 'Custom Fretboard' : PRESETS[presetIdx].name;
  doc.setFontSize(13);
  doc.setTextColor(2, 119, 189);
  doc.text(title, margin, curY + 5);
  curY += 10;

  doc.addImage(imgData, 'PNG', margin, curY, usableW, scaledH);
  curY += scaledH + 6;

  if (lastResponse.fretPositions?.length > 0) {
    if (curY + 30 > pageH - margin) { doc.addPage(); curY = margin; }
    doc.autoTable({
      startY:     curY,
      head:       [['Fret #', `Distance from Nut (${unitLabel})`, `Slot Spacing (${unitLabel})`]],
      body:       lastResponse.fretPositions.map(fp => [
                    fp.fretNumber,
                    conv(fp.distanceFromNut).toFixed(4),
                    conv(fp.distanceFromPreviousFret).toFixed(4),
                  ]),
      styles:     { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [2, 119, 189] },
      margin:     { left: margin, right: margin },
    });
    curY = doc.lastAutoTable.finalY + 6;
  }

  // Radius contour table (always in mm — buildRequest sends mm)
  const radiusOn = document.getElementById('showRadius').checked;
  const req      = buildRequest();
  const R        = req.radiusValue;
  const N        = req.radiusSteps;
  if (radiusOn && R > 0 && N >= 2) {
    const pos12      = req.scaleLength / 2;
    const widthAtEnd = req.nutWidth + (req.width12thFret - req.nutWidth) * req.scaleLength / pos12;
    const halfHeel   = widthAtEnd / 2;
    const radiusBody = [];
    for (let k = 1; k <= N; k++) {
      const fracO = k / N;
      const fracI = (k - 1) / N;
      const yI    = (fracI * halfHeel).toFixed(2);
      const yO    = (fracO * halfHeel).toFixed(2);
      const depth = (R - Math.sqrt(R * R - (fracO * halfHeel) ** 2)).toFixed(3);
      radiusBody.push([`Zone ${k}`, `${yI} – ${yO} mm from centre`, `${depth} mm`]);
    }
    if (curY + 30 > pageH - margin) { doc.addPage(); curY = margin; }
    doc.setFontSize(10);
    doc.setTextColor(230, 81, 0);
    doc.text(`Radius Contour Zones — R=${R} mm (${(R / 25.4).toFixed(2)}")`, margin, curY + 4);
    curY += 8;
    doc.autoTable({
      startY:     curY,
      head:       [['Zone', 'Distance from Centre', 'Cut Depth (from flat)']],
      body:       radiusBody,
      styles:     { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [230, 81, 0] },
      margin:     { left: margin, right: margin },
    });
    curY = doc.lastAutoTable.finalY + 6;

    if (req.showInlays) {
      const halfHeelI  = widthAtEnd / 2;
      const edgeOff    = (R - Math.sqrt(R * R - halfHeelI * halfHeelI)).toFixed(3);
      if (curY + 24 > pageH - margin) { doc.addPage(); curY = margin; }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      const noteLines = doc.splitTextToSize(
        `Inlay pocket depth with radius R = ${R} mm: ` +
        `The fretboard surface curves away from the centre after radiusing. ` +
        `Minimum finished inlay depth from the radiused surface: 2.5 mm. ` +
        `For centre-positioned markers no correction is needed. ` +
        `For edge-positioned markers add the radius offset at that position. ` +
        `Maximum surface offset at fretboard edge: ${edgeOff} mm. ` +
        `Required pre-radius pocket depth (edge marker): ${(2.5 + parseFloat(edgeOff)).toFixed(3)} mm.`,
        pageW - 2 * margin
      );
      doc.text(noteLines, margin, curY + 4);
      curY += noteLines.length * 4 + 4;
    }
  }

  const configCode = encodeConfig(stateSnapshot());
  const pageCount  = doc.internal.getNumberOfPages();
  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.text(`Config: ${configCode}`, margin, pageH - margin + 4);
  }

  const scaleDisplay = displayUnit === 'inch'
    ? (lastResponse.scaleLength / MM_PER_IN).toFixed(2)
    : lastResponse.scaleLength;
  doc.save(`fretboard-${scaleDisplay}${unitLabel}.pdf`);
}

// ── UI helpers ────────────────────────────────────────────────
function updateShapeFields() {
  const id     = currentInlayPresetId;
  const isRect = id === 'rectangle';
  const heightLabels = {
    rectangle:    'Height',
    star:         'Inner diameter (0 = auto 40%)',
    arrow:        'Head width',
    'shark-fin':  'Fin height',
    custom:       'Height',
  };
  const showHeight = id in heightLabels || id === 'custom';
  document.getElementById('inlayHeightField').style.display       = showHeight ? 'flex' : 'none';
  document.getElementById('inlayDeformationGroup').style.display  = (isRect || id === 'custom') ? '' : 'none';
  document.getElementById('customPathEditor').style.display       = id === 'custom' ? '' : 'none';
  const labelEl = document.getElementById('inlayHeightLabel');
  if (labelEl) labelEl.textContent = heightLabels[id] || 'Height';
}

function downloadLayerSvg(mode) {
  if (!lastResponse) return;
  const unit      = document.getElementById('unit').value;
  const scaleDisp = unit === 'inch' ? (lastResponse.scaleLength / MM_PER_IN).toFixed(2) : lastResponse.scaleLength;
  const unitLabel = unit === 'inch' ? 'in' : 'mm';

  if (mode === 'inlays') {
    const req = buildRequest();
    fetch('/api/frets/inlays-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    }).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    }).then(svgStr => {
      const blob = new Blob([embedConfigInSvg(svgStr)], { type: 'image/svg+xml;charset=utf-8' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `inlays-sheet-${scaleDisp}${unitLabel}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(() => {
      M.toast({ html: 'Failed to generate inlays sheet.', displayLength: 3000 });
    });
    return;
  }

  // mode === 'frets': strip the inlays group from the full SVG
  const parser    = new DOMParser();
  const svgDoc    = parser.parseFromString(lastResponse.svgContent, 'image/svg+xml');
  const svgEl     = svgDoc.documentElement;
  const inlaysGrp = svgEl.querySelector('#layer-inlays');
  if (inlaysGrp) inlaysGrp.parentNode.removeChild(inlaysGrp);
  const svgStr = new XMLSerializer().serializeToString(svgDoc);
  const blob   = new Blob([embedConfigInSvg(svgStr)], { type: 'image/svg+xml;charset=utf-8' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = `fretboard-${scaleDisp}${unitLabel}-frets.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

function setLoading(loading) {
  document.getElementById('progressBar').style.display = loading ? '' : 'none';
}

// ── Config code ───────────────────────────────────────────────
// 32 uppercase alphanumeric characters (base-36):
//   - 28 data chars: 143 bits packed via BigInt
//   - 4 hash chars: polynomial hash over the data (~20.7 bits, ~0.06% false-positive rate)
// Decoder verifies the hash directly, and on mismatch brute-force tries every
// single-character substitution (32 positions × 35 alternates = 1120 candidates),
// so any one-character corruption (typo, OCR slip, transmission error) is corrected.
// All dimension values stored in mm regardless of display unit.
// Field bit-widths in pack order:
//   scaleLength(12) numberOfFrets(6) nutWidth(8) width12thFret(8) unit(1)
//   showFretNumbers(1) showCenterLine(1) showWidthAnnotations(1)
//   showInlays(1) doubleInlays(1) doubleOrientation(2) showBoundingBox(1)
//   inlayShape(3) inlaySize(7) inlayHeight(7) inlayPosition(2)
//   inlayDoubleOffset(7) inlayShrinkWidth1224(5) inlayShrinkHeight1224(5) inlayShrinkWidth(5) inlayGrowHeight(8)
//   inlayTrapezoid(7) inlayParallelogram(7) showRadius(1) radiusValue(12) radiusSteps(4)
//   showNutSlot(1) nutSlotWidth(5) nutSlotDistance(6)
//   showPinholes(1) tangWidth(5) fretExtensionAmount(6)  = 147 bits
const CONFIG_SCHEMA = [12,6,8,8,1,1,1,1,1,1,2,1,3,7,7,2,7,5,5,5,8,7,7,1,12,4,1,5,6,1,5,6];
// Legacy schema (codes generated before bidirectional sliders, 143 bits → 28 data chars)
const CONFIG_SCHEMA_LEGACY = [12,6,8,8,1,1,1,1,1,1,2,1,3,7,7,2,7,4,4,4,7,7,7,1,12,4,1,5,6,1,5,6];
const CONFIG_DATA_CHARS = 29;
const CONFIG_DATA_CHARS_LEGACY = 28;
const CONFIG_HASH_CHARS = 4;
const CONFIG_CHARS      = CONFIG_DATA_CHARS + CONFIG_HASH_CHARS;
const CONFIG_HASH_MOD   = Math.pow(36, CONFIG_HASH_CHARS); // 1,679,616
const CONFIG_ALPHABET   = '0123456789abcdefghijklmnopqrstuvwxyz';

// Polynomial hash (djb2-style) over the base-36 data symbols.
function configHash(dataStr) {
  let h = 5381;
  for (let i = 0; i < dataStr.length; i++) {
    h = (Math.imul(h, 33) ^ parseInt(dataStr[i], 36)) >>> 0;
  }
  return h % CONFIG_HASH_MOD;
}

function configHashChars(dataStr) {
  return configHash(dataStr).toString(36).padStart(CONFIG_HASH_CHARS, '0');
}

function encodeConfig(s) {
  const fields = [
    Math.round((parseFloat(s.scaleLength)        - 100) * 2),   // 12 bits  0-3800
    parseInt(s.numberOfFrets),                                    //  6 bits  0-36
    Math.round((parseFloat(s.nutWidth)           - 10)  * 2),   //  8 bits  0-180
    Math.round((parseFloat(s.width12thFret)      - 10)  * 2),   //  8 bits  0-180
    s.unit === 'mm' ? 0 : 1,                                     //  1 bit
    s.showFretNumbers      ? 1 : 0,                              //  1 bit
    s.showCenterLine       ? 1 : 0,                              //  1 bit
    s.showWidthAnnotations ? 1 : 0,                              //  1 bit
    s.showInlays           ? 1 : 0,                              //  1 bit
    s.doubleInlays         ? 1 : 0,                              //  1 bit
    s.inlayDoubleOrientation === 'horizontal' ? 1 : s.inlayDoubleOrientation === 'staggered' ? 2 : 0, // 2 bits
    s.showBoundingBox      ? 1 : 0,                              //  1 bit
    Math.max(0, inlayPresets.findIndex(p => p.id === s.inlayShape)), //  3 bits
    Math.round(parseFloat(s.inlaySize)         * 2),             //  7 bits  0-100 (0-50mm)
    Math.round(parseFloat(s.inlayHeight)       * 2),             //  7 bits  0-100 (0-50mm)
    s.inlayPosition === 'center' ? 0 : s.inlayPosition === 'top' ? 1 : 2, // 2 bits
    Math.round(parseFloat(s.inlayDoubleOffset)      * 2),         //  7 bits  0-100 (0-50mm)
    Math.round(parseFloat(s.inlayShrinkWidth1224)  / 0.05) + 15, //  5 bits  0-30 (−0.75…+0.75, offset +15)
    Math.round(parseFloat(s.inlayShrinkHeight1224) / 0.05) + 15, //  5 bits  0-30
    Math.round(parseFloat(s.inlayShrinkWidth)      / 0.25) + 8,  //  5 bits  0-16 (−2…+2,     offset +8)
    Math.round(parseFloat(s.inlayGrowHeight)  / 0.1) + 100,      //  8 bits  0-200 (−10…+10,  offset +100)
    parseInt(s.inlayTrapezoid) + 50,                              //  7 bits  0-100 (raw slider -50..+50 + offset)
    parseInt(s.inlayParallelogram) + 50,                          //  7 bits  0-100 (raw slider -50..+50 + offset)
    s.showRadius           ? 1 : 0,                              //  1 bit
    Math.round((Math.min(parseFloat(s.radiusValue) || 50, 2097.5) - 50) * 2), // 12 bits 0-4095
    (parseInt(s.radiusSteps) || 5) - 2,                          //  4 bits  0-8
    s.showNutSlot          ? 1 : 0,                              //  1 bit
    Math.round((parseFloat(s.nutSlotWidth) - 0.5) * 2),          //  5 bits  0-29 (0.5-15mm)
    Math.round((parseFloat(s.nutSlotDistance) + 10) * 2),        //  6 bits  0-40 (-10..+10mm)
    s.showPinholes         ? 1 : 0,                              //  1 bit
    Math.round((parseFloat(s.tangWidth) - 0.1) / 0.1),           //  5 bits  0-29 (0.1-3.0mm)
    Math.round((parseFloat(s.fretExtensionAmount) + 10) * 2),    //  6 bits  -10 to +21.5mm step 0.5
  ];
  let bits = 0n;
  for (let i = 0; i < fields.length; i++) {
    bits = (bits << BigInt(CONFIG_SCHEMA[i])) | BigInt(Math.max(0, fields[i]));
  }
  const dataStr = bits.toString(36).padStart(CONFIG_DATA_CHARS, '0');
  let code = (dataStr + configHashChars(dataStr)).toUpperCase();
  if (s.inlayShape === 'custom' && Array.isArray(s.inlayCustomPath) && s.inlayCustomPath.length >= 1) {
    const pathSuffix = encodeCustomPath(s.inlayCustomClosed !== false, s.inlayCustomPath);
    if (pathSuffix) code += '.' + pathSuffix.toUpperCase();
  }
  return code;
}

// ── Custom path encoding ──────────────────────────────────────────────────────
// Bit layout (packed into a single BigInt, then base-36):
//   1 bit  : closed (1=filled pocket, 0=open stroke)
//   5 bits : N = number of additional segments after start (max 31)
//   8+8    : start point x, y  (each = round(val×255), [0-255])
//   per segment:
//     2 bits type: 00=L(line), 01=Q(quad bezier), 10=C(cubic bezier)
//     coords:  L→x,y (2×8); Q→cpx,cpy,x,y (4×8); C→c1x,c1y,c2x,c2y,x,y (6×8)
function encodeCustomPath(closed, points) {
  if (!points || points.length < 1) return '';
  const enc8 = v => Math.max(0, Math.min(255, Math.round(v * 255)));
  const segs = points.slice(1);               // additional segments (after start)
  const N    = Math.min(segs.length, 31);
  let bits = 0n;
  const push = (val, nbits) => { bits = (bits << BigInt(nbits)) | BigInt(val); };
  push(closed ? 1 : 0, 1);
  push(N, 5);
  push(enc8(points[0][0]), 8);
  push(enc8(points[0][1]), 8);
  for (let i = 0; i < N; i++) {
    const seg = segs[i];
    if (seg.length >= 6) {
      push(2, 2); // cubic
      for (let j = 0; j < 6; j++) push(enc8(seg[j]), 8);
    } else if (seg.length >= 4) {
      push(1, 2); // quad
      for (let j = 0; j < 4; j++) push(enc8(seg[j]), 8);
    } else {
      push(0, 2); // line
      push(enc8(seg[0]), 8);
      push(enc8(seg[1]), 8);
    }
  }
  return bits.toString(36);
}

function decodeCustomPath(suffix) {
  if (!suffix) return { closed: true, points: [] };
  let bits = 0n;
  for (const c of suffix.toLowerCase()) bits = bits * 36n + BigInt(parseInt(c, 36));
  // Expand BigInt to bit array, MSB first; pad to at least header size (1+5+8+8=22)
  const allBits = [];
  let tmp = bits;
  while (tmp > 0n) { allBits.unshift(Number(tmp & 1n)); tmp >>= 1n; }
  while (allBits.length < 22) allBits.unshift(0);
  let pos = 0;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | (allBits[pos++] ?? 0);
    return v;
  };
  const dec8 = v => v / 255;
  try {
    const closed = read(1) === 1;
    const N      = read(5);
    const sx     = dec8(read(8));
    const sy     = dec8(read(8));
    const points = [[sx, sy]];
    for (let i = 0; i < N; i++) {
      const type = read(2);
      if (type === 2) {
        points.push([read(8),read(8),read(8),read(8),read(8),read(8)].map(dec8));
      } else if (type === 1) {
        points.push([read(8),read(8),read(8),read(8)].map(dec8));
      } else {
        points.push([dec8(read(8)), dec8(read(8))]);
      }
    }
    return { closed, points };
  } catch (_) {
    return { closed: true, points: [] };
  }
}

function parseConfigData(dataStr, schema = CONFIG_SCHEMA) {
  let bits = 0n;
  for (const c of dataStr) bits = bits * 36n + BigInt(parseInt(c, 36));
  const totalBits = schema.reduce((a, b) => a + b, 0);
  const vals = [];
  let shift = BigInt(totalBits);
  for (const nbits of schema) {
    shift -= BigInt(nbits);
    vals.push(Number((bits >> shift) & ((1n << BigInt(nbits)) - 1n)));
  }
  return vals;
}

function decodeConfig(raw) {
  const full = raw.toLowerCase().replace(/\s/g, '');
  // Split off optional custom-path suffix (separated by '.')
  const dotIdx   = full.indexOf('.');
  const mainCode = dotIdx >= 0 ? full.slice(0, dotIdx) : full;
  const pathCode = dotIdx >= 0 ? full.slice(dotIdx + 1) : null;

  // Accept both the current 33-char format and the legacy 32-char format (before
  // bidirectional sliders were introduced — the four affected fields default to 0).
  const legacy = mainCode.length === CONFIG_DATA_CHARS_LEGACY + CONFIG_HASH_CHARS;
  const expectedLen = legacy ? CONFIG_DATA_CHARS_LEGACY + CONFIG_HASH_CHARS : CONFIG_CHARS;
  const dataChars   = legacy ? CONFIG_DATA_CHARS_LEGACY : CONFIG_DATA_CHARS;
  const schema      = legacy ? CONFIG_SCHEMA_LEGACY : CONFIG_SCHEMA;

  if (mainCode.length !== expectedLen || !/^[0-9a-z]+$/.test(mainCode)) throw new Error('Invalid code');

  // Try the code as-is, then any single-char substitution. Collect unique candidates.
  const candidates = new Set();
  const tryCode = (s) => {
    const data = s.slice(0, dataChars);
    const hash = s.slice(dataChars);
    if (configHashChars(data) === hash) candidates.add(data);
  };
  tryCode(mainCode);
  if (candidates.size === 0) {
    for (let i = 0; i < expectedLen; i++) {
      const orig = mainCode[i];
      for (const c of CONFIG_ALPHABET) {
        if (c !== orig) tryCode(mainCode.slice(0, i) + c + mainCode.slice(i + 1));
      }
    }
  }
  if (candidates.size === 0) throw new Error('Invalid code (uncorrectable)');
  if (candidates.size > 1)  throw new Error('Ambiguous code — too many errors to correct');
  const dataStr = [...candidates][0];

  const vals = parseConfigData(dataStr, schema);
  const [sl,nf,nw,w12,unit,sfn,scl,swa,si,di,dO,sbb,shape,isz,ih,ip,ido,sw1224,sh1224,sw,gh,trap,para,
         showR,rv,rs,sNS,nsw,nsd,sPH,tw,fea] = vals;

  const pathResult = pathCode ? decodeCustomPath(pathCode) : { closed: true, points: [] };

  return {
    scaleLength:          sl / 2 + 100,
    numberOfFrets:        nf,
    nutWidth:             nw / 2 + 10,
    width12thFret:        w12 / 2 + 10,
    unit:                 unit === 0 ? 'mm' : 'inch',
    showFretNumbers:      sfn === 1,
    showCenterLine:       scl === 1,
    showWidthAnnotations: swa === 1,
    showInlays:           si  === 1,
    doubleInlays:            di  === 1,
    inlayDoubleOrientation:  dO === 0 ? 'vertical' : dO === 1 ? 'horizontal' : 'staggered',
    showBoundingBox:         sbb === 1,
    inlayShape:           inlayPresets[shape]?.id ?? 'circle',
    inlaySize:            isz / 2,
    inlayHeight:          ih  / 2,
    inlayPosition:        ip === 0 ? 'center' : ip === 1 ? 'top' : 'bottom',
    inlayDoubleOffset:     ido   / 2,
    // New: signed encoding with offset. Legacy codes used 0-based (offset 0) so values stay ≥ 0.
    inlayShrinkWidth1224:  legacy ? sw1224 * 0.05        : (sw1224 - 15) * 0.05,
    inlayShrinkHeight1224: legacy ? sh1224 * 0.05        : (sh1224 - 15) * 0.05,
    inlayShrinkWidth:      legacy ? sw     * 0.25        : (sw     -  8) * 0.25,
    inlayGrowHeight:       legacy ? gh     * 0.1         : (gh     - 100) * 0.1,
    inlayTrapezoid:       trap - 50,
    inlayParallelogram:   para - 50,
    showRadius:           showR === 1,
    radiusValue:          rv  / 2 + 50,
    radiusSteps:          rs  + 2,
    showNutSlot:          sNS === 1,
    nutSlotWidth:         nsw / 2 + 0.5,
    nutSlotDistance:      nsd / 2 - 10,
    showPinholes:         sPH === 1,
    tangWidth:            tw  * 0.1 + 0.1,
    fretExtensionAmount:  fea / 2 - 10,
    inlayCustomPath:      pathResult.points,
    inlayCustomClosed:    pathResult.closed,
  };
}

function exportCode() {
  const code = encodeConfig(stateSnapshot());
  document.getElementById('configCodeInput').value = code;
  navigator.clipboard.writeText(code)
    .then(() => M.toast({ html: 'Code copied to clipboard!', displayLength: 2500 }))
    .catch(() => M.toast({ html: 'Code shown in field — copy manually.', displayLength: 3000 }));
}

function importCode() {
  const raw = document.getElementById('configCodeInput').value.trim();
  if (!raw) return;
  try {
    applyStateData(decodeConfig(raw));
    M.updateTextFields();
    updateUnitHints();
    updateShapeFields();
    calculate();
    M.toast({ html: 'Configuration applied!', displayLength: 2000 });
  } catch (e) {
    M.toast({ html: 'Invalid configuration code.', displayLength: 3000 });
  }
}

// ── Persistence ───────────────────────────────────────────────
// stateSnapshot always stores dimension values in mm so config codes are unit-independent.
function stateSnapshot() {
  const unit = document.getElementById('unit').value;
  const toMm = v => unit === 'inch' ? parseFloat(v) * MM_PER_IN : parseFloat(v);
  return {
    scaleLength:          toMm(document.getElementById('scaleLength').value),
    numberOfFrets:        document.getElementById('numberOfFrets').value,
    nutWidth:             toMm(document.getElementById('nutWidth').value),
    width12thFret:        toMm(document.getElementById('width12thFret').value),
    unit:                 unit,
    showFretNumbers:      document.getElementById('showFretNumbers').checked,
    showCenterLine:       document.getElementById('showCenterLine').checked,
    showWidthAnnotations: document.getElementById('showWidthAnnotations').checked,
    showInlays:           document.getElementById('showInlays').checked,
    doubleInlays:         document.getElementById('doubleInlays').checked,
    showBoundingBox:      document.getElementById('showBoundingBox').checked,
    inlayShape:           currentInlayPresetId,
    inlaySize:            parseFloat(document.getElementById('inlaySize').value),
    inlayHeight:          parseFloat(document.getElementById('inlayHeight').value),
    inlayPosition:        document.getElementById('inlayPosition').value,
    inlayDoubleOffset:    parseFloat(document.getElementById('inlayDoubleOffset').value),
    inlayDoubleOrientation:  document.getElementById('inlayDoubleOrientation').value,
    inlayShrinkWidth1224:    document.getElementById('inlayShrinkWidth1224').value,
    inlayShrinkHeight1224:   document.getElementById('inlayShrinkHeight1224').value,
    inlayShrinkWidth:        document.getElementById('inlayShrinkWidth').value,
    inlayGrowHeight:      document.getElementById('inlayGrowHeight').value,
    inlayTrapezoid:       document.getElementById('inlayTrapezoid').value,
    inlayParallelogram:   document.getElementById('inlayParallelogram').value,
    showRadius:           document.getElementById('showRadius').checked,
    radiusValue:          toMm(document.getElementById('radiusValue').value),
    radiusSteps:          document.getElementById('radiusSteps').value,
    showNutSlot:          document.getElementById('showNutSlot').checked,
    nutSlotWidth:         toMm(document.getElementById('nutSlotWidth').value),
    nutSlotDistance:      toMm(document.getElementById('nutSlotDistance').value),
    showPinholes:         document.getElementById('showPinholes').checked,
    tangWidth:            toMm(document.getElementById('tangWidth').value),
    fretExtensionAmount:  toMm(document.getElementById('fretExtensionAmount').value),
    accordionActive:      getAccordionActiveIndex(),
    inlayGroupsOpen:      getInlayGroupsState(),
    inlayCustomPath:      customPathPoints,
    inlayCustomClosed:    customPathClosed,
  };
}

function saveState() {
  const snap = stateSnapshot();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snap)); } catch (e) {}
  try {
    const input = document.getElementById('configCodeInput');
    if (input && document.activeElement !== input) input.value = encodeConfig(snap);
  } catch (e) {}
}

function restoreState() {
  let s;
  try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
  if (s) applyStateData(s);
}

// applyStateData receives mm dimension values; converts to display unit before setting inputs.
function applyStateData(s) {
  const unit = s.unit || 'mm';
  const d = v => (v == null) ? null : (unit === 'inch' ? (v / MM_PER_IN).toFixed(4) : v);

  const set = (id, v) => { if (v != null) document.getElementById(id).value = v; };
  const chk = (id, v) => { if (v != null) document.getElementById(id).checked = v; };
  const sld = (id, vid, v) => {
    if (v == null) return;
    document.getElementById(id).value = v;
    document.getElementById(vid).textContent = parseFloat(v).toFixed(2);
  };

  if (s.unit) {
    document.getElementById('unit').value = unit;
    M.FormSelect.init(document.getElementById('unit'));
    updateInputConstraints(unit);
    prevUnit = unit;
  }

  set('scaleLength', d(s.scaleLength));  set('numberOfFrets', s.numberOfFrets);
  set('nutWidth', d(s.nutWidth));        set('width12thFret', d(s.width12thFret));

  chk('showFretNumbers', s.showFretNumbers);  chk('showCenterLine', s.showCenterLine);
  chk('showWidthAnnotations', s.showWidthAnnotations);
  chk('showInlays', s.showInlays);  chk('doubleInlays', s.doubleInlays);
  chk('showBoundingBox', s.showBoundingBox);

  if (s.inlayShape) {
    currentInlayPresetId = s.inlayShape;
    const sel = document.getElementById('inlayPreset');
    if (sel) { sel.value = s.inlayShape; M.FormSelect.init(sel); }
  }
  if (s.inlayPosition) {
    const sel = document.getElementById('inlayPosition');
    if (sel) { sel.value = s.inlayPosition; M.FormSelect.init(sel); }
  }
  if (s.inlayDoubleOrientation) {
    const sel = document.getElementById('inlayDoubleOrientation');
    if (sel) { sel.value = s.inlayDoubleOrientation; M.FormSelect.init(sel); }
  }

  const setDimSld = (id, valId, v) => {
    if (v == null) return;
    const el = document.getElementById(id), valEl = document.getElementById(valId);
    if (!el || !valEl) return;
    el.value = v;
    const u = document.getElementById('unit').value;
    valEl.textContent = u === 'inch' ? (v / MM_PER_IN).toFixed(3) + ' in' : parseFloat(v).toFixed(1) + ' mm';
  };
  setDimSld('inlaySize',         'inlaySizeVal',         s.inlaySize);
  setDimSld('inlayHeight',       'inlayHeightVal',       s.inlayHeight);
  setDimSld('inlayDoubleOffset', 'inlayDoubleOffsetVal', s.inlayDoubleOffset);
  sld('inlayShrinkWidth1224',  'inlayShrinkWidth1224Val',  s.inlayShrinkWidth1224);
  sld('inlayShrinkHeight1224', 'inlayShrinkHeight1224Val', s.inlayShrinkHeight1224);
  sld('inlayShrinkWidth',   'inlayShrinkWidthVal',   s.inlayShrinkWidth);
  sld('inlayGrowHeight',    'inlayGrowHeightVal',    s.inlayGrowHeight);
  sld('inlayTrapezoid',     'inlayTrapezoidVal',     s.inlayTrapezoid);
  sld('inlayParallelogram', 'inlayParallelogramVal', s.inlayParallelogram);

  if (Array.isArray(s.inlayCustomPath)) {
    customPathPoints = s.inlayCustomPath
      .filter(p => Array.isArray(p) && (p.length === 2 || p.length === 4 || p.length === 6))
      .map(p => p.map(Number));
    customPathRedraw();
  }
  if (typeof s.inlayCustomClosed === 'boolean') {
    customPathClosed = s.inlayCustomClosed;
    customPathRedraw();
  }

  chk('showRadius',   s.showRadius);
  set('radiusValue',  d(s.radiusValue));
  set('radiusSteps',  s.radiusSteps);

  chk('showNutSlot',     s.showNutSlot);
  set('nutSlotWidth',    d(s.nutSlotWidth));
  set('nutSlotDistance', d(s.nutSlotDistance));
  chk('showPinholes',    s.showPinholes);
  set('tangWidth',           d(s.tangWidth));
  set('fretExtensionAmount', d(s.fretExtensionAmount));

  if (typeof s.accordionActive === 'number') {
    const inst = M.Collapsible.getInstance(document.getElementById('inputSections'));
    if (inst) {
      document.querySelectorAll('#inputSections > li').forEach((_, i) => inst.close(i));
      if (s.accordionActive >= 0) inst.open(s.accordionActive);
    }
  }
  if (s.inlayGroupsOpen) {
    document.querySelectorAll('[onclick^="toggleInlayGroup"]').forEach(h => {
      const span = h.querySelector('span'); if (!span) return;
      const key = span.textContent.trim();
      if (!(key in s.inlayGroupsOpen)) return;
      const body = h.nextElementSibling, icon = h.querySelector('.material-icons');
      const open = s.inlayGroupsOpen[key];
      if (body) body.style.display = open ? '' : 'none';
      if (icon) icon.style.transform = open ? 'rotate(0deg)' : 'rotate(-90deg)';
    });
  }
}
