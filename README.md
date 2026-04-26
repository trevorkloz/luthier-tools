# Luthier Tools — Shaper Origin Utilities

Spring Boot 3 / Kotlin / Thymeleaf web application for generating Shaper Origin–compatible SVG files for guitar and bass fretboard work.
All cuts are encoded with `shaper:cutType` attributes so the Shaper Origin CNC router can distinguish pocket depths, online cuts, and guide-only elements without any manual setup in the Shaper app.

---

## Use Case 1 — Fretboard Layout (`/`)

Calculates equal-temperament fret positions and generates a full fretboard SVG ready to load into Shaper Origin.
The SVG contains all cut information in Shaper-native attributes — you load the file, position it on your fretboard blank, and cut.

### Parameters

**Instrument preset** — selects a named instrument (Classical Guitar, Electric Guitar 25.5″, Bass, Ukulele, Mandolin, Violin, …) and fills in scale length, fret count, and nut/12th-fret widths automatically. Any value can be overridden individually after selecting a preset.

**Scale length (100–2000 mm or inch)** — the vibrating string length from nut to bridge saddle. This is the fundamental measurement from which every fret position is derived using the equal-temperament formula `distance = scaleLength × (1 − 2^(−n/12))`.

**Number of frets (0–36)** — how many fret slots to generate. Set to 0 to produce just the outline with no slots (useful for nut-only work or as a template for hand-layout).

**Nut width and width at 12th fret** — the fretboard is tapered: wider at the nut, narrower toward the body. These two measurements define a linear taper extrapolated to the full scale length. The SVG outline, inlay positions, annotation lines, and pinhole positions all follow this taper automatically.

**Unit** — toggle between millimetres and inches. All dimensions in the UI and all SVG annotation text update accordingly.

---

### Fret Slots

Fret slots are output as `shaper:cutType="pocket"` cuts (not online) because the Shaper Origin needs to remove material, not just follow a line, to cut a press-fit kerf.

**Slot width (tang width)** — the width of each fret pocket in millimetres (0.10–3.00 mm). Match this to the tang thickness of your chosen fretwire. Common values are listed in the UI: Jescar FW55090 = 0.53 mm, Dunlop 6100 = 0.56 mm. A slightly wider slot gives a looser fit for glue-in fretwire; a tighter slot gives a press-fit.

**Fret extension / indent** — positive values extend each slot beyond both fretboard edges (useful for binding-free builds where the fretwire overhangs). Negative values indent the slot inward from the edge (for pre-bound fretboards where you want the fret to stop short of the binding). 0 = flush with the fretboard edge.

---

### Inlay Markers

Inlay markers are output as `shaper:cutType="pocket"` cuts. Three shapes are available, each with full control over double-marker orientation.

**Inlay type** — loaded dynamically from the backend. Currently available:
- **Circle** — the standard dot inlay. Drawn as an SVG arc path rather than `<circle>` so Shaper Origin reads it as a pocket.
- **Rectangle** — a rectangular bar inlay. Supports a height dimension (perpendicular to the fret direction) independent of the width, and a trapezoid factor that progressively widens one side of the bar toward higher frets (matching the narrowing fret spacing for a proportional look).
- **Diamond** — a rotated square. Width/size controls both the horizontal and vertical extent.

**Width / diameter (mm)** — the primary size of the inlay. For circles this is the diameter; for rectangles the dimension along the fret direction; for diamonds the full width.

**Height (mm)** — rectangle only. The dimension across the fretboard width. Kept separate from width so you can make wide-and-short or narrow-and-tall bar inlays independently.

**Trapezoid factor** — rectangle only. At 0 the bar has parallel sides. Increasing this value makes one side taller than the other, creating a trapezoidal bar whose height ratio tracks the fret spacing taper — so bar inlays look proportionally consistent from the first to the last position even as the frets get closer together.

**Position** — where across the fretboard width the inlay sits:
- *Center* — symmetric on the fretboard centre line (standard for most guitars)
- *Treble edge* — offset toward the high-string side, touching the edge with a small clearance
- *Bass edge* — offset toward the low-string side

**Double markers at frets 12 & 24** — when enabled, frets 12 and 24 get a pair of markers instead of one. The pair offset (centre-to-centre distance in mm) and the orientation determine how the pair is arranged.

**Pair offset (mm)** — the centre-to-centre distance between the two markers in a double. Works in both vertical and horizontal orientation.

**Double marker orientation** — controls the axis along which the pair is laid out:
- *Vertical* (default) — the two markers are stacked across the fretboard width (perpendicular to the frets). This is the traditional arrangement on most guitars.
- *Horizontal* — the two markers are placed side by side along the fret direction (parallel to the frets). This mimics the staggered-dot style seen on some custom and multi-scale instruments.

**Width shrink factor** — when set above 0, inlay markers at higher fret positions (where fret spacing is smaller) are drawn narrower proportionally. At maximum, the inlay scales its width exactly with the local fret spacing — so the gap between inlay edge and fret wire is the same at every position.

**Height grow factor** — when set above 0, inlays at positions where the fretboard is wider (toward the nut on a tapered board) are drawn taller proportionally. Useful for bar and rectangle inlays to fill the available space.

---

### Fretboard Outline & Guides

**Fretboard outline** — a `shaper:cutType="online"` path following the tapered fretboard shape. This cuts the fretboard to shape. The taper extrapolates linearly beyond the 12th-fret width measurement to the full scale length.

**Center-line guide** — a dashed line on the guide layer (not a cut) marking the geometric centre of the fretboard. Useful for checking symmetry and inlay centering.

**Fret numbers** — text labels below each fret slot on the guide layer. Not a cut; these appear in Inkscape/Shaper Origin as non-cuttable guide text.

**Width & scale annotations** — dimension lines showing nut width, 12th-fret width, and overall scale length with arrows and text. All on the guide layer.

**Fretboard blank bounding box** — an optional dashed rectangle on the guide layer showing the minimum blank dimensions needed. Use this to mark your stock before mounting it on the Shaper Origin.

---

### Radius Contours

Optional guide layer showing where to mill for a given fretboard radius.

**Radius value (50–5000 mm)** — common presets (7.25″ to 16″) are available in a dropdown, or enter any custom value. Stored and displayed in millimetres; the SVG guide shows both mm and inch equivalent.

**Contour steps (2–10)** — divides the fretboard width into N equal-width milling zones. Zone 1 is the centre strip (shallowest cut); Zone N reaches the outer edge (deepest cut). Each zone gets a depth label in the SVG right margin.

**How to use with Shaper Origin** — set the depth to Zone 1 and make the first pass only over the centre zone. Increase depth to Zone 2 and widen the pass. Continue outward until all N zones are done. This approximates a cylindrical radius using a series of flat pocket passes, which is the standard approach with a CNC router.

The PDF export includes a radius table with zone boundaries and exact depths, and a note on inlay pocket depth correction for radiused boards.

---

### Nut Slot

An optional nut-bone pocket at the 0th fret position.

**Draw nut slot pocket** — when enabled, generates a `shaper:cutType="pocket"` rectangle for the nut.

**Nut thickness (mm)** — the dimension in the fret direction (the thickness of the nut bone or synthetic material you are routing the slot for). Common values are 5.0–6.0 mm for electric guitar nuts.

**Distance from 0th fret (mm)** — 0 means the right (body-side) edge of the nut pocket aligns with the 0th fret line. Negative values move the slot toward the headstock — use this when the nut sits in a recess back from the fret line (common on set-neck guitars). A separate online nut line is added at the 0th fret position if the slot does not reach it.

---

### Alignment Pinholes

Two 1 mm diameter pocket circles at frets 1 and 12, placed 10 mm from each fretboard edge (four pockets total).

These are used for Shaper Origin workpiece repositioning: drill the four 1 mm holes into the fretboard blank before routing, then use the corresponding crosshair guides (shown in the SVG guide layer) to re-zero the Shaper Origin after moving it. This lets you work a fretboard longer than the Shaper Origin's single-pass range with guaranteed alignment.

---

### SVG / PDF Export

**SVG download** — the full Shaper Origin–ready SVG with all pocket and online cuts encoded. The filename includes scale length, unit, and fret count.

**PDF export (A4 landscape)** — the fretboard preview rendered at ~150 dpi, followed by:
- Fret position table (fret number, distance from nut, slot spacing — 4 decimal places)
- Radius contour table with zone boundaries and depths (when radius is enabled)
- Inlay pocket depth note for radiused boards (when both radius and inlays are enabled)

---

### Configuration Code

A 26-character base-36 string that encodes all 30 parameters in 130 bits. Copy the code to share a configuration with another person, save it externally, or restore a previously used setup. Paste it into the import field and click Apply. The code is generated and parsed entirely in the browser — no server round-trip.

---

### State Persistence & Cross-Tab Sync

All parameters are automatically saved to `localStorage` and restored on page reload — no manual save step required.

Every parameter change is also broadcast over `BroadcastChannel` and `localStorage` to the Fretboard Lighting page, which picks up the fretboard geometry and inlay layout instantly without any manual re-entry.

---

## Use Case 2 — Fretboard Lighting (`/lighting`)

Generates a Shaper Origin SVG for routing the underside wire channels and LED pockets of an addressable LED fretboard lighting system.
The fretboard dimensions (scale length, fret count, nut width, 12th-fret width) and inlay layout (position, double markers, offset, inlay size) are synced automatically from the Fretboard Layout page.

### Electrical Mode — Addressable LED Chain

**LED pocket circles** — a `shaper:cutType="pocket"` circle at every inlay marker position, sized to the LED component footprint. This is where the LED sits flush with the underside of the fretboard.

**Solder clearance bay** — a rectangular pocket adjacent to each LED pocket, sized to give clearance for a soldering iron and wire terminations. Eliminates the need to solder inside a confined space.

**Trunk channel** — a single continuous pocket channel running the full length of the fretboard, carrying three wires (GND, 5 V, DATA for NeoPixel-style, or GND, 5 V, CLK, DATA for SPI-style). The trunk runs on the same fretboard side as the inlay markers, outside the truss rod zone. The heel end is left open for the connector to the microcontroller or driver board.

**Stub channels** — short pocket channels connecting each LED pocket perpendicularly up to the trunk. If the LED is already adjacent to the trunk (offset by inlay position), the stub is omitted.

**Truss rod avoidance** — the trunk and stubs respect a clearance zone centred on the fretboard centre line, whose width matches the configured truss rod channel width. The truss rod zone is shown as a yellow dashed rectangle on the guide layer for reference.

---

### LED Type Selection

The LED type sets the pocket diameter automatically:

| Type | Footprint | Protocol | Pocket size |
|---|---|---|---|
| WS2812B-2020 | 2.0 × 2.0 × 0.45 mm | NeoPixel 1-wire RGB | 2.2 mm |
| APA102C-2020 | 2.0 × 2.0 × 0.6 mm | SPI 2-wire RGB | 2.2 mm |
| SK6812-2020 | 2.0 × 2.0 × 0.6 mm | NeoPixel RGBW | 2.2 mm |
| 0402 SMD LED | 1.0 × 0.5 × 0.35 mm | 2-wire single colour | 1.2 mm |

The 2020-series footprint adds 0.1 mm clearance per side (2.0 → 2.2 mm) for pocket tolerances. The 0402 footprint pocket is sized to 1.2 × 0.6 mm but the SVG uses a circle approximation.

---

### Channel Width

The configurable wire channel slot width (default 1.2 mm, range 0.5–5 mm). For AWG 32 (0.2 mm diameter) wire, 1.2 mm gives three wires side by side with clearance. Increase for thicker wire or multi-conductor ribbon.

---

### Guide Layer

The guide layer (locked Inkscape layer, not cut by Shaper Origin) includes:
- Fretboard outline for visual reference
- Fretboard centre line
- Truss rod clearance zone overlay (yellow dashed)
- Circle overlays at each LED position with fret-number labels
- LED count annotation at the heel end
- Trunk channel label

---

### SVG Export

Downloads the Shaper Origin–compatible SVG. The filename includes the scale length and unit. The SVG contains all routing paths as `shaper:cutType="pocket"` with `shaper:toolDia="0.125in"`.

---

### Sync from Fretboard Layout

The following values are received automatically from the Fretboard Layout page whenever they change:
- Scale length, number of frets, nut width, width at 12th fret
- Inlay position (center / treble / bass), double markers toggle, inlay size, pair offset

This means the lighting routing is always consistent with the layout routing — change the inlay position on the layout page and the lighting SVG immediately reflects the correct LED positions.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Spring Boot 3.2, Kotlin 1.9, Thymeleaf |
| Frontend | Vanilla JS (ES2020), Materialize CSS 1.0 |
| SVG | Shaper Origin SVG format (`shaper:cutType` pocket / online) |
| PDF | jsPDF 2.5 + jsPDF-AutoTable 3.8 |
| Build | Gradle (Kotlin DSL) |

---

## Running Locally

```
gradlew.bat bootRun
```

Then open `http://localhost:8080` in your browser.
