package com.luthertools.fretcalculator.service

class FretboardGeometry(
    scaleLength: Double,
    private val nutWidth: Double,
    private val width12thFret: Double,
) {
    private val position12 = scaleLength * 0.5
    val widthAtEnd: Double = nutWidth + (width12thFret - nutWidth) * scaleLength / position12
    val centerY:    Double = SVG_MARGIN_TOP + widthAtEnd / 2.0

    fun widthAt(d: Double) = nutWidth + (width12thFret - nutWidth) * d / position12
    fun yTop(d: Double)    = SVG_MARGIN_TOP + (widthAtEnd - widthAt(d)) / 2.0
    fun yBottom(d: Double) = SVG_MARGIN_TOP + (widthAtEnd + widthAt(d)) / 2.0
}
