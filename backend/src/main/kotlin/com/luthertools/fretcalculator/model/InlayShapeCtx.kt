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
    val effectiveInlayDoubleOffsetV: Double,
    val effectiveInlayDoubleOffsetH: Double,
    val isDouble: Boolean,
    val position: InlayPosition,
    val doubleOrientation: InlayDoubleOrientation,
    val f: (Double) -> String,
    val yTop: (Double) -> Double,
    val yBottom: (Double) -> Double,
    val centerY: Double,
    val cutPath: (String, String) -> String,
    val fretNumber: Int = 0,
    // Custom path subpaths. Each outer entry is one subpath (closed independently with Z);
    // inner entries are segments: [x,y] = start/line, [cx,cy,x,y] = Q, [c1x,c1y,c2x,c2y,x,y] = C.
    // Multiple subpaths with fill-rule evenodd produce holes (e.g. letter "A" with its inner triangle).
    val customPath: List<List<List<Double>>> = emptyList(),
    // For InlayShape.CUSTOM: when true (default) the path closes via Z and uses cutPath
    // (an "inside" pocket cut); when false the path is left open and uses cutPathOnline
    // (an "online" stroke cut), so users can render decorative line work.
    val customPathClosed: Boolean = true,
    val cutPathOnline: ((String, String) -> String)? = null,
)
