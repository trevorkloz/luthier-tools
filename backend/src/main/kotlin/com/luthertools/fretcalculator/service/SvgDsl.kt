package com.luthertools.fretcalculator.service

import java.util.UUID

@DslMarker
annotation class SvgDsl

// ── Raw path string builders (internal — used by inlay preset callback) ──────

internal fun pocketPathStr(id: String, d: String, cutOffset: String = SHAPER_CUT_OFFSET, toolDia: String = SHAPER_TOOL_DIA): String =
    """  <g id="sg-${UUID.randomUUID()}">
    <path id="$id" d="$d" fill="#7F7F7F" stroke="none" shaper:cutType="pocket" shaper:cutOffset="$cutOffset" shaper:toolDia="$toolDia"/>
  </g>"""

internal fun onlinePathStr(id: String, d: String, cutOffset: String = SHAPER_CUT_OFFSET, toolDia: String = SHAPER_TOOL_DIA): String =
    """  <g id="sg-${UUID.randomUUID()}">
    <path id="$id" d="$d" fill="none" stroke="#7F7F7F" stroke-width="0.1" shaper:cutType="online" shaper:cutOffset="$cutOffset" shaper:toolDia="$toolDia"/>
  </g>"""

// ── Geometry scope — inside pocket { } / online { }, returns the path 'd' ───

@SvgDsl
class CutScope {
    fun rect(x1: Double, y1: Double, x2: Double, y2: Double): String =
        "M ${x1.f4()} ${y1.f4()} L ${x2.f4()} ${y1.f4()} L ${x2.f4()} ${y2.f4()} L ${x1.f4()} ${y2.f4()} Z"

    fun circle(cx: Double, cy: Double, size: Double): String {
        val r = size / 2.0
        return "M ${(cx - r).f4()} ${cy.f4()} A ${r.f4()} ${r.f4()} 0 1 0 ${(cx + r).f4()} ${cy.f4()} A ${r.f4()} ${r.f4()} 0 1 0 ${(cx - r).f4()} ${cy.f4()} Z"
    }

    fun line(x1: Double, y1: Double, x2: Double, y2: Double): String =
        "M ${x1.f4()} ${y1.f4()} L ${x2.f4()} ${y2.f4()}"

    fun path(d: String): String = d
}

// ── Shaper scope — inside shaper { }, emits one <g><path/></g> per call ─────

@SvgDsl
class ShaperScope internal constructor(
    private val out: StringBuilder,
    private val defaultCutOffset: String,
    private val defaultToolDia: String,
) {
    fun pocket(
        id: String,
        cutOffset: String = defaultCutOffset,
        toolDia: String = defaultToolDia,
        block: CutScope.() -> String,
    ) {
        out.appendLine(pocketPathStr(id, CutScope().block(), cutOffset, toolDia))
    }

    fun online(
        id: String,
        cutOffset: String = defaultCutOffset,
        toolDia: String = defaultToolDia,
        block: CutScope.() -> String,
    ) {
        out.appendLine(onlinePathStr(id, CutScope().block(), cutOffset, toolDia))
    }
}

// ── SVG root scope ───────────────────────────────────────────────────────────

@SvgDsl
class SvgScope internal constructor(private val out: StringBuilder) {

    // Groups one or more pocket/online cuts under shared default Shaper attributes.
    // Each pocket { } / online { } call inside emits its own <g><path/></g> element.
    fun shaper(
        cutOffset: String = SHAPER_CUT_OFFSET,
        toolDia: String = SHAPER_TOOL_DIA,
        block: ShaperScope.() -> Unit,
    ) {
        ShaperScope(out, cutOffset, toolDia).block()
    }

    // Escape hatch for pre-built SVG element strings (e.g. inlay preset output)
    internal fun raw(s: String) { out.appendLine(s) }

    fun layer(id: String, block: LayerScope.() -> Unit) {
        out.appendLine("""  <g id="$id" inkscape:groupmode="layer" inkscape:label="locked" pointer-events="none">""")
        LayerScope(out).block()
        out.appendLine("""  </g>""")
    }
}

// ── Guide layer scope ────────────────────────────────────────────────────────

@SvgDsl
class LayerScope internal constructor(private val out: StringBuilder) {

    fun text(
        x: Double, y: Double, content: String, size: Double, color: String,
        anchor: String = "middle", weight: String = "normal", baseline: String = "auto",
    ) {
        out.appendLine("""    <text x="${x.f4()}" y="${y.f4()}" font-size="$size" text-anchor="$anchor" dominant-baseline="$baseline" fill="$color" font-family="sans-serif" font-weight="$weight">$content</text>""")
    }

    fun line(
        x1: Double, y1: Double, x2: Double, y2: Double,
        stroke: String, width: Double, dash: String = "",
    ) {
        val dashAttr = if (dash.isNotEmpty()) """ stroke-dasharray="$dash"""" else ""
        out.appendLine("""    <line x1="${x1.f4()}" y1="${y1.f4()}" x2="${x2.f4()}" y2="${y2.f4()}" stroke="$stroke" stroke-width="$width"$dashAttr/>""")
    }

    fun rect(
        x: Double, y: Double, w: Double, h: Double,
        fill: String = "none", fillOpacity: Double? = null,
        stroke: String, strokeWidth: Double, dash: String = "",
    ) {
        val opacityAttr = if (fillOpacity != null) """ fill-opacity="$fillOpacity"""" else ""
        val dashAttr    = if (dash.isNotEmpty())   """ stroke-dasharray="$dash""""    else ""
        out.appendLine("""    <rect x="${x.f4()}" y="${y.f4()}" width="${w.f4()}" height="${h.f4()}" fill="$fill"$opacityAttr stroke="$stroke" stroke-width="$strokeWidth"$dashAttr/>""")
    }

    fun circle(cx: Double, cy: Double, r: Double, fill: String = "none", stroke: String, strokeWidth: Double) {
        out.appendLine("""    <circle cx="${cx.f4()}" cy="${cy.f4()}" r="${r.f4()}" fill="$fill" stroke="$stroke" stroke-width="$strokeWidth"/>""")
    }

    fun polygon(points: String, fill: String) {
        out.appendLine("""    <polygon points="$points" fill="$fill"/>""")
    }
}

// ── Top-level builder ────────────────────────────────────────────────────────

fun buildSvg(width: Double, height: Double, comment: String, block: SvgScope.() -> Unit): String =
    buildString {
        appendLine("""<?xml version="1.0" encoding="UTF-8"?>""")
        appendLine("<!-- $comment -->")
        appendLine(
            """<svg xmlns="http://www.w3.org/2000/svg" """ +
            """xmlns:shaper="http://www.shapertools.com/namespaces/shaper" """ +
            """xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" """ +
            """width="${width.f4()}mm" height="${height.f4()}mm" """ +
            """viewBox="0 0 ${width.f4()} ${height.f4()}">"""
        )
        SvgScope(this).block()
        append("</svg>")
    }
