package com.luthertools.fretcalculator.model

data class InstrumentPreset(
    val name: String,
    val scaleLength: Double,
    val nutWidth: Double,
    val width12thFret: Double,
    val numberOfFrets: Int,
    val radiusValue: Double,
    val stringPreset: StringPreset,
    val bridgeStyle: BridgeStyle,
) {
    companion object {
        val ALL: List<InstrumentPreset> = listOf(
            InstrumentPreset("Classical Guitar (650 mm)",           650.0, 52.0, 60.0, 19, 0.0,   StringPreset.NONE,    BridgeStyle.CLASSICAL),
            InstrumentPreset("Electric Guitar 25.5\" (648 mm)",     648.0, 42.0, 52.0, 22, 184.0, StringPreset.GUITAR_6, BridgeStyle.ELECTRIC),
            InstrumentPreset("Electric Guitar 24.75\" (628 mm)",    628.0, 42.0, 52.0, 22, 305.0, StringPreset.GUITAR_6, BridgeStyle.ELECTRIC),
            InstrumentPreset("Electric Guitar 25\" (635 mm)",       635.0, 42.0, 52.0, 22, 254.0, StringPreset.GUITAR_6, BridgeStyle.ELECTRIC),
            InstrumentPreset("Bass Guitar 34\" (864 mm)",           864.0, 42.0, 55.0, 20, 305.0, StringPreset.BASS_4,   BridgeStyle.ELECTRIC),
            InstrumentPreset("Bass Guitar 30\" (762 mm)",           762.0, 40.0, 53.0, 20, 254.0, StringPreset.BASS_4,   BridgeStyle.ELECTRIC),
            InstrumentPreset("Bass Guitar 5-string 34\" (864 mm)",  864.0, 45.0, 58.0, 20, 305.0, StringPreset.BASS_5,   BridgeStyle.ELECTRIC),
            InstrumentPreset("Ukulele Soprano (345 mm)",            345.0, 35.0, 42.0, 14, 0.0,   StringPreset.NONE,    BridgeStyle.CLASSICAL),
            InstrumentPreset("Mandolin (350 mm)",                   350.0, 34.0, 40.0, 17, 0.0,   StringPreset.NONE,    BridgeStyle.FLOATING),
            InstrumentPreset("Violin (330 mm)",                     330.0, 24.0, 30.0, 0,  0.0,   StringPreset.NONE,    BridgeStyle.FLOATING),
        )
    }
}
