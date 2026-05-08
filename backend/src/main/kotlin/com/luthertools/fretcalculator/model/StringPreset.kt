package com.luthertools.fretcalculator.model

// Entries are selected by name via JSON deserialization; gaugesIn and edgeNutMm drive SVG string rendering.
@Suppress("unused")
enum class StringPreset(
    val gaugesIn: DoubleArray,
    val edgeNutMm: Double,
    val label: String,
) {
    NONE    (doubleArrayOf(),                                           0.0, "No strings"),
    GUITAR_6(doubleArrayOf(0.010, 0.013, 0.017, 0.026, 0.036, 0.046), 3.0, "Guitar (6 strings)"),  // light 10-46
    BASS_4  (doubleArrayOf(0.040, 0.060, 0.080, 0.100),               3.5, "Bass (4 strings)"),    // light 40-100
    BASS_5  (doubleArrayOf(0.040, 0.060, 0.080, 0.100, 0.125),        4.0, "Bass (5 strings)"),    // light 40-125
}
