'use strict';

const API_URL = '/api/lighting/generate';

// Fretboard state — populated via cross-tab sync from Fretboard Layout.
// Default values match the layout page defaults so the preview renders on first load.
let importedScaleLength       = 648;
let importedNumberOfFrets     = 22;
let importedNutWidth          = 42;
let importedWidth12thFret     = 52;
let importedInlayDoubleOffset = 8;
let importedShowInlays        = true;
let importedDoubleInlays      = true;
let importedInlayPosition     = 'center';
let importedInlaySize         = 6.0;

// ── Cross-tab sync from Fretboard Layout ──────────────────────
const LIGHTING_SYNC_KEY = 'luthertools-lighting-sync';
let lightingSyncChannel = null;
try { lightingSyncChannel = new BroadcastChannel('luthertools-sync'); } catch (_) {}

function applyLightingSync(p, triggerCalc = true) {
  if (!p) return;
  if (p.scaleLength       != null) importedScaleLength       = p.scaleLength;
  if (p.numberOfFrets     != null) importedNumberOfFrets     = p.numberOfFrets;
  if (p.nutWidth          != null) importedNutWidth          = p.nutWidth;
  if (p.width12thFret     != null) importedWidth12thFret     = p.width12thFret;
  if (p.inlayDoubleOffset != null) importedInlayDoubleOffset = p.inlayDoubleOffset;
  if (p.showInlays        != null) importedShowInlays        = p.showInlays;
  if (p.doubleInlays      != null) importedDoubleInlays      = p.doubleInlays;
  if (p.inlayPosition     != null) importedInlayPosition     = p.inlayPosition;
  if (p.inlaySize         != null) importedInlaySize         = p.inlaySize;
  if (triggerCalc) scheduleCalculate();
}

let lastResponse  = null;
let debounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  M.Sidenav.init(document.querySelectorAll('.sidenav'));
  M.FormSelect.init(document.querySelectorAll('select'));
  M.updateTextFields();

  // Apply last known state from the layout page.
  try {
    const stored = localStorage.getItem(LIGHTING_SYNC_KEY);
    if (stored) applyLightingSync(JSON.parse(stored), false);
  } catch (_) {}

  // Live sync: reflect changes from the layout page instantly.
  if (lightingSyncChannel) {
    lightingSyncChannel.onmessage = (evt) => applyLightingSync(evt.data);
  }

  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('input', scheduleCalculate);
  });

  document.getElementById('ledType').addEventListener('change', () => {
    updateLedInfo();
    scheduleCalculate();
  });

  updateLedInfo();
  calculate();
});

function updateLedInfo() {
  const type = document.getElementById('ledType').value;
  const info = {
    'ws2812b-2020': '<b style="color:#e65100">WS2812B-2020</b> — 5 V, single-wire NeoPixel protocol.<br>RGB individually addressable. Pocket: 2.2 × 2.2 mm, depth ~0.5 mm.<br>Wiring: VCC + GND + DATA (AWG 32, 0.2 mm).',
    'apa102-2020':  '<b style="color:#e65100">APA102C-2020</b> — 5 V, SPI 2-wire (CLK + DATA).<br>RGB, faster refresh. Better for long chains. Pocket: 2.2 × 2.2 mm.',
    'sk6812-2020':  '<b style="color:#e65100">SK6812-2020</b> — 5 V, NeoPixel compatible.<br>RGBW variant adds a dedicated white chip. Pocket: 2.2 × 2.2 mm.',
    '0402-simple':  '<b style="color:#e65100">0402 SMD LED</b> — 2–3.5 V, single colour.<br>Smallest footprint. Pocket: 1.2 × 0.6 mm. Two wires per LED.',
  };
  document.getElementById('ledInfo').innerHTML = info[type] || '';
}

function buildRequest() {
  const ledType = document.getElementById('ledType').value;
  return {
    scaleLength:       importedScaleLength,
    numberOfFrets:     importedNumberOfFrets,
    nutWidth:          importedNutWidth,
    width12thFret:     importedWidth12thFret,
    inlayDoubleOffset: importedInlayDoubleOffset,
    trussRodWidth:     parseFloat(document.getElementById('trussRodWidth').value),
    showInlays:        importedShowInlays,
    doubleInlays:      importedDoubleInlays,
    inlayPosition:     importedInlayPosition,
    inlaySize:         importedInlaySize,
    channelWidth:      parseFloat(document.getElementById('channelWidth').value),
    ledPocketSize:     ledType.startsWith('0402') ? 1.2 : 2.2,
  };
}

function isValid(req) {
  return !isNaN(req.scaleLength) && req.scaleLength >= 100 &&
         !isNaN(req.numberOfFrets) && req.numberOfFrets >= 0 &&
         !isNaN(req.nutWidth) && req.nutWidth >= 10 &&
         !isNaN(req.width12thFret) && req.width12thFret >= 10;
}

function scheduleCalculate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(calculate, 350);
}

async function calculate() {
  const req = buildRequest();
  if (!isValid(req)) return;
  document.getElementById('progressBar').style.display = '';
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lastResponse = await res.json();
    renderPreview(lastResponse);
    document.getElementById('downloadBtn').classList.remove('disabled');
  } catch (e) {
    M.toast({ html: 'Cannot reach backend — is Spring Boot running on port 8080?', displayLength: 4000 });
  } finally {
    document.getElementById('progressBar').style.display = 'none';
  }
}

function renderPreview(data) {
  const container = document.getElementById('svgContainer');
  container.innerHTML = data.svgContent;
  container.style.display = '';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('previewSubtitle').textContent =
    `${data.channelCount} LEDs · ${data.scaleLength} ${data.unit}`;

  const card = document.getElementById('summaryCard');
  document.getElementById('summaryText').textContent =
    `${data.channelCount} LED${data.channelCount !== 1 ? 's' : ''} · ` +
    `Total channel length: ${data.totalChannelLength.toFixed(1)} ${data.unit}`;
  card.style.display = '';
}

function downloadSvg() {
  if (!lastResponse) return;
  const blob = new Blob([lastResponse.svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `lighting-${lastResponse.scaleLength}${lastResponse.unit}-electrical.svg`;
  a.click();
  URL.revokeObjectURL(url);
}
