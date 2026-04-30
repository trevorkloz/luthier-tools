package com.luthertools.fretcalculator.model

class InlayShapeCtx(
    val baseId: String,
    val cx: Double,
    val midDist: Double,
    val effectiveSize: Double,
    val effectiveHeight: Double,
    val trap: Double,
    val parallelogram: Double,
    val edgePad: Double,
    val effectiveInlayDoubleOffset: Double,
    val isDouble: Boolean,
    val position: InlayPosition,
    val doubleOrientation: InlayDoubleOrientation,
    val f: (Double) -> String,
    val yTop: (Double) -> Double,
    val yBottom: (Double) -> Double,
    val centerY: Double,
    val cutPath: (String, String) -> String,
    val fretNumber: Int = 0,
    // Custom polygon segments. Each entry is a flat list of normalized [0,1] coords:
    //   [x, y]                       — first entry: start point (treated as 'M')
    //   [x, y]                       — subsequent: line to (treated as 'L')
    //   [cx, cy, x, y]               — quadratic Bezier (control + end, 'Q')
    //   [c1x, c1y, c2x, c2y, x, y]   — cubic Bezier (two controls + end, 'C')
    val customPath: List<List<Double>> = emptyList(),
    // For InlayShape.CUSTOM: when true (default) the path closes via Z and uses cutPath
    // (an "inside" pocket cut); when false the path is left open and uses cutPathOnline
    // (an "online" stroke cut), so users can render decorative line work.
    val customPathClosed: Boolean = true,
    val cutPathOnline: ((String, String) -> String)? = null,
)
