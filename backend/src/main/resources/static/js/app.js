'use strict';

const API_URL     = '/api/frets/calculate';
const STORAGE_KEY = 'fretCalcParams';

const PRESETS = [
  { name: 'Classical Guitar (650 mm)',       scaleLength: 650, nutWidth: 52, width12thFret: 60, numberOfFrets: 19, unit: 'mm', radius: 0   },
  { name: 'Electric Guitar 25.5" (648 mm)',  scaleLength: 648, nutWidth: 42, width12thFret: 52, numberOfFrets: 22, unit: 'mm', radius: 184 },
  { name: 'Electric Guitar 24.75" (628 mm)', scaleLength: 628, nutWidth: 42, width12thFret: 52, numberOfFrets: 22, unit: 'mm', radius: 305 },
  { name: 'Electric Guitar 25" (635 mm)',    scaleLength: 635, nutWidth: 42, width12thFret: 52, numberOfFrets: 22, unit: 'mm', radius: 254 },
  { name: 'Bass Guitar 34" (864 mm)',        scaleLength: 864, nutWidth: 42, width12thFret: 55, numberOfFrets: 20, unit: 'mm', radius: 305 },
  { name: 'Bass Guitar 30" (762 mm)',        scaleLength: 762, nutWidth: 40, width12thFret: 53, numberOfFrets: 20, unit: 'mm', radius: 254 },
  { name: 'Ukulele Soprano (345 mm)',        scaleLength: 345, nutWidth: 35, width12thFret: 42, numberOfFrets: 14, unit: 'mm', radius: 0   },
  { name: 'Mandolin (350 mm)',               scaleLength: 350, nutWidth: 34, width12thFret: 40, numberOfFrets: 17, unit: 'mm', radius: 0   },
  { name: 'Violin (330 mm)',                 scaleLength: 330, nutWidth: 24, width12thFret: 30, numberOfFrets: 0,  unit: 'mm', radius: 0   },
];

let lastResponse = null;
let debounceTimer = null;

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
  M.Collapsible.init(document.getElementById('inputSections'), { accordion: false });
  M.FormSelect.init(document.querySelectorAll('select'));

  restoreState();
  M.updateTextFields();
  updateUnitHints();
  updateShapeFields();

  document.querySelectorAll('input[type="number"]').forEach(el => {
    el.addEventListener('input', scheduleCalculate);
  });

  bindSlider('inlayShrinkWidth', 'inlayShrinkWidthVal');
  bindSlider('inlayGrowHeight',  'inlayGrowHeightVal');
  bindSlider('inlayTrapezoid',   'inlayTrapezoidVal');

  document.getElementById('unit').addEventListener('change', () => {
    updateUnitHints();
    scheduleCalculate();
  });
  document.getElementById('preset').addEventListener('change', applyPreset);

  ['showFretNumbers','showCenterLine','showWidthAnnotations',
   'showInlays','doubleInlays','showBoundingBox','showRadius',
   'showNutSlot','showPinholes'].forEach(id => {
    document.getElementById(id).addEventListener('change', scheduleCalculate);
  });

  document.getElementById('radiusPreset').addEventListener('change', () => {
    const v = document.getElementById('radiusPreset').value;
    if (v !== '') { document.getElementById('radiusValue').value = v; M.updateTextFields(); }
    scheduleCalculate();
  });

  document.getElementById('inlayPreset').addEventListener('change', function () {
    currentInlayPresetId = this.value;
    updateShapeFields();
    scheduleCalculate();
  });
  document.getElementById('inlayPosition').addEventListener('change', scheduleCalculate);
  document.getElementById('inlayDoubleOrientation').addEventListener('change', scheduleCalculate);

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
    inlayPresets = [{ id: 'circle', name: 'Circle', doubleOrientation: 'vertical' }];
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
  document.getElementById('scaleLength').value   = p.scaleLength;
  document.getElementById('numberOfFrets').value = p.numberOfFrets;
  document.getElementById('nutWidth').value       = p.nutWidth;
  document.getElementById('width12thFret').value  = p.width12thFret;
  const unitEl = document.getElementById('unit');
  unitEl.value = p.unit;
  M.FormSelect.init(unitEl);
  if (p.radius !== undefined) {
    document.getElementById('radiusValue').value = p.radius;
    const rpEl = document.getElementById('radiusPreset');
    rpEl.value = String(p.radius);
    M.FormSelect.init(rpEl);
  }
  updateUnitHints();
  M.updateTextFields();
  calculate();
}

function updateUnitHints() {
  const unit = document.getElementById('unit').value;
  document.querySelectorAll('.unit-hint').forEach(el => el.textContent = unit);
}

// ── Slider helper ─────────────────────────────────────────────
function bindSlider(id, valId) {
  const el = document.getElementById(id), valEl = document.getElementById(valId);
  el.addEventListener('input', () => { valEl.textContent = parseFloat(el.value).toFixed(2); scheduleCalculate(); });
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
    document.getElementById('downloadPdfBtn').classList.remove('disabled');
  } catch (e) {
    M.toast({ html: 'Cannot reach backend — make sure Spring Boot is running on port 8080.', displayLength: 4000 });
  } finally {
    setLoading(false);
  }
}

function buildRequest() {
  const presetIdx = parseInt(document.getElementById('preset').value, 10);
  return {
    scaleLength:          parseFloat(document.getElementById('scaleLength').value),
    numberOfFrets:        parseInt(document.getElementById('numberOfFrets').value, 10),
    nutWidth:             parseFloat(document.getElementById('nutWidth').value),
    width12thFret:        parseFloat(document.getElementById('width12thFret').value),
    unit:                 document.getElementById('unit').value,
    showFretNumbers:      document.getElementById('showFretNumbers').checked,
    showCenterLine:       document.getElementById('showCenterLine').checked,
    showWidthAnnotations: document.getElementById('showWidthAnnotations').checked,
    showInlays:           document.getElementById('showInlays').checked,
    doubleInlays:         document.getElementById('doubleInlays').checked,
    showBoundingBox:      document.getElementById('showBoundingBox').checked,
    label:                isNaN(presetIdx) ? '' : PRESETS[presetIdx].name,
    showRadius:           document.getElementById('showRadius').checked,
    radiusValue:          parseFloat(document.getElementById('radiusValue').value),
    radiusSteps:          parseInt(document.getElementById('radiusSteps').value, 10),
    showNutSlot:          document.getElementById('showNutSlot').checked,
    nutSlotWidth:         parseFloat(document.getElementById('nutSlotWidth').value),
    nutSlotDistance:      parseFloat(document.getElementById('nutSlotDistance').value),
    showPinholes:         document.getElementById('showPinholes').checked,
    tangWidth:            parseFloat(document.getElementById('tangWidth').value),
    fretExtensionAmount:  parseFloat(document.getElementById('fretExtensionAmount').value),
    inlayShape:           currentInlayPresetId,
    inlaySize:            parseFloat(document.getElementById('inlaySize').value),
    inlayHeight:          parseFloat(document.getElementById('inlayHeight').value),
    inlayPosition:           document.getElementById('inlayPosition').value,
    inlayDoubleOffset:       parseFloat(document.getElementById('inlayDoubleOffset').value),
    inlayDoubleOrientation:  document.getElementById('inlayDoubleOrientation').value,
    inlayShrinkWidth:        parseFloat(document.getElementById('inlayShrinkWidth').value),
    inlayGrowHeight:      parseFloat(document.getElementById('inlayGrowHeight').value),
    inlayTrapezoid:       parseFloat(document.getElementById('inlayTrapezoid').value) / 50,
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
  // Strip absolute mm dimensions so CSS width:100%/height:auto controls sizing via viewBox ratio.
  // Without this, the browser may briefly apply the intrinsic mm size (~2500px wide) causing layout freeze.
  const svgStr = data.svgContent
    .replace(/ width="[^"]*mm"/, '')
    .replace(/ height="[^"]*mm"/, '');
  container.innerHTML = svgStr;
  container.style.display = '';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('previewSubtitle').textContent =
    `Scale: ${data.scaleLength} ${data.unit}  ·  ${data.fretPositions.length} frets`;
}

function renderTable(data) {
  const card = document.getElementById('tableCard');
  document.getElementById('colNut').textContent   = `Distance from Nut (${data.unit})`;
  document.getElementById('colSpace').textContent = `Slot Spacing (${data.unit})`;
  if (data.fretPositions.length === 0) { card.style.display = 'none'; return; }
  document.getElementById('fretTableBody').innerHTML = data.fretPositions.map(fp => `
    <tr>
      <td>${fp.fretNumber}</td>
      <td>${fp.distanceFromNut.toFixed(4)}</td>
      <td>${fp.distanceFromPreviousFret.toFixed(4)}</td>
    </tr>`).join('');
  card.style.display = '';
}

// ── Download SVG ──────────────────────────────────────────────
function downloadSvg() {
  if (!lastResponse) return;
  const blob = new Blob([lastResponse.svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `fretboard-${lastResponse.scaleLength}${lastResponse.unit}-${lastResponse.fretPositions.length}frets.svg`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Download PDF (SVG → canvas → PNG → jsPDF) ─────────────────
async function downloadPdf() {
  if (!lastResponse) return;

  const { jsPDF } = window.jspdf;
  const margin = 10, pageW = 297, pageH = 210, usableW = pageW - 2 * margin;

  // Read SVG dimensions from viewBox (width/height attrs are stripped for display stability).
  const svgEl = document.querySelector('#svgContainer svg');
  const vb    = svgEl?.getAttribute('viewBox')?.split(/\s+/);
  const svgW  = vb ? parseFloat(vb[2]) : 200;  // mm (viewBox units == mm)
  const svgH  = vb ? parseFloat(vb[3]) : 100;
  const aspect = svgW / svgH;

  // Rasterize SVG at ~150 dpi into usableW mm
  const pxW = Math.round(usableW * (150 / 25.4));
  const pxH = Math.round(pxW / aspect);

  // Override mm dimensions with px so the browser renders at the exact target size
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

  const doc    = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const scaledH = usableW / aspect;
  let curY = margin;

  // Title
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
      head:       [['Fret #', `Distance from Nut (${lastResponse.unit})`, `Slot Spacing (${lastResponse.unit})`]],
      body:       lastResponse.fretPositions.map(fp => [
                    fp.fretNumber,
                    fp.distanceFromNut.toFixed(4),
                    fp.distanceFromPreviousFret.toFixed(4),
                  ]),
      styles:     { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [2, 119, 189] },
      margin:     { left: margin, right: margin },
    });
    curY = doc.lastAutoTable.finalY + 6;
  }

  // Radius contour table (when enabled)
  const radiusOn = document.getElementById('showRadius').checked;
  const R        = parseFloat(document.getElementById('radiusValue').value);
  const N        = parseInt(document.getElementById('radiusSteps').value, 10);
  if (radiusOn && R > 0 && N >= 2) {
    const req         = buildRequest();
    const pos12       = req.scaleLength / 2;
    const widthAtEnd  = req.nutWidth + (req.width12thFret - req.nutWidth) * req.scaleLength / pos12;
    const halfHeel    = widthAtEnd / 2;
    const radiusBody  = [];
    for (let k = 1; k <= N; k++) {
      const fracO  = k / N;
      const fracI  = (k - 1) / N;
      const yI     = (fracI * halfHeel).toFixed(2);
      const yO     = (fracO * halfHeel).toFixed(2);
      const depth  = (R - Math.sqrt(R * R - (fracO * halfHeel) ** 2)).toFixed(3);
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

    // Inlay depth suggestion when inlays are also active
    if (buildRequest().showInlays) {
      const pos12      = buildRequest().scaleLength / 2;
      const widthEnd   = buildRequest().nutWidth + (buildRequest().width12thFret - buildRequest().nutWidth) * buildRequest().scaleLength / pos12;
      const halfHeel   = widthEnd / 2;
      const edgeOff    = (R - Math.sqrt(R * R - halfHeel * halfHeel)).toFixed(3);
      if (curY + 24 > pageH - margin) { doc.addPage(); curY = margin; }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      const noteLines = doc.splitTextToSize(
        `Inlay pocket depth with radius R = ${R} mm: ` +
        `The fretboard surface curves away from the centre after radiusing. ` +
        `Minimum finished inlay depth from the radiused surface: 2.5 mm. ` +
        `For centre-positioned markers no correction is needed. ` +
        `For edge-positioned markers add the radius offset at that position. ` +
        `Maximum surface offset at fretboard edge: ${edgeOff} mm. ` +
        `Required pre-radius pocket depth (edge marker): ${(2.5 + parseFloat(edgeOff)).toFixed(3)} mm.`,
        pageW - 2 * margin
      );
      doc.text(noteLines, margin, curY + 4);
      curY += noteLines.length * 4 + 4;
    }
  }

  doc.save(`fretboard-${lastResponse.scaleLength}${lastResponse.unit}.pdf`);
}

// ── UI helpers ────────────────────────────────────────────────
function updateShapeFields() {
  const isRect = currentInlayPresetId === 'rectangle';
  document.getElementById('inlayHeightField').style.display    = isRect ? '' : 'none';
  document.getElementById('inlayTrapezoidField').style.display = isRect ? '' : 'none';
}

function setLoading(loading) {
  document.getElementById('progressBar').style.display = loading ? '' : 'none';
}

// ── Config code ───────────────────────────────────────────────
// 26 lowercase alphanumeric characters (base-36 BigInt, 130 bits packed)
// Fields in pack order:
//   scaleLength(12) numberOfFrets(6) nutWidth(8) width12thFret(8) unit(1)
//   showFretNumbers(1) showCenterLine(1) showWidthAnnotations(1)
//   showInlays(1) doubleInlays(1) doubleOrientation(1) showBoundingBox(1)
//   inlayShape(3) inlaySize(6) inlayHeight(6) inlayPosition(2)
//   inlayDoubleOffset(6) inlayShrinkWidth(4) inlayGrowHeight(7) inlayTrapezoid(6)
//   showRadius(1) radiusValue(12) radiusSteps(4)
//   showNutSlot(1) nutSlotWidth(5) nutSlotDistance(6)
//   showPinholes(1) tangWidth(5) fretExtensionAmount(6)  = 130 bits
const CONFIG_SCHEMA = [12,6,8,8,1,1,1,1,1,1,1,1,3,6,6,2,6,4,7,6,1,12,4,1,5,6,1,5,6];
const CONFIG_CHARS  = 26;

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
    s.inlayDoubleOrientation === 'horizontal' ? 1 : 0,           //  1 bit
    s.showBoundingBox      ? 1 : 0,                              //  1 bit
    Math.max(0, inlayPresets.findIndex(p => p.id === s.inlayShape)), //  3 bits
    Math.round((parseFloat(s.inlaySize)          - 2)   * 2),   //  6 bits  0-36
    Math.round((parseFloat(s.inlayHeight)        - 1)   * 2),   //  6 bits  0-58
    s.inlayPosition === 'center' ? 0 : s.inlayPosition === 'top' ? 1 : 2, // 2 bits
    Math.round((parseFloat(s.inlayDoubleOffset)  - 2)   * 2),   //  6 bits  0-56
    Math.round(parseFloat(s.inlayShrinkWidth) / 0.25),           //  4 bits  0-8
    Math.round(parseFloat(s.inlayGrowHeight)  / 0.1),            //  7 bits  0-100
    parseInt(s.inlayTrapezoid),                                   //  6 bits  0-50 (raw slider)
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
  return bits.toString(36).padStart(CONFIG_CHARS, '0');
}

function decodeConfig(raw) {
  const code = raw.toLowerCase().replace(/\s/g, '');
  if (code.length !== CONFIG_CHARS || !/^[0-9a-z]+$/.test(code)) throw new Error('Invalid code');
  let bits = 0n;
  for (const c of code) bits = bits * 36n + BigInt(parseInt(c, 36));
  const totalBits = CONFIG_SCHEMA.reduce((a, b) => a + b, 0);
  const vals = [];
  let shift = BigInt(totalBits);
  for (const nbits of CONFIG_SCHEMA) {
    shift -= BigInt(nbits);
    vals.push(Number((bits >> shift) & ((1n << BigInt(nbits)) - 1n)));
  }
  const [sl,nf,nw,w12,unit,sfn,scl,swa,si,di,dO,sbb,shape,isz,ih,ip,ido,sw,gh,trap,
         showR,rv,rs,sNS,nsw,nsd,sPH,tw,fea] = vals;
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
    inlayDoubleOrientation:  dO  === 1 ? 'horizontal' : 'vertical',
    showBoundingBox:         sbb === 1,
    inlayShape:           inlayPresets[shape]?.id ?? 'circle',
    inlaySize:            isz / 2 + 2,
    inlayHeight:          ih  / 2 + 1,
    inlayPosition:        ip === 0 ? 'center' : ip === 1 ? 'top' : 'bottom',
    inlayDoubleOffset:    ido / 2 + 2,
    inlayShrinkWidth:     sw  * 0.25,
    inlayGrowHeight:      gh  * 0.1,
    inlayTrapezoid:       trap,
    showRadius:           showR === 1,
    radiusValue:          rv  / 2 + 50,
    radiusSteps:          rs  + 2,
    showNutSlot:          sNS === 1,
    nutSlotWidth:         nsw / 2 + 0.5,
    nutSlotDistance:      nsd / 2 - 10,
    showPinholes:         sPH === 1,
    tangWidth:            tw  * 0.1 + 0.1,
    fretExtensionAmount:  fea / 2 - 10,
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
function stateSnapshot() {
  return {
    scaleLength:          document.getElementById('scaleLength').value,
    numberOfFrets:        document.getElementById('numberOfFrets').value,
    nutWidth:             document.getElementById('nutWidth').value,
    width12thFret:        document.getElementById('width12thFret').value,
    unit:                 document.getElementById('unit').value,
    showFretNumbers:      document.getElementById('showFretNumbers').checked,
    showCenterLine:       document.getElementById('showCenterLine').checked,
    showWidthAnnotations: document.getElementById('showWidthAnnotations').checked,
    showInlays:           document.getElementById('showInlays').checked,
    doubleInlays:         document.getElementById('doubleInlays').checked,
    showBoundingBox:      document.getElementById('showBoundingBox').checked,
    inlayShape:           currentInlayPresetId,
    inlaySize:            document.getElementById('inlaySize').value,
    inlayHeight:          document.getElementById('inlayHeight').value,
    inlayPosition:           document.getElementById('inlayPosition').value,
    inlayDoubleOffset:       document.getElementById('inlayDoubleOffset').value,
    inlayDoubleOrientation:  document.getElementById('inlayDoubleOrientation').value,
    inlayShrinkWidth:        document.getElementById('inlayShrinkWidth').value,
    inlayGrowHeight:      document.getElementById('inlayGrowHeight').value,
    inlayTrapezoid:       document.getElementById('inlayTrapezoid').value,
    showRadius:           document.getElementById('showRadius').checked,
    radiusValue:          document.getElementById('radiusValue').value,
    radiusSteps:          document.getElementById('radiusSteps').value,
    showNutSlot:          document.getElementById('showNutSlot').checked,
    nutSlotWidth:         document.getElementById('nutSlotWidth').value,
    nutSlotDistance:      document.getElementById('nutSlotDistance').value,
    showPinholes:         document.getElementById('showPinholes').checked,
    tangWidth:            document.getElementById('tangWidth').value,
    fretExtensionAmount:  document.getElementById('fretExtensionAmount').value,
  };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stateSnapshot())); } catch (e) {}
}

function restoreState() {
  let s;
  try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) {}
  if (s) applyStateData(s);
}

function applyStateData(s) {
  const set = (id, v) => { if (v != null) document.getElementById(id).value = v; };
  const chk = (id, v) => { if (v != null) document.getElementById(id).checked = v; };
  const sld = (id, vid, v) => {
    if (v == null) return;
    document.getElementById(id).value = v;
    document.getElementById(vid).textContent = parseFloat(v).toFixed(2);
  };

  set('scaleLength', s.scaleLength);  set('numberOfFrets', s.numberOfFrets);
  set('nutWidth', s.nutWidth);        set('width12thFret', s.width12thFret);

  if (s.unit) { document.getElementById('unit').value = s.unit; M.FormSelect.init(document.getElementById('unit')); }

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

  set('inlaySize', s.inlaySize);  set('inlayHeight', s.inlayHeight);
  set('inlayDoubleOffset', s.inlayDoubleOffset);
  sld('inlayShrinkWidth', 'inlayShrinkWidthVal', s.inlayShrinkWidth);
  sld('inlayGrowHeight',  'inlayGrowHeightVal',  s.inlayGrowHeight);
  sld('inlayTrapezoid',   'inlayTrapezoidVal',   s.inlayTrapezoid);

  chk('showRadius',   s.showRadius);
  set('radiusValue',  s.radiusValue);
  set('radiusSteps',  s.radiusSteps);

  chk('showNutSlot',     s.showNutSlot);
  set('nutSlotWidth',    s.nutSlotWidth);
  set('nutSlotDistance', s.nutSlotDistance);
  chk('showPinholes',    s.showPinholes);
  set('tangWidth',            s.tangWidth);
  set('fretExtensionAmount',  s.fretExtensionAmount);
}
