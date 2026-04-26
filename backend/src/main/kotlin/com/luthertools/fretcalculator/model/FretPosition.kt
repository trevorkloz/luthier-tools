package com.luthertools.fretcalculator.model

data class FretPosition(
    val fretNumber: Int,
    val distanceFromNut: Double,
    val distanceFromPreviousFret: Double,
)
