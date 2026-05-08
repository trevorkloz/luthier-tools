package com.luthertools.fretcalculator.model

data class RadiusPreset(val mm: Int, val label: String) {
    companion object {
        val ALL: List<RadiusPreset> = listOf(
            RadiusPreset(0, "Flat (no radius)"),
            RadiusPreset(184, "7.25\" (Vintage Fender)"),
            RadiusPreset(241, "9.5\" (Modern Fender)"),
            RadiusPreset(254, "10\" (PRS-style)"),
            RadiusPreset(305, "12\" (Gibson-style)"),
            RadiusPreset(356, "14\""),
            RadiusPreset(406, "16\" (Ibanez / Warmoth)"),
        )
    }
}
