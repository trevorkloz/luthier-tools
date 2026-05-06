'use strict';

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
let customPathPoints = [[]]; // 3-D: array of subpaths; each subpath = array of segments
let _cpActiveSubpath = 0;   // index of the currently-edited subpath
let customPathArcMode = false;
let customPathClosed = true;   // true → render filled closed area; false → open lines only
let customPathDrag = null;     // { mode, target, downXn, downYn, moved, ... }
let customPathCmdHeld = false; // true while Cmd (Mac) or Ctrl (Win) is pressed
let customPathSnapGrid = false;
let customPathGridStep = 0.1; // normalized grid step when snap is active (default: 10 divisions)
const CUSTOM_PATH_VB         = 100;
const CUSTOM_PATH_MARGIN     = 30;                                       // extra VB units around the window on each side
const CUSTOM_PATH_CANVAS_VB  = CUSTOM_PATH_VB + 2 * CUSTOM_PATH_MARGIN; // 160 — total canvas VB width/height
// Live viewBox of the canvas SVG — updated each redraw to show the full shape.
// [minX, minY, width, height] in SVG-unit space (1 SVG unit = 1/100 of normalized space).
let _cpViewBox = [-CUSTOM_PATH_MARGIN, -CUSTOM_PATH_MARGIN, CUSTOM_PATH_CANVAS_VB, CUSTOM_PATH_CANVAS_VB];
const CUSTOM_PATH_SNAP_DIST = 6;
// Point-hit radius is intentionally larger than segment-hit so clicks just outside a vertex's
// visible circle still latch onto the vertex (drag intent) rather than landing on the
// segment line that passes through it and inserting a stray vertex.
const CUSTOM_PATH_POINT_HIT_RADIUS   = 5;
const CUSTOM_PATH_SEGMENT_HIT_RADIUS = 3;
// Wider "missed drag" radius used at mouseUp time to suppress click-add / segment-insert
// when the release lands close to any existing point. Without this, Q segments whose curve
// passes near an endpoint absorb the click and silently insert a de-Casteljau vertex.
const CUSTOM_PATH_NEAR_POINT_RADIUS  = 8;
const CUSTOM_PATH_HIT_RADIUS         = CUSTOM_PATH_POINT_HIT_RADIUS; // back-compat alias

// ── Pan / zoom / maximize state ───────────────────────────────────────────────
let _cpViewCx = CUSTOM_PATH_VB / 2; // view centre in SVG units (default = mid of [0,100])
let _cpViewCy = CUSTOM_PATH_VB / 2;
let _cpZoom   = 1.0;                 // >1 = zoomed in, <1 = zoomed out

function cpComputeViewBox() {
  const half = CUSTOM_PATH_CANVAS_VB / (2 * _cpZoom);
  return [_cpViewCx - half, _cpViewCy - half, half * 2, half * 2];
}

function cpResetView() {
  _cpViewCx = CUSTOM_PATH_VB / 2;
  _cpViewCy = CUSTOM_PATH_VB / 2;
  _cpZoom   = 1.0;
}

let _cpSpaceHeld       = false; // Space held while mouse is over the canvas
let _cpMouseOverCanvas = false;
let _cpMaximized       = false;
let _cpEditorParent    = null;  // original DOM parent when editor is moved to body
let _cpEditorNext      = null;  // next sibling — restores original DOM position

// ── History (undo / redo) ─────────────────────────────────────────────────────
const CP_HISTORY_MAX = 60;
let _cpHistory    = [];
let _cpHistoryIdx = -1;

function cpSnapshot() {
  return {
    points:        customPathPoints.map(sp => sp.map(seg => seg.slice())),
    closed:        customPathClosed,
    activeSubpath: _cpActiveSubpath,
  };
}

function cpHistoryPush() {
  if (_cpHistory.length === 0) { _cpHistory.push(cpSnapshot()); _cpHistoryIdx = 0; }
  _cpHistory.splice(_cpHistoryIdx + 1);
  _cpHistory.push(cpSnapshot());
  if (_cpHistory.length > CP_HISTORY_MAX) _cpHistory.shift();
  else _cpHistoryIdx++;
  cpUpdateHistoryButtons();
}

function cpUndo() {
  if (_cpHistoryIdx <= 0) return;
  _cpHistoryIdx--;
  const s = _cpHistory[_cpHistoryIdx];
  customPathPoints = s.points.map(sp => sp.map(seg => seg.slice()));
  customPathClosed = s.closed;
  _cpActiveSubpath = Math.min(s.activeSubpath, customPathPoints.length - 1);
  customPathRedraw();
  scheduleCalculate();
}

function cpRedo() {
  if (_cpHistoryIdx >= _cpHistory.length - 1) return;
  _cpHistoryIdx++;
  const s = _cpHistory[_cpHistoryIdx];
  customPathPoints = s.points.map(sp => sp.map(seg => seg.slice()));
  customPathClosed = s.closed;
  _cpActiveSubpath = Math.min(s.activeSubpath, customPathPoints.length - 1);
  customPathRedraw();
  scheduleCalculate();
}

function cpUpdateHistoryButtons() {
  const u = document.getElementById('cpUndoBtn');
  const r = document.getElementById('cpRedoBtn');
  if (u) { const on = _cpHistoryIdx > 0;                          u.disabled = !on; u.style.opacity = on ? '1' : '.35'; }
  if (r) { const on = _cpHistoryIdx < _cpHistory.length - 1;      r.disabled = !on; r.style.opacity = on ? '1' : '.35'; }
}

document.addEventListener('keydown', function(e) {
  const editor = document.getElementById('customPathEditor');
  if (!editor || editor.style.display === 'none') return;
  if (e.key === 'Escape' && _cpMaximized) { e.preventDefault(); customPathToggleMaximize(); return; }
  if (e.key === ' ' && _cpMouseOverCanvas) {
    e.preventDefault();
    _cpSpaceHeld = true;
    if (!customPathDrag) {
      const svg = document.getElementById('customPathCanvas');
      if (svg) svg.style.cursor = 'grab';
    }
    return;
  }
  if (e.metaKey || e.ctrlKey) {
    if (e.key === 'z' && !e.shiftKey)                          { e.preventDefault(); cpUndo(); }
    else if (e.key === 'y' || (e.key === 'z' && e.shiftKey))  { e.preventDefault(); cpRedo(); }
  }
});

document.addEventListener('keyup', function(e) {
  if (e.key === ' ') {
    _cpSpaceHeld = false;
    if (!customPathDrag) customPathUpdateCursor();
  }
});

// Snap a single normalized coordinate to the nearest grid step when snap is active.
function cpSnap(v) {
  if (!customPathSnapGrid) return v;
  return Math.round(v / customPathGridStep) * customPathGridStep;
}

const CUSTOM_PATH_DRAG_THRESHOLD  = 1.5; // vb units of movement before a drag is committed
const CUSTOM_PATH_CLICK_THRESHOLD = 0.8; // max excursion (vb) that still counts as a clean click

// Returns the endpoint [x, y] of any segment regardless of type (L / Q / C).
function customPathSegEnd(seg) {
  return seg.length === 2 ? [seg[0], seg[1]]
       : seg.length === 4 ? [seg[2], seg[3]]
       : seg.length === 6 ? [seg[4], seg[5]]
       : [0, 0];
}

// Converts a mouse event into normalized [0,1] canvas coordinates using the live viewBox.
// The viewBox expands when the shape goes outside the default window, so this mapping
// must use _cpViewBox rather than a fixed size.
function customPathEventPos(evt) {
  const svg  = document.getElementById('customPathCanvas');
  const rect = svg.getBoundingClientRect();
  const [vx0, vy0, vw, vh] = _cpViewBox;
  const xv = vx0 + (evt.clientX - rect.left) / rect.width  * vw;
  const yv = vy0 + (evt.clientY - rect.top)  / rect.height * vh;
  return { xn: xv / CUSTOM_PATH_VB, yn: yv / CUSTOM_PATH_VB };
}

// Build the full list of hit-testable targets.
// Active subpath: vertices (circles) and control points (squares) — all draggable.
// Inactive subpaths: all vertex endpoints exposed as 'switchSubpath' — read-only.
// coordOffset is the index inside the segment array where the target's [x, y] starts,
// used later to write new coords directly into customPathPoints on drag.
function customPathHitTargets() {
  const out = [];
  customPathPoints[_cpActiveSubpath].forEach((seg, i) => {
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
  // All endpoints of inactive subpaths — clicking any one switches the active subpath.
  for (let si = 0; si < customPathPoints.length; si++) {
    if (si === _cpActiveSubpath) continue;
    for (const seg of customPathPoints[si]) {
      const [ex, ey] = customPathSegEnd(seg);
      out.push({ kind: 'switchSubpath', subpathIndex: si, x: ex, y: ey });
    }
  }
  return out;
}

// Distance from point (px, py) to line segment (x0,y0)–(x1,y1). Returns { dist, t }.
// t is the clamped projection parameter: 0 = closest point is x0,y0; 1 = x1,y1.
// Uses the dot-product projection: t = dot(AP, AB) / dot(AB, AB), clamped to [0,1].
function customPathDistToLine(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t  = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
  const cx = x0 + t * dx, cy = y0 + t * dy;
  return { dist: Math.sqrt((px - cx) ** 2 + (py - cy) ** 2), t };
}

// Approximate distance from (px, py) to a quadratic Bezier by sampling 24 evenly-spaced points.
// An analytical closest-point on a quadratic is a degree-5 problem; brute-force sampling is fast
// and accurate enough at the 3-vb hit tolerance used here (error < 0.01 vb for typical shapes).
function customPathDistToQuad(px, py, x0, y0, cx, cy, x1, y1) {
  let best = { dist: Infinity, t: 0 };
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    // Standard quadratic Bezier: B(t) = u²·P0 + 2ut·P1 + t²·P2
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const d = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
    if (d < best.dist) best = { dist: d, t };
  }
  return best;
}

// Hit-test against segment edges (lines + quadratics) of the active subpath only.
// Returns { segIndex, t, prev } or null. segIndex === -1 means the implicit closing edge.
function customPathSegmentHit(xn, yn) {
  const pts = customPathPoints[_cpActiveSubpath];
  let best = null;
  let bestDist = CUSTOM_PATH_SEGMENT_HIT_RADIUS;
  for (let i = 1; i < pts.length; i++) {
    const prev = customPathSegEnd(pts[i - 1]);
    const seg  = pts[i];
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
  // Also test the implicit closing edge (last endpoint back to start).
  if (pts.length >= 3) {
    const last  = customPathSegEnd(pts[pts.length - 1]);
    const start = pts[0];
    const r = customPathDistToLine(xn, yn, last[0], last[1], start[0], start[1]);
    const dVb = r.dist * CUSTOM_PATH_VB;
    if (dVb < bestDist) {
      bestDist = dVb;
      best = { segIndex: -1, t: r.t, prev: last, isClosing: true };
    }
  }
  return best;
}

// Insert a new vertex on the segment that was hit, splitting it into two curves.
// Line: just inserts the click position. Quadratic: uses de Casteljau subdivision at t.
//
// De Casteljau at parameter t for a quadratic (P0, P1, P2):
//   Q0 = lerp(P0, P1, t)  ← new control for first sub-curve
//   Q1 = lerp(P1, P2, t)  ← new control for second sub-curve
//   R  = lerp(Q0, Q1, t)  ← the split point (new shared endpoint)
// This guarantees the two new curves together trace the exact same shape as the original.
function customPathInsertOnSegment(hit, xn, yn) {
  const pts  = customPathPoints[_cpActiveSubpath];
  const i    = hit.segIndex;
  const prev = hit.prev;
  const seg  = pts[i];
  const t    = hit.t;

  if (seg.length === 2) {
    pts.splice(i, 0, [xn, yn]);
  } else if (seg.length === 4) {
    const p0 = prev;
    const p1 = [seg[0], seg[1]];
    const p2 = [seg[2], seg[3]];
    const u  = 1 - t;
    const q0 = [u * p0[0] + t * p1[0], u * p0[1] + t * p1[1]];
    const q1 = [u * p1[0] + t * p2[0], u * p1[1] + t * p2[1]];
    const r  = [u * q0[0] + t * q1[0], u * q0[1] + t * q1[1]];
    // Replace original Q with two Q segments sharing R as their boundary.
    pts.splice(i, 1,
      [q0[0], q0[1], r[0],  r[1] ],  // P0 → R, control = Q0
      [q1[0], q1[1], p2[0], p2[1]]   // R → P2, control = Q1
    );
  }
}

// Find the closest hit target to (xn, yn), or null if nothing is within range.
// Vertices beat control points in near-ties (0.5 vb tolerance) so a vertex sitting
// on top of a cp is always grabbed first.
// Falls back to testing edges of inactive subpaths so clicking anywhere on a shape activates it.
function customPathHitTest(xn, yn) {
  let best = null;
  let bestDist = CUSTOM_PATH_POINT_HIT_RADIUS;
  for (const t of customPathHitTargets()) {
    const dx = (t.x - xn) * CUSTOM_PATH_VB;
    const dy = (t.y - yn) * CUSTOM_PATH_VB;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d > bestDist) continue;
    // Prefer a vertex over a cp at similar distances; otherwise take the strictly closer one.
    if (best === null || (t.kind === 'vertex' && best.kind !== 'vertex') || d < bestDist - 0.5) {
      best = t;
      bestDist = d;
    }
  }
  if (best) return best;
  // Fallback: hit-test the edge lines/curves of every inactive subpath.
  for (let si = 0; si < customPathPoints.length; si++) {
    if (si === _cpActiveSubpath) continue;
    const sp = customPathPoints[si];
    for (let i = 1; i < sp.length; i++) {
      const prev = customPathSegEnd(sp[i - 1]);
      const seg  = sp[i];
      let r;
      if (seg.length === 2) {
        r = customPathDistToLine(xn, yn, prev[0], prev[1], seg[0], seg[1]);
      } else if (seg.length === 4) {
        r = customPathDistToQuad(xn, yn, prev[0], prev[1], seg[0], seg[1], seg[2], seg[3]);
      } else continue;
      if (r.dist * CUSTOM_PATH_VB < CUSTOM_PATH_SEGMENT_HIT_RADIUS) {
        return { kind: 'switchSubpath', subpathIndex: si };
      }
    }
  }
  return null;
}

function customPathDeleteTarget(target) {
  if (target.kind === 'switchSubpath') return; // read-only — ignore
  cpHistoryPush();
  const pts = customPathPoints[_cpActiveSubpath];
  const i   = target.segIndex;
  if (target.kind === 'cp') {
    const seg = pts[i];
    if (seg.length === 4) {
      pts[i] = [seg[2], seg[3]]; // Q → L (drop the control point)
    } else if (seg.length === 6) {
      // Remove one control handle from a cubic → degrades to a quadratic.
      pts[i] = (target.coordOffset === 0)
        ? [seg[2], seg[3], seg[4], seg[5]]  // drop c1 → Q with c2
        : [seg[0], seg[1], seg[4], seg[5]]; // drop c2 → Q with c1
    }
  } else {
    if (i === 0) {
      // Deleting the start vertex: promote the next segment's endpoint as the new start,
      // or wipe the whole subpath if only one segment remains.
      if (pts.length === 1) {
        if (customPathPoints.length > 1) {
          customPathPoints.splice(_cpActiveSubpath, 1);
          _cpActiveSubpath = Math.max(0, _cpActiveSubpath - 1);
        } else {
          customPathPoints[0] = [];
        }
      } else {
        const next     = pts[1];
        const newStart = customPathSegEnd(next);
        pts[0] = [newStart[0], newStart[1]];
        pts.splice(1, 1);
      }
    } else {
      pts.splice(i, 1);
    }
  }
}

function customPathClick(evt) {
  cpHistoryPush();
  const { xn: _xRaw, yn: _yRaw } = customPathEventPos(evt);
  const x = cpSnap(_xRaw), y = cpSnap(_yRaw);
  const pts = customPathPoints[_cpActiveSubpath];

  if (pts.length === 0) {
    pts.push([x, y]);
    customPathRedraw();
    scheduleCalculate();
    return;
  }

  // Segment edge hit is checked BEFORE the close-to-start gesture: the first edge starts
  // at the start vertex, and we don't want the close-snap radius to eat clicks on it.
  const segHit = customPathSegmentHit(x, y);
  if (segHit) {
    const cmd = evt.metaKey || evt.ctrlKey;
    if (cmd) {
      // Cmd/Ctrl+click on a segment toggles L↔Q without inserting a new vertex.
      if (segHit.isClosing) {
        // The closing edge is always an implicit straight Z. Cmd+click adds a Q arc on it.
        pts.push([x, y, pts[0][0], pts[0][1]]);
      } else {
        const seg = pts[segHit.segIndex];
        if (seg.length === 2) {
          pts[segHit.segIndex] = [x, y, seg[0], seg[1]]; // L → Q: click becomes the control handle
        } else if (seg.length === 4) {
          pts[segHit.segIndex] = [seg[2], seg[3]];        // Q → L: drop the control point
        }
        // Cubic (length 6): Cmd+click is a no-op.
      }
      customPathRedraw();
      scheduleCalculate();
      return;
    }
    if (segHit.isClosing) {
      // Click on the implicit closing edge.
      // Line mode: split it by inserting a vertex.
      // Arc mode: convert the closing line to a Q whose endpoint stays at the start,
      //   with the click as its control handle — drag the square to shape it.
      if (customPathArcMode) {
        pts.push([x, y, pts[0][0], pts[0][1]]);
      } else {
        pts.push([x, y]);
      }
    } else {
      const seg = pts[segHit.segIndex];
      if (customPathArcMode && seg.length === 2) {
        // Arc mode on an L: promote to Q with the click as the control handle.
        // Endpoints stay; only the curve shape changes.
        pts[segHit.segIndex] = [x, y, seg[0], seg[1]];
      } else {
        customPathInsertOnSegment(segHit, x, y);
      }
    }
    customPathRedraw();
    scheduleCalculate();
    return;
  }

  if (customPathArcMode) {
    // In Arc mode, place the control point at the midpoint between the previous endpoint
    // and the click. This makes the new Q look like a straight line initially; the user
    // drags the orange square afterwards to bend the curve.
    const prev = customPathSegEnd(pts[pts.length - 1]);
    const cpx  = (prev[0] + x) / 2;
    const cpy  = (prev[1] + y) / 2;
    pts.push([cpx, cpy, x, y]);
  } else {
    pts.push([x, y]);
  }
  customPathRedraw();
  scheduleCalculate();
}

function customPathMouseDown(evt) {
  // Space + left-drag: pan the canvas.
  if (evt.button === 0 && _cpSpaceHeld) {
    evt.preventDefault();
    const rect = document.getElementById('customPathCanvas').getBoundingClientRect();
    customPathDrag = {
      mode:        'pan',
      downClientX: evt.clientX,
      downClientY: evt.clientY,
      rectWidth:   rect.width,
      rectHeight:  rect.height,
      downViewCx:  _cpViewCx,
      downViewCy:  _cpViewCy,
    };
    document.getElementById('customPathCanvas').style.cursor = 'grabbing';
    return;
  }

  // Right-click: delete the hit target, or switch subpath if it's an inactive one.
  if (evt.button === 2) {
    evt.preventDefault();
    const { xn, yn } = customPathEventPos(evt);
    const hit = customPathHitTest(xn, yn);
    if (hit) {
      if (hit.kind === 'switchSubpath') {
        _cpActiveSubpath = hit.subpathIndex;
        customPathRedraw();
      } else {
        customPathDeleteTarget(hit);
        customPathRedraw();
        scheduleCalculate();
      }
    }
    return;
  }
  if (evt.button !== 0) return;

  const { xn, yn } = customPathEventPos(evt);

  // Shift+drag translates all subpaths together.
  // Snapshot the full bbox now so each mousemove can clamp against the original extents,
  // avoiding accumulated floating-point drift from repeated delta additions.
  if (evt.shiftKey) {
    const hit = customPathHitTest(xn, yn);
    if (hit) {
      // Shift+drag on a point: translate just that subpath.
      const si = hit.kind === 'switchSubpath' ? hit.subpathIndex : _cpActiveSubpath;
      if (hit.kind === 'switchSubpath') _cpActiveSubpath = si;
      const sp = customPathPoints[si];
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const seg of sp) {
        for (let k = 0; k < seg.length; k += 2) {
          if (seg[k]     < minX) minX = seg[k];
          if (seg[k]     > maxX) maxX = seg[k];
          if (seg[k + 1] < minY) minY = seg[k + 1];
          if (seg[k + 1] > maxY) maxY = seg[k + 1];
        }
      }
      customPathDrag = {
        mode:         'translateSubpath',
        subpathIndex: si,
        downXn:       xn,
        downYn:       yn,
        moved:        false,
        original:     sp.map(seg => seg.slice()),
        origBBox:     { minX, minY, maxX, maxY },
      };
      return;
    }
    // No hit → translate all subpaths together.
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const sp of customPathPoints) {
      for (const seg of sp) {
        for (let k = 0; k < seg.length; k += 2) {
          if (seg[k]     < minX) minX = seg[k];
          if (seg[k]     > maxX) maxX = seg[k];
          if (seg[k + 1] < minY) minY = seg[k + 1];
          if (seg[k + 1] > maxY) maxY = seg[k + 1];
        }
      }
    }
    customPathDrag = {
      mode:     'translate',
      downXn:   xn,
      downYn:   yn,
      moved:    false,
      original: customPathPoints.map(sp => sp.map(seg => seg.slice())),
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

// Re-evaluates the cursor based on the last known mouse position.
// Called on keydown/keyup (Cmd/Shift) so the cursor updates without requiring a mouse move.
function customPathUpdateCursor() {
  if (_customPathLastXn < 0 || customPathDrag) return;
  const svg = document.getElementById('customPathCanvas');
  if (!svg) return;
  if (_cpSpaceHeld) { svg.style.cursor = 'grab'; return; }
  const ptHit = customPathHitTest(_customPathLastXn, _customPathLastYn);
  if (ptHit) { svg.style.cursor = ptHit.kind === 'switchSubpath' ? 'pointer' : 'grab'; return; }
  if (customPathPoints[_cpActiveSubpath].length >= 1 && customPathSegmentHit(_customPathLastXn, _customPathLastYn)) {
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
    // Hover cursor feedback (no button held).
    if (evt.shiftKey && customPathPoints.some(sp => sp.length > 0)) {
      svg.style.cursor = 'move'; // shift-hover signals translate mode
    } else {
      const ptHit = customPathHitTest(xn, yn);
      if (ptHit) {
        svg.style.cursor = ptHit.kind === 'switchSubpath' ? 'pointer' : 'grab';
      } else if (customPathPoints[_cpActiveSubpath].length >= 1 && customPathSegmentHit(xn, yn)) {
        // Cmd/Ctrl over a segment: pointer = "toggle L↔Q"; otherwise cell = "insert vertex".
        svg.style.cursor = customPathCmdHeld ? 'pointer' : 'cell';
      } else {
        svg.style.cursor = 'crosshair';
      }
    }
    return;
  }

  if (customPathDrag.mode === 'pan') {
    svg.style.cursor = 'grabbing';
    const viewSize = CUSTOM_PATH_CANVAS_VB / _cpZoom;
    _cpViewCx = customPathDrag.downViewCx + (customPathDrag.downClientX - evt.clientX) / customPathDrag.rectWidth  * viewSize;
    _cpViewCy = customPathDrag.downViewCy + (customPathDrag.downClientY - evt.clientY) / customPathDrag.rectHeight * viewSize;
    customPathRedraw();
    return;
  }

  const dxN  = xn - customPathDrag.downXn;
  const dyN  = yn - customPathDrag.downYn;
  const dist = Math.sqrt(dxN * dxN + dyN * dyN) * CUSTOM_PATH_VB;
  // Track maximum excursion from the down point so mouseUp can detect wobble
  // (user moved then returned) and treat it as a missed drag rather than a click.
  if (dist > (customPathDrag.maxDist || 0)) customPathDrag.maxDist = dist;
  if (!customPathDrag.moved && dist > CUSTOM_PATH_DRAG_THRESHOLD) { cpHistoryPush(); customPathDrag.moved = true; }
  if (!customPathDrag.moved) return;

  if (customPathDrag.mode === 'translate') {
    svg.style.cursor = 'grabbing';
    const orig = customPathDrag.original;
    // Clamp the delta so the full bounding box stays inside [0, 1].
    // Using the original bbox (not the current one) prevents clamping errors from compounding.
    const bb  = customPathDrag.origBBox;
    const cdx = Math.max(-bb.minX, Math.min(1 - bb.maxX, dxN));
    const cdy = Math.max(-bb.minY, Math.min(1 - bb.maxY, dyN));
    for (let si = 0; si < customPathPoints.length; si++) {
      for (let i = 0; i < (orig[si] || []).length; i++) {
        const o    = orig[si][i];
        const next = o.slice();
        for (let k = 0; k < o.length; k += 2) {
          next[k]     = o[k]     + cdx;
          next[k + 1] = o[k + 1] + cdy;
        }
        customPathPoints[si][i] = next;
      }
    }
    customPathRedraw();
    return;
  }

  if (customPathDrag.mode === 'translateSubpath') {
    svg.style.cursor = 'grabbing';
    const si   = customPathDrag.subpathIndex;
    const orig = customPathDrag.original;
    const bb   = customPathDrag.origBBox;
    const cdx  = Math.max(-bb.minX, Math.min(1 - bb.maxX, dxN));
    const cdy  = Math.max(-bb.minY, Math.min(1 - bb.maxY, dyN));
    customPathPoints[si] = orig.map(seg => {
      const next = seg.slice();
      for (let k = 0; k < seg.length; k += 2) {
        next[k]     = seg[k]     + cdx;
        next[k + 1] = seg[k + 1] + cdy;
      }
      return next;
    });
    customPathRedraw();
    return;
  }

  // mode === 'point'
  if (customPathDrag.target) {
    // Inactive-subpath targets have no segIndex/coordOffset — skip dragging them.
    if (customPathDrag.target.kind === 'switchSubpath') return;
    svg.style.cursor = 'grabbing';
    const t   = customPathDrag.target;
    const pts = customPathPoints[_cpActiveSubpath];
    const oldX = pts[t.segIndex][t.coordOffset];
    const oldY = pts[t.segIndex][t.coordOffset + 1];
    const newX = cpSnap(xn);
    const newY = cpSnap(yn);
    pts[t.segIndex][t.coordOffset]     = newX;
    pts[t.segIndex][t.coordOffset + 1] = newY;
    // When dragging the start vertex, sync any segment whose endpoint coincides with
    // the old start. This keeps a closing Q arc (whose endpoint IS the start) in sync
    // instead of leaving a stranded dot at the original position.
    if (t.segIndex === 0 && t.coordOffset === 0) {
      const eps = 0.0005;
      for (let i = 1; i < pts.length; i++) {
        const seg    = pts[i];
        const endOff = seg.length - 2;
        if (endOff >= 0
            && Math.abs(seg[endOff]     - oldX) < eps
            && Math.abs(seg[endOff + 1] - oldY) < eps) {
          seg[endOff]     = newX;
          seg[endOff + 1] = newY;
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

  // Pan drag: cursor update only, never fires a click.
  if (drag.mode === 'pan') { customPathUpdateCursor(); return; }

  // A real drag: commit the moved state and stop. Do NOT also treat this as a click.
  if (drag.moved) { scheduleCalculate(); return; }

  // Shift-press without any movement → no-op. Avoids the foot-gun where releasing Shift
  // without moving the mouse would be misread as a click that deletes or adds a point.
  if (drag.mode === 'translate' || drag.mode === 'translateSubpath') return;

  // No movement — treat as a tap on the down-point target.
  if (drag.target) {
    if (drag.target.kind === 'switchSubpath') {
      // Tap on an inactive subpath (vertex or edge) → make it the active one.
      _cpActiveSubpath = drag.target.subpathIndex;
      customPathRedraw();
      return;
    }
    // Tap on the start vertex with ≥3 segments: close gesture (no new point added).
    if (drag.target.kind === 'vertex' && drag.target.segIndex === 0
        && customPathPoints[_cpActiveSubpath].length >= 3) {
      customPathRedraw();
      scheduleCalculate();
    }
    return;
  }

  // No target hit. Guard 1: if the mouse wobbled past CLICK_THRESHOLD (even without
  // triggering 'moved'), treat the release as a cancelled drag, not a click.
  if ((drag.maxDist || 0) > CUSTOM_PATH_CLICK_THRESHOLD) return;

  const { xn, yn } = customPathEventPos(evt);
  const activePts  = customPathPoints[_cpActiveSubpath];

  // Guard 2 (close-to-start priority): clicking within SNAP_DIST of the start on a
  // 3+-segment path closes the shape rather than adding a stray vertex on top of it.
  if (activePts.length >= 3) {
    const [sx, sy] = activePts[0];
    const dxs = (sx - xn) * CUSTOM_PATH_VB;
    const dys = (sy - yn) * CUSTOM_PATH_VB;
    if (Math.sqrt(dxs * dxs + dys * dys) <= CUSTOM_PATH_SNAP_DIST) {
      customPathRedraw();
      scheduleCalculate();
      return;
    }
  }

  // Guard 3 (missed-drag suppression): if the release is within NEAR_POINT_RADIUS of
  // any existing target, the user probably missed a drag rather than clicking next to it.
  // This stops Q curves that pass near an endpoint from absorbing the click and inserting
  // an invisible de-Casteljau vertex.
  const nearR2 = CUSTOM_PATH_NEAR_POINT_RADIUS * CUSTOM_PATH_NEAR_POINT_RADIUS;
  for (const t of customPathHitTargets()) {
    const dx = (t.x - xn) * CUSTOM_PATH_VB;
    const dy = (t.y - yn) * CUSTOM_PATH_VB;
    if (dx * dx + dy * dy < nearR2) return;
  }

  customPathClick(evt);
}

function customPathContextMenu(evt) {
  evt.preventDefault(); // suppress native menu so right-click can be used for delete
}

function customPathRedraw() {
  const svg = document.getElementById('customPathCanvas');
  if (!svg) return;

  // Update mode-button appearance to reflect current arc/line state.
  const lineModeBtn = document.getElementById('cpLineModeBtn');
  const arcModeBtn  = document.getElementById('cpArcModeBtn');
  if (lineModeBtn) { lineModeBtn.style.background = !customPathArcMode ? '#0277bd' : '#fff'; lineModeBtn.style.color = !customPathArcMode ? '#fff' : '#455a64'; }
  if (arcModeBtn)  { arcModeBtn.style.background  =  customPathArcMode ? '#0277bd' : '#fff'; arcModeBtn.style.color  =  customPathArcMode ? '#fff' : '#455a64'; }
  const filledBtn = document.getElementById('cpFilledBtn');
  const strokeBtn = document.getElementById('cpStrokeBtn');
  if (filledBtn) { filledBtn.style.background = customPathClosed  ? '#0277bd' : '#fff'; filledBtn.style.color = customPathClosed  ? '#fff' : '#455a64'; }
  if (strokeBtn) { strokeBtn.style.background = !customPathClosed ? '#0277bd' : '#fff'; strokeBtn.style.color = !customPathClosed ? '#fff' : '#455a64'; }
  const snapBtn = document.getElementById('cpSnapBtn');
  if (snapBtn) { snapBtn.style.background = customPathSnapGrid ? '#0277bd' : '#fff'; snapBtn.style.color = customPathSnapGrid ? '#fff' : '#455a64'; }
  const gridSel = document.getElementById('cpGridStepSel');
  if (gridSel) { gridSel.disabled = !customPathSnapGrid; gridSel.closest('.select-wrapper')?.classList.toggle('disabled', !customPathSnapGrid); }
  const maxBtn = document.getElementById('cpMaximizeBtn');
  if (maxBtn) { const ic = maxBtn.querySelector('i.material-icons'); if (ic) ic.textContent = _cpMaximized ? 'close_fullscreen' : 'open_in_full'; }
  cpUpdateHistoryButtons();

  // Compute display scale so all handles and strokes render at a constant pixel size
  // regardless of the current zoom level or physical canvas size (compact vs maximized).
  // pxPerUnit = how many screen pixels correspond to one SVG unit.
  const svgRect   = svg.getBoundingClientRect();
  const canvasPx  = svgRect.width > 0 ? svgRect.width : 280;
  const pxPerUnit = canvasPx * _cpZoom / CUSTOM_PATH_CANVAS_VB;
  const u         = 1 / pxPerUnit; // 1 screen pixel expressed in SVG units

  const rVert   = 3.0  * u;   // vertex circle radius       (target ~3 px)
  const swVert  = 1.0  * u;   // vertex circle stroke       (target ~1 px)
  const swShape = 1.0  * u;   // path stroke width          (target ~1 px)
  const swBrd   = 1.0  * u;   // dashed border stroke       (target ~1 px)
  const daBrd   = 3.5  * u;   // border dash length/gap     (target ~3.5 px)
  const swQ     = 0.7  * u;   // quarter-grid stroke        (target ~0.7 px)
  const swFine  = 0.4  * u;   // fine snap-grid stroke      (target ~0.4 px)
  const swArm   = 0.5  * u;   // bezier arm stroke          (target ~0.5 px)
  const daArm   = 1.75 * u;   // arm dash length/gap        (target ~1.75 px)
  const sqHalf  = 2.0  * u;   // control-square half-size   (total ~4 px)
  const swSq    = 0.8  * u;   // control-square stroke      (target ~0.8 px)

  // Static background: white fill, quarter-grid, dashed border.
  // The shape is NOT clipped to this border — it can extend into the gray margin area.
  const M  = CUSTOM_PATH_MARGIN;
  const VB = CUSTOM_PATH_VB;
  // When snap is active, draw fine grid lines at the current customPathGridStep.
  // Skip positions that coincide with the quarter-grid at 25, 50, 75.
  const snapGridLines = customPathSnapGrid
    ? (() => {
        const step = customPathGridStep * VB;
        const lines = [];
        const quarterSet = new Set([25, 50, 75]);
        for (let g = step; g < VB - 0.001; g += step) {
          const gr = Math.round(g * 1000) / 1000;
          if (quarterSet.has(Math.round(gr))) continue;
          lines.push(
            `<line x1="${gr}" y1="0" x2="${gr}" y2="${VB}" stroke="#eceff1" stroke-width="${swFine}"/>`,
            `<line x1="0" y1="${gr}" x2="${VB}" y2="${gr}" stroke="#eceff1" stroke-width="${swFine}"/>`,
          );
        }
        return lines;
      })()
    : [];
  const background = [
    `<rect x="0" y="0" width="${VB}" height="${VB}" fill="white"/>`,
    ...snapGridLines,
    ...[25, 50, 75].flatMap(g => [
      `<line x1="${g}" y1="0" x2="${g}" y2="${VB}" stroke="#eceff1" stroke-width="${swQ}"/>`,
      `<line x1="0" y1="${g}" x2="${VB}" y2="${g}" stroke="#eceff1" stroke-width="${swQ}"/>`,
    ]),
    `<rect x="0" y="0" width="${VB}" height="${VB}" fill="none" stroke="#90caf9" stroke-width="${swBrd}" stroke-dasharray="${daBrd},${daBrd}"/>`,
  ];

  // Build the combined SVG path d — one M…[Z] block per subpath.
  // fill-rule="evenodd" makes overlapping subpaths render as holes (e.g. letter "A").
  let d = '';
  for (const sp of customPathPoints) {
    if (sp.length < 1) continue;
    const [sx, sy] = sp[0];
    d += (d ? ' ' : '') + `M ${sx * VB} ${sy * VB}`;
    for (let i = 1; i < sp.length; i++) {
      const seg = sp[i];
      if (seg.length === 2) {
        d += ` L ${seg[0] * VB} ${seg[1] * VB}`;
      } else if (seg.length === 4) {
        d += ` Q ${seg[0] * VB} ${seg[1] * VB} ${seg[2] * VB} ${seg[3] * VB}`;
      } else if (seg.length === 6) {
        d += ` C ${seg[0] * VB} ${seg[1] * VB} ${seg[2] * VB} ${seg[3] * VB} ${seg[4] * VB} ${seg[5] * VB}`;
      }
    }
    if (customPathClosed && sp.length >= 3) d += ' Z';
  }

  let shape = '';
  if (d) {
    if (customPathClosed) {
      shape = `<path d="${d}" fill-rule="evenodd" fill="#bbdefb" fill-opacity="0.5" stroke="#0277bd" stroke-width="${swShape}"/>`;
    } else {
      shape = `<path d="${d}" fill="none" stroke="#0277bd" stroke-width="${swShape}"/>`;
    }
  }

  // Vertex circles — all subpaths; active at full opacity, inactive dimmed to 35%.
  // Non-start vertices drawn first, start vertex last so it wins z-order.
  let verts = '';
  for (let si = 0; si < customPathPoints.length; si++) {
    const sp       = customPathPoints[si];
    const isActive = si === _cpActiveSubpath;
    const opacity  = isActive ? 1.0 : 0.35;
    for (let i = 1; i < sp.length; i++) {
      const [vx, vy] = customPathSegEnd(sp[i]);
      verts += `<circle cx="${vx * VB}" cy="${vy * VB}" r="${rVert}" fill="#fff" stroke="#0277bd" stroke-width="${swVert}" opacity="${opacity}"/>`;
    }
    if (sp.length > 0) {
      const [sx2, sy2] = sp[0];
      const startFill  = isActive ? '#0277bd' : '#90caf9'; // solid blue for active start, lighter for inactive
      verts += `<circle cx="${sx2 * VB}" cy="${sy2 * VB}" r="${rVert}" fill="${startFill}" stroke="#0277bd" stroke-width="${swVert}" opacity="${opacity}" title="Subpath ${si + 1}"/>`;
    }
  }

  // Control-point handles for Q segments of the active subpath.
  // Each handle: two dashed arms (to prev/next endpoint) + a small square knob.
  const activeSp = customPathPoints[_cpActiveSubpath];
  const cps = activeSp.map((seg, i) => {
    if (seg.length !== 4 || i === 0) return '';
    const prevEnd = customPathSegEnd(activeSp[i - 1]);
    const cpx = seg[0] * VB, cpy = seg[1] * VB;
    const ex  = seg[2] * VB, ey  = seg[3] * VB;
    return `<line x1="${prevEnd[0] * VB}" y1="${prevEnd[1] * VB}" x2="${cpx}" y2="${cpy}" stroke="#cfd8dc" stroke-width="${swArm}" stroke-dasharray="${daArm},${daArm}"/>`
         + `<line x1="${ex}" y1="${ey}" x2="${cpx}" y2="${cpy}" stroke="#cfd8dc" stroke-width="${swArm}" stroke-dasharray="${daArm},${daArm}"/>`
         + `<rect x="${cpx - sqHalf}" y="${cpy - sqHalf}" width="${sqHalf * 2}" height="${sqHalf * 2}" fill="#fff" stroke="#9e9e9e" stroke-width="${swSq}"/>`;
  }).join('');

  // Set innerHTML before the viewBox attribute: some browsers reset SVG attributes when
  // innerHTML is written, so the viewBox must be applied after.
  svg.innerHTML = background.join('') + shape + cps + verts;

  // Update subpath indicator label (e.g. "2/3" when there are 3 subpaths).
  const ind = document.getElementById('cpSubpathIndicator');
  if (ind) {
    const total = customPathPoints.length;
    ind.textContent = total > 1 ? `${_cpActiveSubpath + 1}/${total}` : '';
  }

  // Apply zoom/pan — fixed view controlled by _cpZoom/_cpViewCx/_cpViewCy.
  _cpViewBox = cpComputeViewBox();
  svg.setAttribute('viewBox', _cpViewBox.join(' '));
}

function customPathSetMode(arcMode) {
  customPathArcMode = arcMode;
  customPathRedraw();
}

function customPathSetClosed(closed) {
  cpHistoryPush();
  customPathClosed = closed;
  customPathRedraw();
  scheduleCalculate();
}

function customPathToggleMode()   { customPathSetMode(!customPathArcMode); }
function customPathToggleClosed() { customPathSetClosed(!customPathClosed); }
function customPathToggleSnap()   { customPathSnapGrid = !customPathSnapGrid; customPathRedraw(); }

function customPathSetGridStep(step) {
  customPathGridStep = step;
  const sel = document.getElementById('cpGridStepSel');
  if (sel) { sel.value = String(step); try { M.FormSelect.init(sel); } catch (_) {} }
  customPathRedraw();
}

function customPathMouseEnter() { _cpMouseOverCanvas = true; }
function customPathMouseLeave() {
  _cpMouseOverCanvas = false;
  _cpSpaceHeld = false;
  if (!customPathDrag) customPathUpdateCursor();
}

function customPathWheel(evt) {
  evt.preventDefault();
  const { xn, yn } = customPathEventPos(evt);
  const svgX    = xn * CUSTOM_PATH_VB;
  const svgY    = yn * CUSTOM_PATH_VB;
  const factor  = evt.deltaY < 0 ? 1.25 : 1 / 1.25;
  const newZoom = Math.max(0.15, Math.min(40, _cpZoom * factor));
  // Keep the point under the cursor fixed in SVG space.
  _cpViewCx = svgX + (_cpViewCx - svgX) * (_cpZoom / newZoom);
  _cpViewCy = svgY + (_cpViewCy - svgY) * (_cpZoom / newZoom);
  _cpZoom   = newZoom;
  customPathRedraw();
}

function customPathToggleMaximize() {
  _cpMaximized = !_cpMaximized;
  const editor = document.getElementById('customPathEditor');
  if (!editor) return;
  if (_cpMaximized) {
    // Move editor to <body> so it escapes the left-panel stacking context and
    // position:fixed z-index:9999 actually covers the entire viewport.
    _cpEditorParent = editor.parentNode;
    _cpEditorNext   = editor.nextSibling;
    document.body.appendChild(editor);
    editor.classList.add('cp-maximized');
  } else {
    editor.classList.remove('cp-maximized');
    if (_cpEditorParent) {
      _cpEditorParent.insertBefore(editor, _cpEditorNext);
      _cpEditorParent = null;
      _cpEditorNext   = null;
    }
  }
  customPathRedraw();
}

function customPathClear() {
  cpHistoryPush();
  if (customPathPoints.length === 1) {
    customPathPoints[0] = [];
  } else {
    // Remove only the active subpath; if it was the last one, step back to the previous.
    customPathPoints.splice(_cpActiveSubpath, 1);
    _cpActiveSubpath = Math.max(0, _cpActiveSubpath - 1);
  }
  customPathRedraw();
  scheduleCalculate();
}

// Rotate all subpaths together around their shared bounding-box centre.
// Default click = +15° (CW); Shift-click passes -15° via customPathRotateClick.
function customPathRotate(degrees) {
  if (customPathPoints.every(sp => sp.length === 0)) return;
  cpHistoryPush();

  // Find the bounding box of all subpaths combined (including bezier handles).
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const sp of customPathPoints) {
    for (const seg of sp) {
      for (let k = 0; k < seg.length; k += 2) {
        if (seg[k]     < minX) minX = seg[k];
        if (seg[k]     > maxX) maxX = seg[k];
        if (seg[k + 1] < minY) minY = seg[k + 1];
        if (seg[k + 1] > maxY) maxY = seg[k + 1];
      }
    }
  }
  const cx  = (minX + maxX) / 2;
  const cy  = (minY + maxY) / 2;
  const rad = degrees * Math.PI / 180;
  const cs  = Math.cos(rad);
  const sn  = Math.sin(rad);

  // Rotate every coord pair around (cx, cy) using the 2-D rotation matrix.
  const rotated = customPathPoints.map(sp =>
    sp.map(seg => {
      const next = seg.slice();
      for (let k = 0; k < seg.length; k += 2) {
        const dx = seg[k] - cx, dy = seg[k + 1] - cy;
        next[k]     = cx + dx * cs - dy * sn;
        next[k + 1] = cy + dx * sn + dy * cs;
      }
      return next;
    })
  );

  // After rotation the bounding box may exceed [0,1] (e.g. a 45° rotation of a large shape).
  // First scale down if necessary (keeping centroid fixed), then translate to fit.
  let nMinX = 1, nMinY = 1, nMaxX = 0, nMaxY = 0;
  for (const sp of rotated) {
    for (const seg of sp) {
      for (let k = 0; k < seg.length; k += 2) {
        if (seg[k]     < nMinX) nMinX = seg[k];
        if (seg[k]     > nMaxX) nMaxX = seg[k];
        if (seg[k + 1] < nMinY) nMinY = seg[k + 1];
        if (seg[k + 1] > nMaxY) nMaxY = seg[k + 1];
      }
    }
  }
  const rw = nMaxX - nMinX, rh = nMaxY - nMinY;
  let scale = 1;
  if (rw > 1) scale = Math.min(scale, 1 / rw);
  if (rh > 1) scale = Math.min(scale, 1 / rh);
  if (scale < 1) {
    // Scale around the original centroid so the shape doesn't shift while shrinking.
    for (const sp of rotated) {
      for (const seg of sp) {
        for (let k = 0; k < seg.length; k += 2) {
          seg[k]     = cx + (seg[k]     - cx) * scale;
          seg[k + 1] = cy + (seg[k + 1] - cy) * scale;
        }
      }
    }
    nMinX = (nMinX - cx) * scale + cx; nMaxX = (nMaxX - cx) * scale + cx;
    nMinY = (nMinY - cy) * scale + cy; nMaxY = (nMaxY - cy) * scale + cy;
  }
  // Translate so the bbox touches but does not cross [0,1].
  let tx = 0, ty = 0;
  if (nMinX < 0) tx = -nMinX; else if (nMaxX > 1) tx = 1 - nMaxX;
  if (nMinY < 0) ty = -nMinY; else if (nMaxY > 1) ty = 1 - nMaxY;
  if (tx !== 0 || ty !== 0) {
    for (const sp of rotated) {
      for (const seg of sp) {
        for (let k = 0; k < seg.length; k += 2) {
          seg[k] += tx; seg[k + 1] += ty;
        }
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

// Add a new empty subpath and make it active.
function customPathAddSubpath() {
  cpHistoryPush();
  customPathPoints.push([]);
  _cpActiveSubpath = customPathPoints.length - 1;
  customPathRedraw();
}

// ── SVG import ────────────────────────────────────────────────

function customPathImportClick() {
  document.getElementById('customPathFileInput').click();
}

function customPathExportSvg() {
  const VB = CUSTOM_PATH_VB;
  const f  = v => (v * VB).toFixed(4);
  let d = '';
  for (const sp of customPathPoints) {
    if (sp.length < 1) continue;
    d += (d ? ' ' : '') + `M ${f(sp[0][0])} ${f(sp[0][1])}`;
    for (let i = 1; i < sp.length; i++) {
      const seg = sp[i];
      if (seg.length === 2) {
        d += ` L ${f(seg[0])} ${f(seg[1])}`;
      } else if (seg.length === 4) {
        d += ` Q ${f(seg[0])} ${f(seg[1])} ${f(seg[2])} ${f(seg[3])}`;
      } else if (seg.length === 6) {
        d += ` C ${f(seg[0])} ${f(seg[1])} ${f(seg[2])} ${f(seg[3])} ${f(seg[4])} ${f(seg[5])}`;
      }
    }
    if (customPathClosed && sp.length >= 3) d += ' Z';
  }
  if (!d) return;

  const pathAttrs = customPathClosed
    ? `fill-rule="evenodd" fill="#bbdefb" stroke="#0277bd" stroke-width="0.5"`
    : `fill="none" stroke="#0277bd" stroke-width="0.5"`;
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${VB}mm" height="${VB}mm">`,
    `  <path d="${d}" ${pathAttrs}/>`,
    `</svg>`,
  ].join('\n');

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'custom-inlay.svg' });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function customPathImportSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) { alert('Could not parse SVG file.'); return; }

  // Try <path> first, fall back to <polyline>/<polygon> converted to a path d string.
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

  // Build the composite transform from all ancestor group transforms + the element's own.
  const m = svgCompositeTransform(el);
  // Parse all subpaths so compound shapes (e.g. letter "A" with its inner hole) import fully.
  const allSubpaths = parseSvgD(el.getAttribute('d') || '');
  if (allSubpaths.length === 0 || allSubpaths.every(sp => sp.length < 2)) {
    alert('Path too short to import.'); return;
  }

  // Apply the composite transform to every coordinate pair in every subpath.
  const tSubpaths = allSubpaths.map(segs =>
    segs.map(seg => {
      const out = [];
      for (let i = 0; i < seg.length; i += 2) {
        const [tx, ty] = svgApplyMatrix(m, seg[i], seg[i + 1]);
        out.push(tx, ty);
      }
      return out;
    })
  );

  // Some SVG editors close paths with an explicit L back to the start instead of Z.
  // Drop that duplicate endpoint so we don't get a zero-length closing segment.
  // Only strip pure line segments (length 2) — never Q/C beziers whose endpoint
  // happens to equal the start, because those carry curve data we must keep.
  const eps = 1e-4;
  for (const segs of tSubpaths) {
    if (segs.length > 2) {
      const start = segs[0], last = segs[segs.length - 1];
      if (last.length === 2 &&
          Math.abs(last[last.length - 2] - start[0]) < eps &&
          Math.abs(last[last.length - 1] - start[1]) < eps) {
        segs.pop();
      }
    }
  }

  const normalized = normalizeSvgPathMulti(tSubpaths);
  if (!normalized) { alert('Could not normalize path.'); return; }

  cpHistoryPush();
  customPathPoints = normalized;
  _cpActiveSubpath = 0;
  customPathClosed = true; // imports default to closed/filled
  customPathRedraw();
  scheduleCalculate();
}

// Walk up the DOM collecting transform attributes, multiply them left-to-right (parent first)
// so the returned matrix maps the element's local coords into the root SVG frame.
function svgCompositeTransform(el) {
  const mats = [];
  let node = el;
  while (node && node.nodeType === 1) {
    const t = node.getAttribute('transform');
    if (t) mats.unshift(svgParseTransform(t)); // unshift = accumulate parent-to-child order
    node = node.parentNode;
  }
  return mats.reduce((acc, m) => svgMulMatrix(acc, m), [1, 0, 0, 1, 0, 0]); // start with identity
}

// Parse a transform="…" attribute string into a 2-D affine matrix [a, b, c, d, e, f].
// SVG matrix layout (column-major):  | a  c  e |     x' = a·x + c·y + e
//                                    | b  d  f |     y' = b·x + d·y + f
//                                    | 0  0  1 |
function svgParseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0]; // identity
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    const fn   = match[1];
    const args = match[2].trim().split(/[\s,]+/).map(Number);
    let tm;
    if (fn === 'matrix')    { tm = args; }
    else if (fn === 'translate') { tm = [1, 0, 0, 1, args[0] || 0, args[1] || 0]; }
    else if (fn === 'scale') {
      const sx = args[0] || 1, sy = args[1] !== undefined ? args[1] : sx;
      tm = [sx, 0, 0, sy, 0, 0];
    }
    else if (fn === 'rotate') {
      // Optional pivot (cx, cy): translate to pivot → rotate → translate back.
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

// Multiply two SVG affine matrices (column-major [a,b,c,d,e,f] — see svgParseTransform).
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

// Apply SVG affine matrix m to point (x, y); returns the transformed [x', y'].
function svgApplyMatrix(m, x, y) {
  return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
}

// Parse an SVG path d attribute into an array of subpaths.
// Each subpath: array of flat-coord segments  [x,y] | [cpx,cpy,x,y] | [c1x,c1y,c2x,c2y,x,y].
// Handles: implicit command repetition, relative coords, H/V shorthand, smooth T/S commands, arcs.
function parseSvgD(d) {
  const tokens = d.trim().match(/[MmZzLlHhVvCcSsQqTtAa]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) || [];
  const allSubpaths = [];
  let segs = [];
  let i = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0; // current point (cx,cy) and subpath start (sx,sy)
  let lastCmd = '', lastCp = null;     // lastCp: most recent control point for T/S reflection
  let started = false;

  function num() { return parseFloat(tokens[i++]); }
  function commitSubpath() {
    if (segs.length >= 2) allSubpaths.push(segs);
    segs = []; started = false;
  }

  while (i < tokens.length) {
    const tok = tokens[i];
    let cmd;
    // SVG implicit repetition: if the next token is a number, not a letter, reuse lastCmd.
    if (/[A-Za-z]/.test(tok)) { cmd = tok; i++; } else { cmd = lastCmd; }
    lastCmd = cmd;

    if (cmd === 'Z' || cmd === 'z') {
      // Close: if the current point isn't already at the subpath start, add a closing L.
      if (started && (cx !== sx || cy !== sy)) segs.push([sx, sy]);
      commitSubpath();
      // SVG spec: after Z the current point resets to the subpath start.
      // Keep started=true so a following relative 'm' is relative to (sx,sy), not (0,0).
      cx = sx; cy = sy; started = true;
      continue;
    }

    const rel = cmd === cmd.toLowerCase(); // lowercase = relative coords

    const addL = (x, y) => { cx = x; cy = y; segs.push([x, y]); lastCp = null; };
    const addQ = (qcx, qcy, x, y) => { cx = x; cy = y; lastCp = [qcx, qcy]; segs.push([qcx, qcy, x, y]); };
    const addC = (c1x, c1y, c2x, c2y, x, y) => { cx = x; cy = y; lastCp = [c2x, c2y]; segs.push([c1x, c1y, c2x, c2y, x, y]); };

    if (cmd === 'M' || cmd === 'm') {
      const wasStarted = started;
      if (started) commitSubpath(); // M always starts a new subpath
      const x = num() + (rel && wasStarted ? cx : 0);
      const y = num() + (rel && wasStarted ? cy : 0);
      cx = x; cy = y; sx = x; sy = y;
      segs.push([x, y]);
      started = true;
      lastCmd = rel ? 'l' : 'L'; // per SVG spec: extra coords after M are implicit L/l
    } else if (cmd === 'L' || cmd === 'l') {
      addL(num() + (rel ? cx : 0), num() + (rel ? cy : 0));
    } else if (cmd === 'H' || cmd === 'h') {
      addL(num() + (rel ? cx : 0), cy); // horizontal line: y unchanged
    } else if (cmd === 'V' || cmd === 'v') {
      addL(cx, num() + (rel ? cy : 0)); // vertical line: x unchanged
    } else if (cmd === 'Q' || cmd === 'q') {
      const qcx = num() + (rel ? cx : 0), qcy = num() + (rel ? cy : 0);
      const x   = num() + (rel ? cx : 0), y   = num() + (rel ? cy : 0);
      addQ(qcx, qcy, x, y);
    } else if (cmd === 'T' || cmd === 't') {
      // Smooth quadratic: control point is the reflection of the previous Q/T control.
      // If the previous command wasn't Q or T, lastCp is null → use current point (no curve).
      const qcx = lastCp ? 2*cx - lastCp[0] : cx;
      const qcy = lastCp ? 2*cy - lastCp[1] : cy;
      addQ(qcx, qcy, num() + (rel ? cx : 0), num() + (rel ? cy : 0));
    } else if (cmd === 'C' || cmd === 'c') {
      const c1x = num() + (rel ? cx : 0), c1y = num() + (rel ? cy : 0);
      const c2x = num() + (rel ? cx : 0), c2y = num() + (rel ? cy : 0);
      const x   = num() + (rel ? cx : 0), y   = num() + (rel ? cy : 0);
      addC(c1x, c1y, c2x, c2y, x, y);
    } else if (cmd === 'S' || cmd === 's') {
      // Smooth cubic: c1 is the reflection of the previous C/S second control point.
      const c1x = lastCp ? 2*cx - lastCp[0] : cx;
      const c1y = lastCp ? 2*cy - lastCp[1] : cy;
      const c2x = num() + (rel ? cx : 0), c2y = num() + (rel ? cy : 0);
      const x   = num() + (rel ? cx : 0), y   = num() + (rel ? cy : 0);
      addC(c1x, c1y, c2x, c2y, x, y);
    } else if (cmd === 'A' || cmd === 'a') {
      const rx = Math.abs(num()), ry = Math.abs(num());
      const xRot = num(), large = num() !== 0, sweep = num() !== 0;
      const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
      // Convert elliptical arc to cubic Beziers (SVG spec Appendix B), add each segment.
      const arcs = svgArcToCubics(cx, cy, rx, ry, xRot, large, sweep, x, y);
      arcs.forEach(([c1x, c1y, c2x, c2y, ex, ey]) => addC(c1x, c1y, c2x, c2y, ex, ey));
    } else {
      i++; // unknown token: skip
    }
  }
  commitSubpath();
  return allSubpaths;
}

// Convert an SVG elliptical arc to one or more cubic Bezier segments.
// Implements the endpoint-to-centre parameterisation from SVG spec Appendix B.F.6.
// Each returned array is [c1x, c1y, c2x, c2y, endX, endY].
function svgArcToCubics(x1, y1, rx, ry, xRotDeg, largeArc, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];              // degenerate: start equals end
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]]; // degenerate: straight line

  const phi  = xRotDeg * Math.PI / 180;
  const cosp = Math.cos(phi), sinp = Math.sin(phi);

  // Step 1 – rotate the endpoints into the ellipse's own axis-aligned frame (prime coords).
  const mx  = (x1 - x2) / 2, my = (y1 - y2) / 2;
  const x1p =  cosp * mx + sinp * my;
  const y1p = -sinp * mx + cosp * my;

  // Step 2 – ensure radii are large enough to span the distance; scale up uniformly if not.
  let rx2 = rx * rx, ry2 = ry * ry;
  const x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  const lam  = x1p2 / rx2 + y1p2 / ry2;
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; rx2 = rx*rx; ry2 = ry*ry; }

  // Step 3 – find the ellipse centre in prime coords.
  // The ± sign is resolved by largeArc XOR sweep: those flags together select one of two solutions.
  const num1 = rx2*ry2 - rx2*y1p2 - ry2*x1p2;
  const den  = rx2*y1p2 + ry2*x1p2;
  const sq   = Math.sqrt(Math.max(0, num1 / den));
  const k    = (largeArc === sweep ? -1 : 1) * sq;
  const cxp  =  k * rx * y1p / ry;
  const cyp  = -k * ry * x1p / rx;

  // Step 4 – rotate the centre back to the original coordinate frame.
  const cx = cosp*cxp - sinp*cyp + (x1+x2)/2;
  const cy = sinp*cxp + cosp*cyp + (y1+y2)/2;

  // Step 5 – compute start angle (ang1) and total sweep angle (da).
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  const dot = ux*vx + uy*vy;
  let da = Math.acos(Math.max(-1, Math.min(1, dot / Math.sqrt((ux*ux+uy*uy)*(vx*vx+vy*vy)))));
  if (ux*vy - uy*vx < 0) da = -da;
  if (sweep && da < 0) da += 2*Math.PI;  // adjust direction to match arc flags
  if (!sweep && da > 0) da -= 2*Math.PI;

  const ang1 = Math.atan2(uy, ux);

  // Step 6 – split into ≤90° arcs and approximate each with a cubic Bezier.
  // The α formula (from the SVG spec) gives the control-point offset that makes the cubic
  // match a circular arc exactly at both endpoints and tangentially — error < 0.03% of r.
  const nSegs = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 2)));
  const dt    = da / nSegs;
  const cubics = [];
  for (let s = 0; s < nSegs; s++) {
    const a1 = ang1 + s * dt, a2 = ang1 + (s + 1) * dt;
    const alpha = Math.sin(dt) * (Math.sqrt(4 + 3*Math.tan(dt/2)*Math.tan(dt/2)) - 1) / 3;
    const ex1 = Math.cos(a1), ey1 = Math.sin(a1);
    const ex2 = Math.cos(a2), ey2 = Math.sin(a2);
    // Map unit-circle tangent directions to the rotated, scaled ellipse.
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

// Scale/translate all subpaths together to fit inside [0,1]² using a single shared bbox.
// Using a shared bbox (not one per subpath) preserves relative positions between subpaths,
// which is essential for compound shapes like a letter "A" with its inner hole.
function normalizeSvgPathMulti(subpaths) {
  const valid = subpaths.filter(sp => sp.length >= 1);
  if (!valid.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sp of valid) {
    for (const seg of sp) {
      // Include bezier control handles (not just endpoints) so the hull fits the canvas too.
      for (let i = 0; i < seg.length; i += 2) {
        const x = seg[i], y = seg[i + 1];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const w = maxX - minX, h = maxY - minY;
  if (w < 1e-9 && h < 1e-9) return null; // all points coincide — nothing to show
  // Uniform scale so the longer axis fills [0,1]; the shorter axis is centred in [0,1].
  const scale = 1.0 / Math.max(w, h);
  const offX  = (1.0 - w * scale) / 2 - minX * scale;
  const offY  = (1.0 - h * scale) / 2 - minY * scale;
  return valid.map(sp =>
    sp.map(seg => {
      const out = [];
      for (let i = 0; i < seg.length; i += 2) {
        out.push(seg[i] * scale + offX, seg[i + 1] * scale + offY);
      }
      return out;
    })
  );
}

// ── Custom path encoding ──────────────────────────────────────────────────────
// Coords and flags are bit-packed into a BigInt, then serialised as base-36 (digits + a-z).
// Base-36 is chosen because it is URL-safe, needs no padding, and is more compact than hex.
//
// Bit layout (MSB first):
//   1 bit  : closed flag  (1 = filled pocket, 0 = open stroke)
//   5 bits : N            = number of additional segments after the start (max 31)
//   8 bits : start x      = round(val × 255)  →  range 0–255
//   8 bits : start y
//   per segment (N times):
//     2 bits type  : 00 = L (line), 01 = Q (quadratic), 10 = C (cubic)
//     coords       : L → 2×8; Q → 4×8; C → 6×8 bits
function encodeCustomPath(closed, points) {
  if (!points || points.length < 1) return '';
  const enc8 = v => Math.max(0, Math.min(255, Math.round(v * 255)));
  const segs  = points.slice(1);       // segments after the start point
  const N     = Math.min(segs.length, 31);
  let bits = 0n;
  // push() shifts the accumulator left by nbits and ORs in val — builds the stream MSB-first.
  const push = (val, nbits) => { bits = (bits << BigInt(nbits)) | BigInt(val); };
  push(closed ? 1 : 0, 1);
  push(N, 5);
  push(enc8(points[0][0]), 8);
  push(enc8(points[0][1]), 8);
  for (let i = 0; i < N; i++) {
    const seg = segs[i];
    if (seg.length >= 6) {
      push(2, 2); for (let j = 0; j < 6; j++) push(enc8(seg[j]), 8); // cubic
    } else if (seg.length >= 4) {
      push(1, 2); for (let j = 0; j < 4; j++) push(enc8(seg[j]), 8); // quadratic
    } else {
      push(0, 2); push(enc8(seg[0]), 8); push(enc8(seg[1]), 8);       // line
    }
  }
  return bits.toString(36);
}

function decodeCustomPath(suffix) {
  if (!suffix) return { closed: true, points: [] };
  // Re-parse the base-36 string into a BigInt.
  let bits = 0n;
  for (const c of suffix.toLowerCase()) bits = bits * 36n + BigInt(parseInt(c, 36));
  // Expand the BigInt into an MSB-first bit array for sequential reads.
  // This exactly mirrors the push() order in encodeCustomPath.
  const allBits = [];
  let tmp = bits;
  while (tmp > 0n) { allBits.unshift(Number(tmp & 1n)); tmp >>= 1n; }
  // Pad to at least the header size (1+5+8+8 = 22 bits); BigInt drops leading zero bits.
  while (allBits.length < 22) allBits.unshift(0);
  let pos = 0;
  const read  = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | (allBits[pos++] ?? 0); return v; };
  const dec8  = v => v / 255; // inverse of enc8: maps [0,255] back to [0,1]
  try {
    const closed = read(1) === 1;
    const N      = read(5);
    const sx     = dec8(read(8));
    const sy     = dec8(read(8));
    const points = [[sx, sy]];
    for (let i = 0; i < N; i++) {
      const type = read(2);
      if (type === 2) {
        points.push([read(8),read(8),read(8),read(8),read(8),read(8)].map(dec8)); // cubic
      } else if (type === 1) {
        points.push([read(8),read(8),read(8),read(8)].map(dec8));                 // quadratic
      } else {
        points.push([dec8(read(8)), dec8(read(8))]);                              // line
      }
    }
    return { closed, points };
  } catch (_) {
    return { closed: true, points: [] };
  }
}
