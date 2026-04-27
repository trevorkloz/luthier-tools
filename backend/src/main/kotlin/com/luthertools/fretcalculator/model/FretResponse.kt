package com.luthertools.fretcalculator.model

data class FretResponse(
    val fretPositions: List<FretPosition>,
    val svgContent: String,
    val unit: Unit,
    val scaleLength: Double,
)
