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

// ── Shaper cut colors and stroke widths ──────────────────────────────────────
// All four cut types currently render in the same grey so Shaper Origin
// recognises them; give each its own constant for easy independent adjustment.
const val COLOR_CUT_POCKET  = "#23a253"
const val COLOR_CUT_ONLINE  = "#23a253"
const val COLOR_CUT_INSIDE  = "#23a253"
const val COLOR_CUT_OUTSIDE = "#23a253"
const val STROKE_SHAPER_CUT = 0.5       // online / inside / outside path stroke width

// ── Shaper cuts for fretboard radius ─────────────────────────────────────────
const val COLOR_RADIUS   = "#5cb877"
const val OPACITY_RADIUS = 0.15         // per-zone fill-opacity; zones stack → centre darkens

// ── Titles, texts and annotations ────────────────────────────────────────────
const val COLOR_TITLE       = "#333333"
const val COLOR_CENTER_LINE = "#aaaaaa"
const val COLOR_DIM         = "#555555" // dimension ticks, arrows, annotation text
const val COLOR_FRET_NUM    = "#888888" // fret number labels
const val COLOR_BBOX        = "#0288d1" // fretboard blank bounding box
const val COLOR_PINHOLE     = "#1565c0" // alignment pinhole crosshairs

const val COLOR_LIGHT_INLAY        = "#0277bd"
const val COLOR_LIGHT_TRUNK        = "#2e7d32"
const val COLOR_LIGHT_TRUSS_FILL   = "#ffcc02"
const val COLOR_LIGHT_TRUSS_STROKE = "#f9a825"
const val COLOR_LIGHT_TRUSS_TEXT   = "#f57f17"
const val COLOR_LIGHT_ACCENT       = "#e65100" // LED count and emphasis

const val STROKE_DIM        = 0.15      // dimension witness ticks, pinhole guide circles
const val STROKE_DIM_LEADER = 0.10      // dashed leader lines
const val STROKE_GUIDE      = 0.20      // center line, pinhole lines, guide elements
const val STROKE_BBOX       = 0.30      // fretboard blank bounding box
