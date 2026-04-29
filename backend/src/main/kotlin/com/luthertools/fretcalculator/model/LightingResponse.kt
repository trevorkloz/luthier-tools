package com.luthertools.fretcalculator.model

data class LightingResponse(
    val svgContent: String,
    val channelCount: Int,
    val totalChannelLength: Double,
    val unit: Unit,
    val scaleLength: Double,
)
