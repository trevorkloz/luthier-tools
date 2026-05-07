package com.luthertools.fretcalculator.model

data class FretRequest(
    val scaleLength: Double,
    val numberOfFrets: Int,
    val nutWidth: Double,
    val width12thFret: Double,
    val unit: Unit = Unit.MM,
    val showFretNumbers: Boolean = true,
    val showCenterLine: Boolean = true,
    val showWidthAnnotations: Boolean = true,
    val showInlays: Boolean = true,
    val doubleInlays: Boolean = true,
    val inlayShape: InlayShape = InlayShape.CIRCLE,
    val inlaySize: Double = 6.0,
    val inlayHeight: Double = 4.0,
    val inlayPosition: InlayPosition = InlayPosition.CENTER,
    val inlayEdgeMargin: Double = 1.5,
    val inlayDoubleOffsetV: Double = 8.0,
    val inlayDoubleOffsetH: Double = 0.0,
    val inlayShrinkWidth1224: Double = 0.0,
    val inlayShrinkHeight1224: Double = 0.0,
    val inlayShrinkWidth: Double = 0.0,
    val inlayGrowHeight: Double = 0.0,
    val inlayTrapezoid: Double = 0.0,
    val inlayParallelogram: Double = 0.0,
    val showBoundingBox: Boolean = false,
    val label: String = "",
    val showRadius: Boolean = false,
    val radiusValue: Double = 305.0,
    val radiusSteps: Int = 5,
    val showNutSlot: Boolean = false,
    val nutSlotWidth: Double = 5.5,
    val nutSlotDistance: Double = 0.0,
    val showPinholes: Boolean = false,
    val tangWidth: Double = 0.6,
    val fretExtensionAmount: Double = 0.0,
    val inlayDoubleOrientation: InlayDoubleOrientation = InlayDoubleOrientation.VERTICAL,
    // Subpaths for InlayShape.CUSTOM, normalized to [0,1]². Each outer entry is one subpath;
    // inner entries are segments: [x,y] = line, [cx,cy,x,y] = Q bezier, [c1x,c1y,c2x,c2y,x,y] = C bezier.
    // Multiple subpaths with fill-rule evenodd produce correct holes (e.g. letter "A").
    val inlayCustomPath: List<List<List<Double>>> = emptyList(),
    // Whether the custom shape is rendered as a closed filled area (true → "inside"
    // pocket cut) or as an open line (false → "online" stroke cut).
    val inlayCustomClosed: Boolean = true,
)
