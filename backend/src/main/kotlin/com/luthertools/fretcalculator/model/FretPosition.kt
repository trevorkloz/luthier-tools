package com.luthertools.fretcalculator.model

data class FretPosition(
    val fretNumber: Int,
    val distanceFromNut: Double,
    val distanceFromPreviousFret: Double,
    // Multiscale: x-offset from x_perp for treble and bass edges. Null for single-scale.
    val xOffsetTreble: Double? = null,
    val xOffsetBass: Double? = null,
)
