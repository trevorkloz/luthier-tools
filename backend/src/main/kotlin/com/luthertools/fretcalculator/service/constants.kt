package com.luthertools.fretcalculator.service

import java.util.Locale

val inlayFrets   = listOf(3, 5, 7, 9, 12, 15, 17, 19, 21, 24)
val doubleFrets  = setOf(12, 24)
val pinholeFrets = listOf(1, 12)

const val SHAPER_CUT_OFFSET = "0in"
const val SHAPER_TOOL_DIA   = "0.125in"

const val SVG_MARGIN_H            = 10.0
const val SVG_MARGIN_TOP          = 14.0
const val SVG_MARGIN_BOT_LAYOUT   = 20.0
const val SVG_MARGIN_BOT_LIGHTING = 10.0
const val SVG_MARGIN_RIGHT_RADIUS = 26.0

const val INLAY_EDGE_PAD_OFFSET    = 1.5
const val LIGHTING_EDGE_PAD_OFFSET = 1.0

const val PINHOLE_RADIUS = 0.5
const val PINHOLE_INDENT = 10.0
const val PINHOLE_ARM    = 5.0

const val LIGHTING_WIRE_GAP   = 1.0
const val LIGHTING_SOLDER_BAY = 5.0

fun Double.f4(): String = String.format(Locale.US, "%.4f", this)
fun Double.f1(): String = String.format(Locale.US, "%.1f", this)
