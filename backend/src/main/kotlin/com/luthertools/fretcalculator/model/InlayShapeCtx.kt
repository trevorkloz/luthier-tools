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
)
