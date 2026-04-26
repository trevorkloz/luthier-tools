package com.luthertools.fretcalculator.model

data class FretResponse(
    val fretPositions: List<FretPosition>,
    val svgContent: String,
    val unit: String,
    val scaleLength: Double,
)
