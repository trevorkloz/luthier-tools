package com.luthertools.fretcalculator.model

data class LightingRequest(
    val scaleLength: Double,
    val numberOfFrets: Int,
    val nutWidth: Double,
    val width12thFret: Double,
    val unit: String = "mm",
    val inlayDoubleOffset: Double = 8.0,
    val channelWidth: Double = 1.2,
    val ledPocketSize: Double = 2.2,
    val trussRodWidth: Double = 6.0,
    val showInlays: Boolean = true,
    val doubleInlays: Boolean = true,
    val inlayPosition: String = "center",
    val inlaySize: Double = 6.0,
)
