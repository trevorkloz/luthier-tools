'use strict';

const API_URL     = '/api/fretboard/generate';
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
// inlaySize, inlayHeight, inlayDoubleOffsetV, inlayDoubleOffsetH are mm-fixed range sliders — not in DIM_FIELDS.

let instrumentPresets = [];

let lastResponse = null;
let debounceTimer = null;
let prevUnit = 'mm';
let previewDarkMode = false;

// ── SVG preview zoom / pan ────────────────────────────────────
let svgZoom = 1.0;
let svgPanX = 0;
let svgPanY = 0;
let svgPhysicalW = 0; // physical width of current SVG in mm
let _svgDragging = false;
let _svgDragOriginX = 0;
let _svgDragOriginY = 0;
let _svgDragPanX = 0;
let _svgDragPanY = 0;

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
      inlayDoubleOffsetV: req.inlayDoubleOffsetV,
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
  await Promise.all([loadInlayPresets(), loadInstrumentPresets(), loadStringPresets(), loadRadiusPresets()]);
  M.Sidenav.init(document.querySelectorAll('.sidenav'));
  M.Collapsible.init(document.getElementById('inputSections'), {
    accordion: true,
    onOpenEnd: saveState,
    onCloseEnd: saveState,
  });
  M.FormSelect.init(document.querySelectorAll('select'));

  restoreState();
  M.updateTextFields();
  updateUnitHints();
  updateShapeFields();

  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('input', scheduleCalculate);
  });

  bindDimSlider('inlaySize',           'inlaySizeVal');
  bindDimSlider('inlayHeight',         'inlayHeightVal');
  bindDimSlider('inlayDoubleOffsetV',  'inlayDoubleOffsetVVal');
  bindDimSlider('inlayDoubleOffsetH',  'inlayDoubleOffsetHVal');
  bindDimSlider('inlayEdgeMargin',     'inlayEdgeMarginVal');
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
  document.getElementById('stringPreset').addEventListener('change', scheduleCalculate);

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
  document.getElementById('inlayPosition').addEventListener('change', () => { updateInlayEdgeMarginVisibility(); scheduleCalculate(); });
  document.getElementById('inlayDoubleOrientation').addEventListener('change', scheduleCalculate);
  document.getElementById('doubleInlays').addEventListener('change', updateDoubleMarkerControls);
  updateInlayEdgeMarginVisibility();

  document.getElementById('multiscale').addEventListener('change', function () {
    document.getElementById('multiscaleEditor').style.display = this.checked ? '' : 'none';
    scheduleCalculate();
  });
  updateDoubleMarkerControls();

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

  // SVG preview zoom / pan
  const svgCont = document.getElementById('svgContainer');
  svgCont.addEventListener('wheel',     _onSvgWheel,     { passive: false });
  svgCont.addEventListener('mousedown', _onSvgMouseDown);
  document.addEventListener('mousemove', _onSvgMouseMove);
  document.addEventListener('mouseup',   _onSvgMouseUp);

  saveState();
  calculate();
});

// ── String presets ────────────────────────────────────────────
async function loadStringPresets() {
  let presets = [];
  try {
    const res = await fetch('/api/fretboard/presets/strings');
    if (!res.ok) throw new Error();
    presets = await res.json();
  } catch (_) {
    presets = [{ id: 'NONE', label: 'No strings' }];
  }
  const sel = document.getElementById('stringPreset');
  presets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  });
  M.FormSelect.init(sel);
}

// ── Radius presets ────────────────────────────────────────────
async function loadRadiusPresets() {
  let presets = [];
  try {
    const res = await fetch('/api/fretboard/presets/radius');
    if (!res.ok) throw new Error();
    presets = await res.json();
  } catch (_) {
    presets = [];
  }
  const sel = document.getElementById('radiusPreset');
  const custom = document.createElement('option');
  custom.value = ''; custom.textContent = '— Custom —';
  sel.appendChild(custom);
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = String(p.mm);
    opt.textContent = p.label;
    sel.appendChild(opt);
  });
  M.FormSelect.init(sel);
}

// ── Instrument presets ────────────────────────────────────────
async function loadInstrumentPresets() {
  try {
    const res = await fetch('/api/fretboard/presets/instruments');
    if (!res.ok) throw new Error();
    instrumentPresets = await res.json();
  } catch (_) {
    instrumentPresets = [];
  }
  const sel = document.getElementById('preset');
  instrumentPresets.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  M.FormSelect.init(sel);
}

async function loadInlayPresets() {
  try {
    const res = await fetch('/api/fretboard/presets/inlays');
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
  if (isNaN(idx) || idx >= instrumentPresets.length) return;
  const p = instrumentPresets[idx];
  const unit = document.getElementById('unit').value;
  const fromMm = v => unit === 'inch' ? (v / MM_PER_IN).toFixed(4) : v;
  document.getElementById('scaleLength').value   = fromMm(p.scaleLength);
  document.getElementById('numberOfFrets').value = p.numberOfFrets;
  document.getElementById('nutWidth').value       = fromMm(p.nutWidth);
  document.getElementById('width12thFret').value  = fromMm(p.width12thFret);
  if (p.radiusValue !== undefined) {
    document.getElementById('radiusValue').value = fromMm(p.radiusValue);
    const rpEl = document.getElementById('radiusPreset');
    rpEl.value = String(p.radiusValue);
    M.FormSelect.init(rpEl);
  }
  if (p.stringPreset) {
    document.getElementById('stringPreset').value = p.stringPreset;
    M.FormSelect.init(document.getElementById('stringPreset'));
  }
  const bsEl = document.getElementById('bridgeStyle');
  if (bsEl) bsEl.value = p.bridgeStyle || 'NONE';
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

// ── Custom inlay editor — see custom-path-editor.js ─────────────────────────
// State (customPathPoints, customPathClosed, _cpActiveSubpath) and all functions
// are declared in custom-path-editor.js, loaded before this file.


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

function updateInlayEdgeMarginVisibility() {
  const pos = document.getElementById('inlayPosition').value;
  const row = document.getElementById('inlayEdgeMarginRow');
  if (row) row.style.display = (pos === 'top' || pos === 'bottom') ? 'flex' : 'none';
}

function updateDoubleMarkerControls() {
  const on = document.getElementById('doubleInlays')?.checked ?? false;
  const opacity = on ? '1' : '0.4';
  const pointer = on ? '' : 'none';
  ['inlayDoubleOrientationRow', 'inlayDoubleOffsetVRow', 'inlayDoubleOffsetHRow'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = opacity;
    el.style.pointerEvents = pointer;
  });
  const sel = document.getElementById('inlayDoubleOrientation');
  if (sel) sel.disabled = !on;
  ['inlayDoubleOffsetV', 'inlayDoubleOffsetH'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !on;
  });
}

function refreshDimSliderDisplays() {
  const unit = document.getElementById('unit').value;
  [['inlaySize', 'inlaySizeVal'], ['inlayHeight', 'inlayHeightVal'], ['inlayDoubleOffsetV', 'inlayDoubleOffsetVVal'], ['inlayDoubleOffsetH', 'inlayDoubleOffsetHVal'], ['inlayEdgeMargin', 'inlayEdgeMarginVal']].forEach(([id, valId]) => {
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
  if (typeof customPathSetEdgeTaper === 'function') customPathSetEdgeTaper(computeEdgeTaper());
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
    document.querySelectorAll('.dl-btn').forEach(el => el.classList.remove('disabled'));
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
    label:                isNaN(presetIdx) ? '' : (instrumentPresets[presetIdx]?.name ?? ''),
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
    inlayEdgeMargin:         parseFloat(document.getElementById('inlayEdgeMargin').value),
    inlayDoubleOffsetV:      parseFloat(document.getElementById('inlayDoubleOffsetV').value),
    inlayDoubleOffsetH:      parseFloat(document.getElementById('inlayDoubleOffsetH').value),
    inlayDoubleOrientation:  document.getElementById('inlayDoubleOrientation').value,
    inlayShrinkWidth1224:    parseFloat(document.getElementById('inlayShrinkWidth1224').value),
    inlayShrinkHeight1224:   parseFloat(document.getElementById('inlayShrinkHeight1224').value),
    inlayShrinkWidth:        parseFloat(document.getElementById('inlayShrinkWidth').value),
    inlayGrowHeight:      parseFloat(document.getElementById('inlayGrowHeight').value),
    inlayTrapezoid:       parseFloat(document.getElementById('inlayTrapezoid').value) / 50,
    inlayParallelogram:   parseFloat(document.getElementById('inlayParallelogram').value) / 50,
    inlayCustomPath:      currentInlayPresetId === 'custom' ? customPathPoints : [],
    inlayCustomClosed:    customPathClosed,
    multiscale:           document.getElementById('multiscale').checked,
    bassScaleLength:      toMm(parseFloat(document.getElementById('bassScaleLength').value)),
    trebleScaleLength:    toMm(parseFloat(document.getElementById('trebleScaleLength').value)),
    perpendicularFret:    parseInt(document.getElementById('perpendicularFret').value, 10),
    stringPreset:         document.getElementById('stringPreset').value,
    bridgeStyle:          document.getElementById('bridgeStyle')?.value || 'NONE',
  };
}

function isValid(req) {
  return !isNaN(req.scaleLength) && req.scaleLength >= 100 && req.scaleLength <= 2000 &&
         !isNaN(req.numberOfFrets) && req.numberOfFrets >= 0 && req.numberOfFrets <= 36 &&
         !isNaN(req.nutWidth) && req.nutWidth >= 10 &&
         !isNaN(req.width12thFret) && req.width12thFret >= 10;
}

// ── SVG preview zoom / pan helpers ───────────────────────────
function _svgApplyTransform() {
  const svg = document.querySelector('#svgContainer svg');
  if (!svg) return;
  svg.style.transform = `translate(${svgPanX}px,${svgPanY}px) scale(${svgZoom})`;
  updateSvgRuler();
}

function resetSvgZoom() {
  svgZoom = 1; svgPanX = 0; svgPanY = 0;
  _svgApplyTransform();
}

// Zoom centered on the middle of the container (used by +/- buttons).
function zoomSvgBy(factor) {
  const c = document.getElementById('svgContainer');
  if (!c) return;
  const cx = c.clientWidth  / 2;
  const cy = c.clientHeight / 2;
  const nz = Math.min(40, Math.max(0.1, svgZoom * factor));
  svgPanX = cx - (cx - svgPanX) * (nz / svgZoom);
  svgPanY = cy - (cy - svgPanY) * (nz / svgZoom);
  svgZoom = nz;
  _svgApplyTransform();
}

function _onSvgWheel(e) {
  e.preventDefault();
  const rect = e.currentTarget.getBoundingClientRect();
  const cx   = e.clientX - rect.left;
  const cy   = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const nz = Math.min(40, Math.max(0.1, svgZoom * factor));
  svgPanX = cx - (cx - svgPanX) * (nz / svgZoom);
  svgPanY = cy - (cy - svgPanY) * (nz / svgZoom);
  svgZoom = nz;
  _svgApplyTransform();
}

function _onSvgMouseDown(e) {
  if (e.button !== 0) return;
  _svgDragging = true;
  _svgDragOriginX = e.clientX; _svgDragOriginY = e.clientY;
  _svgDragPanX = svgPanX;      _svgDragPanY = svgPanY;
  e.currentTarget.classList.add('panning');
}

function _onSvgMouseMove(e) {
  if (!_svgDragging) return;
  svgPanX = _svgDragPanX + (e.clientX - _svgDragOriginX);
  svgPanY = _svgDragPanY + (e.clientY - _svgDragOriginY);
  _svgApplyTransform();
}

function _onSvgMouseUp(e) {
  if (!_svgDragging) return;
  _svgDragging = false;
  document.getElementById('svgContainer')?.classList.remove('panning');
}

// ── SVG ruler ─────────────────────────────────────────────────
function updateSvgRuler() {
  const ruler = document.getElementById('svgRuler');
  const cont  = document.getElementById('svgContainer');
  if (!ruler || !cont || !svgPhysicalW || cont.style.display === 'none') {
    if (ruler) ruler.style.display = 'none';
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const cw  = cont.clientWidth;
  const lh  = 22; // logical height in css px
  ruler.width  = Math.round(cw * dpr);
  ruler.height = Math.round(lh * dpr);
  ruler.style.width  = cw + 'px';
  ruler.style.height = lh + 'px';
  ruler.style.display = 'block';

  const ctx = ruler.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cw, lh);

  // Background
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, cw, lh);
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(0, 0, cw, 1); // top border

  // px per mm in container space: SVG renders at 100% of container width, then CSS scale(svgZoom) applied
  const pxPerMm = cw * svgZoom / svgPhysicalW;
  const calibration = 0.9885; // tweak this
  const pxPerMmCorrected = pxPerMm * calibration;

  // mm value at left and right edge of the ruler (accounting for pan)
  const mmLeft  = -svgPanX / pxPerMm;
  const mmRight = (cw - svgPanX) / pxPerMm;
  const mmSpan  = mmRight - mmLeft;

  // Pick the largest nice major interval giving at least 8 major ticks
  const niceIntervals = [1, 10, 50, 100];
  let interval = niceIntervals[niceIntervals.length - 1];
  for (let j = niceIntervals.length - 1; j >= 0; j--) {
    if (mmSpan / niceIntervals[j] >= 8) { interval = niceIntervals[j]; break; }
  }

  // Number of minor subdivisions per major interval (5 gives 4 minor ticks between majors)
  const minorDiv = 10;
  const minorStep = Math.max(interval / minorDiv, 1);

  const firstTick = Math.floor(mmLeft / minorStep) * minorStep;

  ctx.strokeStyle = '#90a4ae';
  ctx.fillStyle   = '#546e7a';
  ctx.lineWidth   = 1;
  ctx.font        = '9px system-ui,sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign   = 'center';

  for (let mm = firstTick; mm <= mmRight + minorStep; mm = parseFloat((mm + minorStep).toPrecision(10))) {
    const rulerOffsetMm = 10.45;
    const x = Math.round(svgPanX + (mm+rulerOffsetMm) * pxPerMmCorrected) + 0.5;
    if (x < -2 || x > cw + 2) continue;

    const isMajor = Math.abs(Math.round(mm / interval) * interval - mm) < minorStep * 0.01;
    const isMedium =
        Math.abs(Math.round(mm / 5) * 5 - mm) < minorStep * 0.01;

    const tickH =
        isMajor ? 13 :
            isMedium ? 10 :
                7;

    const isNegative = mm < 0;

    ctx.strokeStyle = isNegative ? '#cfcfcf' : '#90a4ae';
    ctx.fillStyle   = isNegative ? '#cfcfcf' : '#546e7a';

    const is100mm = Math.abs(mm % 100) < minorStep * 0.01;
    ctx.font = is100mm ? 'bold 9px system-ui,sans-serif' : '9px system-ui,sans-serif';

    ctx.beginPath();
    ctx.moveTo(x, 1);
    ctx.lineTo(x, tickH);
    ctx.stroke();

    // Label on major ticks only
    if (isMajor && mm >= 0 && x > 10 && x < cw - 10) {
      const label = Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
      ctx.fillText(label, x, lh);
    }
  }
}

// ── Rendering ─────────────────────────────────────────────────
function applyDarkThemeToSvg(svgStr) {
  const vbMatch = svgStr.match(/viewBox="([\s\d.\-]+)"/);
  let bgRect = '';
  if (vbMatch) {
    const [vx, vy, vw, vh] = vbMatch[1].trim().split(/\s+/).map(parseFloat);
    bgRect = `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#222222"/>`;
  }
  // Per-path transform by shaper:cutType, then single-pass remap of guide colors.
  // Colors chosen for cut paths must not appear in the guide color map sources.
  let result = svgStr
    .replace(/<svg([^>]*)>/, `<svg$1>${bgRect}`)
    .replace(/<path([\s\S]*?)\/>/g, (match, attrs) => {
      const cutType = (attrs.match(/shaper:cutType="([^"]*)"/) ?? [])[1];
      switch (cutType) {
        case 'outside':
          return '<path' + attrs
            .replace(/\bfill="[^"]*"/, 'fill="#111111"')
            .replace(/\bstroke="[^"]*"/, 'stroke="#3a3a3a"') + '/>';
        case 'inside':
        case 'pocket':
          return '<path' + attrs
            .replace(/\bfill="[^"]*"/, 'fill="#f0f0f0"')
            .replace(/\bstroke="[^"]*"/, 'stroke="none"') + '/>';
        case 'online':
          return '<path' + attrs
            .replace(/\bstroke="[^"]*"/, 'stroke="#b0b0b0"') + '/>';
        default:
          return match;
      }
    });
  const guideColorMap = new Map([
    ['#333333', '#cccccc'],  // title text
    ['#aaaaaa', '#666666'],  // center line
    ['#555555', '#999999'],  // dim annotations / arrowheads
    ['#888888', '#bbbbbb'],  // fret number labels
    ['#9e9e9e', '#777777'],  // config code text
    ['#0288d1', '#4fc3f7'],  // bounding box
    ['#1565c0', '#64b5f6'],  // pinhole guide marks
    ['#5cb877', '#a5d6a7'],  // radius line
    ['#44739c', '#888888'],  // any remaining cut color (fallback)
  ]);
  return result.replace(/#[0-9a-f]{6}/gi, m => guideColorMap.get(m.toLowerCase()) ?? m);
}

// Returns the normalized y-slope of the fretboard boundary edge across the inlay width.
// Used to shear the custom path editor so the bounding box reflects the physical taper.
// positive = bottom-positioned (edge goes down toward heel); negative = top-positioned (edge goes up).
// CENTER returns 0 (no taper — the center line is flat).
function computeEdgeTaper() {
  const unit     = document.getElementById('unit')?.value ?? 'mm';
  const toMm     = v => unit === 'inch' ? v * MM_PER_IN : v;
  const scale    = toMm(parseFloat(document.getElementById('scaleLength')?.value));
  const nutW     = toMm(parseFloat(document.getElementById('nutWidth')?.value));
  const w12      = toMm(parseFloat(document.getElementById('width12thFret')?.value));
  const iSize    = parseFloat(document.getElementById('inlaySize')?.value);
  const iH       = parseFloat(document.getElementById('inlayHeight')?.value);
  const position = document.getElementById('inlayPosition')?.value ?? 'center';
  if (position === 'center') return 0;
  if ([scale, nutW, w12, iSize, iH].some(isNaN) || scale <= 0 || iH <= 0) return 0;
  const wideEnd   = 2 * w12 - nutW;
  const taperRate = (wideEnd - nutW) / scale;
  const refMid    = scale / 2;                         // fret 12 as reference
  const wLeft     = nutW + taperRate * (refMid - iSize / 2);
  const wRight    = nutW + taperRate * (refMid + iSize / 2);
  const halfDelta = (wRight - wLeft) / 2;              // how much one edge moves across inlay width
  return (position === 'top' ? -halfDelta : +halfDelta) / iH;
}

function setPreviewDarkMode(dark) {
  previewDarkMode = dark;
  document.getElementById('previewLightBtn')?.classList.toggle('preview-mode-active', !dark);
  document.getElementById('previewDarkBtn')?.classList.toggle('preview-mode-active', dark);
  if (lastResponse) renderPreview(lastResponse);
}

function renderPreview(data) {
  const container = document.getElementById('svgContainer');
  let svgStr = data.svgContent;
  const wMatch = svgStr.match(/\bwidth="([\d.]+)mm"/);
  svgPhysicalW = wMatch ? parseFloat(wMatch[1]) : 0;
  svgStr = svgStr.replace(/ width="[^"]*mm"/, '').replace(/ height="[^"]*mm"/, '');
  if (previewDarkMode) svgStr = applyDarkThemeToSvg(svgStr);
  container.innerHTML = svgStr;
  container.style.background = previewDarkMode ? '#222222' : '';
  container.style.display = '';
  document.getElementById('emptyState').style.display = 'none';
  _svgApplyTransform();
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
  const title = isNaN(presetIdx) ? 'Custom Fretboard' : (instrumentPresets[presetIdx]?.name ?? 'Custom Fretboard');
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
    fetch('/api/fretboard/generate/inlays-only', {
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

  // mode === 'frets': backend regenerates SVG without inlays
  const req = buildRequest();
  fetch('/api/fretboard/generate/frets-only', {
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
    a.download = `fretboard-${scaleDisp}${unitLabel}-frets.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }).catch(() => {
    M.toast({ html: 'Failed to generate frets SVG.', displayLength: 3000 });
  });
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
//   inlayDoubleOffsetV(7) inlayShrinkWidth1224(5) inlayShrinkHeight1224(5) inlayShrinkWidth(5) inlayGrowHeight(8)
//   inlayTrapezoid(7) inlayParallelogram(7) showRadius(1) radiusValue(12) radiusSteps(4)
//   showNutSlot(1) nutSlotWidth(5) nutSlotDistance(6)
//   showPinholes(1) tangWidth(5) fretExtensionAmount(6) inlayDoubleOffsetH(7)  = 154 bits
const CONFIG_SCHEMA = [12,6,8,8,1,1,1,1,1,1,2,1,3,7,7,2,7,5,5,5,8,7,7,1,12,4,1,5,6,1,5,6,7];
// Legacy-v2: before inlayDoubleOffsetH was added (147 bits → 29 data chars)
const CONFIG_SCHEMA_LEGACY_V2 = [12,6,8,8,1,1,1,1,1,1,2,1,3,7,7,2,7,5,5,5,8,7,7,1,12,4,1,5,6,1,5,6];
// Legacy-v1: before bidirectional sliders (143 bits → 28 data chars)
const CONFIG_SCHEMA_LEGACY_V1 = [12,6,8,8,1,1,1,1,1,1,2,1,3,7,7,2,7,4,4,4,7,7,7,1,12,4,1,5,6,1,5,6];
const CONFIG_DATA_CHARS          = 30;
const CONFIG_DATA_CHARS_LEGACY_V2 = 29;
const CONFIG_DATA_CHARS_LEGACY_V1 = 28;
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
    s.inlayDoubleOrientation === 'horizontal' ? 1 : 0,                          //  2 bits  (staggered removed)
    s.showBoundingBox      ? 1 : 0,                              //  1 bit
    Math.max(0, inlayPresets.findIndex(p => p.id === s.inlayShape)), //  3 bits
    Math.round(parseFloat(s.inlaySize)         * 2),             //  7 bits  0-100 (0-50mm)
    Math.round(parseFloat(s.inlayHeight)       * 2),             //  7 bits  0-100 (0-50mm)
    s.inlayPosition === 'center' ? 0 : s.inlayPosition === 'top' ? 1 : 2, // 2 bits
    Math.round(parseFloat(s.inlayDoubleOffsetV)     * 2),          //  7 bits  0-100 (0-50mm)
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
    Math.round(parseFloat(s.inlayDoubleOffsetH)  * 2),           //  7 bits  0-100 (0-50mm)
  ];
  let bits = 0n;
  for (let i = 0; i < fields.length; i++) {
    bits = (bits << BigInt(CONFIG_SCHEMA[i])) | BigInt(Math.max(0, fields[i]));
  }
  const dataStr = bits.toString(36).padStart(CONFIG_DATA_CHARS, '0');
  let code = (dataStr + configHashChars(dataStr)).toUpperCase();
  if (s.inlayShape === 'custom' && Array.isArray(s.inlayCustomPath) &&
      s.inlayCustomPath.some(sp => sp.length >= 1)) {
    // URL encoding supports only the first (outer) subpath; multi-subpath state is
    // preserved in localStorage via the full JSON snapshot.
    const firstSp    = s.inlayCustomPath[0] || [];
    const pathSuffix = encodeCustomPath(s.inlayCustomClosed !== false, firstSp);
    if (pathSuffix) code += '.' + pathSuffix.toUpperCase();
  }
  return code;
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

  // Accept the current 34-char format and two legacy formats:
  //   32 chars (legacy-v1, before bidirectional sliders)
  //   33 chars (legacy-v2, before inlayDoubleOffsetH was added)
  const legacyV1 = mainCode.length === CONFIG_DATA_CHARS_LEGACY_V1 + CONFIG_HASH_CHARS;
  const legacyV2 = mainCode.length === CONFIG_DATA_CHARS_LEGACY_V2 + CONFIG_HASH_CHARS;
  const expectedLen = legacyV1 ? CONFIG_DATA_CHARS_LEGACY_V1 + CONFIG_HASH_CHARS
                    : legacyV2 ? CONFIG_DATA_CHARS_LEGACY_V2 + CONFIG_HASH_CHARS
                    : CONFIG_CHARS;
  const dataChars   = legacyV1 ? CONFIG_DATA_CHARS_LEGACY_V1
                    : legacyV2 ? CONFIG_DATA_CHARS_LEGACY_V2
                    : CONFIG_DATA_CHARS;
  const schema      = legacyV1 ? CONFIG_SCHEMA_LEGACY_V1
                    : legacyV2 ? CONFIG_SCHEMA_LEGACY_V2
                    : CONFIG_SCHEMA;
  const legacy      = legacyV1; // signed-field flag: only V1 used unsigned encoding

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
  const [sl,nf,nw,w12,unit,sfn,scl,swa,si,di,dO,sbb,shape,isz,ih,ip,idoV,sw1224,sh1224,sw,gh,trap,para,
         showR,rv,rs,sNS,nsw,nsd,sPH,tw,fea,idoH] = vals;

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
    inlayDoubleOrientation:  dO === 1 ? 'horizontal' : 'vertical', // staggered (dO=2) in old codes maps to vertical
    showBoundingBox:         sbb === 1,
    inlayShape:           inlayPresets[shape]?.id ?? 'circle',
    inlaySize:            isz / 2,
    inlayHeight:          ih  / 2,
    inlayPosition:        ip === 0 ? 'center' : ip === 1 ? 'top' : 'bottom',
    inlayDoubleOffsetV:  idoV  / 2,
    inlayDoubleOffsetH:  (legacyV1 || legacyV2) ? 0 : (idoH ?? 0) / 2,
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
    inlayCustomPath:      pathResult.points.length > 0 ? [pathResult.points] : [[]],
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

// ── Actions menu (burger) ─────────────────────────────────────
function toggleActionsPanel() {
  const panel = document.getElementById('actionsPanel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  const ic = document.getElementById('actionsMenuBtn')?.querySelector('i.material-icons');
  if (ic) ic.textContent = opening ? 'close' : 'menu';
}

document.addEventListener('click', e => {
  const panel = document.getElementById('actionsPanel');
  if (!panel || panel.style.display === 'none') return;
  if (!e.target.closest('#actionsPanel') && !e.target.closest('#actionsMenuBtn')) {
    panel.style.display = 'none';
    const ic = document.getElementById('actionsMenuBtn')?.querySelector('i.material-icons');
    if (ic) ic.textContent = 'menu';
  }
}, true);

// ── Preset file save / load ───────────────────────────────────
function exportPreset() {
  const name = prompt('Preset name:', 'My Preset');
  if (name === null) return;
  const presetName = name.trim() || 'My Preset';
  const data = Object.assign({ _presetName: presetName, _version: 1 }, stateSnapshot());
  const json = JSON.stringify(data, null, 2);
  const safe = presetName.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/-+/g, '-').slice(0, 60);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: safe + '.fretpreset.json' });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importPresetFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (typeof data !== 'object' || data === null || !('scaleLength' in data)) {
        M.toast({ html: 'Not a valid preset file.', displayLength: 3000 });
        return;
      }
      applyStateData(data);
      M.updateTextFields();
      updateUnitHints();
      updateShapeFields();
      calculate();
      const name = data._presetName ? ` "${data._presetName}"` : '';
      M.toast({ html: `Preset${name} loaded!`, displayLength: 2000 });
    } catch (_) {
      M.toast({ html: 'Could not read preset file.', displayLength: 3000 });
    }
  };
  reader.readAsText(file);
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
    inlayEdgeMargin:      parseFloat(document.getElementById('inlayEdgeMargin').value),
    inlayDoubleOffsetV:      parseFloat(document.getElementById('inlayDoubleOffsetV').value),
    inlayDoubleOffsetH:      parseFloat(document.getElementById('inlayDoubleOffsetH').value),
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
    multiscale:           document.getElementById('multiscale').checked,
    bassScaleLength:      toMm(document.getElementById('bassScaleLength').value),
    trebleScaleLength:    toMm(document.getElementById('trebleScaleLength').value),
    perpendicularFret:    document.getElementById('perpendicularFret').value,
    stringPreset:         document.getElementById('stringPreset').value,
    bridgeStyle:          document.getElementById('bridgeStyle')?.value || 'NONE',
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
    const ori = s.inlayDoubleOrientation === 'staggered' ? 'vertical' : s.inlayDoubleOrientation;
    const sel = document.getElementById('inlayDoubleOrientation');
    if (sel) { sel.value = ori; M.FormSelect.init(sel); }
  }

  const setDimSld = (id, valId, v) => {
    if (v == null) return;
    const el = document.getElementById(id), valEl = document.getElementById(valId);
    if (!el || !valEl) return;
    el.value = v;
    const u = document.getElementById('unit').value;
    valEl.textContent = u === 'inch' ? (v / MM_PER_IN).toFixed(3) + ' in' : parseFloat(v).toFixed(1) + ' mm';
  };
  setDimSld('inlaySize',          'inlaySizeVal',          s.inlaySize);
  setDimSld('inlayHeight',        'inlayHeightVal',        s.inlayHeight);
  setDimSld('inlayDoubleOffsetV', 'inlayDoubleOffsetVVal', s.inlayDoubleOffsetV ?? s.inlayDoubleOffset ?? 8);
  setDimSld('inlayDoubleOffsetH', 'inlayDoubleOffsetHVal', s.inlayDoubleOffsetH ?? 0);
  setDimSld('inlayEdgeMargin',    'inlayEdgeMarginVal',    s.inlayEdgeMargin ?? 1.5);
  updateDoubleMarkerControls();
  updateInlayEdgeMarginVisibility();
  sld('inlayShrinkWidth1224',  'inlayShrinkWidth1224Val',  s.inlayShrinkWidth1224);
  sld('inlayShrinkHeight1224', 'inlayShrinkHeight1224Val', s.inlayShrinkHeight1224);
  sld('inlayShrinkWidth',   'inlayShrinkWidthVal',   s.inlayShrinkWidth);
  sld('inlayGrowHeight',    'inlayGrowHeightVal',    s.inlayGrowHeight);
  sld('inlayTrapezoid',     'inlayTrapezoidVal',     s.inlayTrapezoid);
  sld('inlayParallelogram', 'inlayParallelogramVal', s.inlayParallelogram);

  if (Array.isArray(s.inlayCustomPath) && s.inlayCustomPath.length > 0) {
    const validSeg = p => Array.isArray(p) && (p.length === 2 || p.length === 4 || p.length === 6);
    if (Array.isArray(s.inlayCustomPath[0]) && Array.isArray(s.inlayCustomPath[0][0])) {
      // New 3-D format: [[subpath0_segs], [subpath1_segs], ...]
      customPathPoints = s.inlayCustomPath.map(sp =>
        sp.filter(validSeg).map(p => p.map(Number))
      );
    } else {
      // Legacy 2-D format (single subpath): [[x,y], ...] — wrap in outer array.
      customPathPoints = [
        s.inlayCustomPath.filter(validSeg).map(p => p.map(Number))
      ];
    }
    if (customPathPoints.length === 0) customPathPoints = [[]];
    _cpActiveSubpath = 0;
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

  if (s.multiscale != null) {
    chk('multiscale', s.multiscale);
    document.getElementById('multiscaleEditor').style.display = s.multiscale ? '' : 'none';
  }
  set('bassScaleLength',   d(s.bassScaleLength));
  set('trebleScaleLength', d(s.trebleScaleLength));
  set('perpendicularFret', s.perpendicularFret);
  if (s.stringPreset != null) {
    document.getElementById('stringPreset').value = s.stringPreset;
    M.FormSelect.init(document.getElementById('stringPreset'));
  }
  if (s.bridgeStyle != null) {
    const bsEl = document.getElementById('bridgeStyle');
    if (bsEl) bsEl.value = s.bridgeStyle;
  }

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
