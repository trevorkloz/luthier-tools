package com.luthertools.fretcalculator.service

import com.luthertools.fretcalculator.model.FretPosition
import com.luthertools.fretcalculator.model.FretRequest
import com.luthertools.fretcalculator.model.InlayPreset
import com.luthertools.fretcalculator.model.InlayShapeCtx
import org.springframework.stereotype.Service
import java.util.Locale
import java.util.UUID
import kotlin.math.sqrt

@Service
class SvgGeneratorService {

    companion object {
        // Add a new InlayPreset subclass above and list it here to make it appear in the UI dropdown.
        val INLAY_PRESETS: List<InlayPreset> = listOf(
            InlayPreset.Circle,
            InlayPreset.Rectangle,
            InlayPreset.Diamond,
        )
    }

    fun generateSvg(request: FretRequest, fretPositions: List<FretPosition>): String {
        val geo        = FretboardGeometry(request.scaleLength, request.nutWidth, request.width12thFret)
        val widthAtEnd = geo.widthAtEnd
        val centerY    = geo.centerY
        fun widthAt(d: Double) = geo.widthAt(d)
        fun yTop(d: Double)    = geo.yTop(d)
        fun yBottom(d: Double) = geo.yBottom(d)

        val ext = request.fretExtensionAmount

        // Dynamic left origin: nut slot may extend before the 0th fret position
        val nutSlotW = if (request.showNutSlot) request.nutSlotWidth else 0.0
        // nutSlotDistance <= 0 so -nutSlotDistance >= 0; the slot's left edge is at x0 - nutSlotW - |nutSlotDistance|
        val x0 = maxOf(SVG_MARGIN_H, nutSlotW - request.nutSlotDistance + 2.0)

        val marginRight = if (request.showRadius && request.radiusValue > 0.0) SVG_MARGIN_RIGHT_RADIUS else SVG_MARGIN_H
        val svgWidth  = x0 + request.scaleLength + marginRight
        val svgHeight = widthAtEnd + SVG_MARGIN_TOP + SVG_MARGIN_BOT_LAYOUT + maxOf(0.0, ext)

        fun f(v: Double)  = v.f4()
        fun f1(v: Double) = v.f1()

        val xHeel = x0 + request.scaleLength

        // ── Shaper Origin helpers ────────────────────────────────────────────────

        fun onlinePath(id: String, d: String): String =
            """  <g id="sg-${UUID.randomUUID()}">
    <path id="$id" d="$d" fill="none" stroke="#7F7F7F" stroke-width="0.1" shaper:cutType="online" shaper:cutOffset="$SHAPER_CUT_OFFSET" shaper:toolDia="$SHAPER_TOOL_DIA"/>
  </g>"""

        fun onlineLine(id: String, x1: Double, y1: Double, x2: Double, y2: Double) =
            onlinePath(id, "M ${f(x1)} ${f(y1)} L ${f(x2)} ${f(y2)}")

        fun pocketPath(id: String, d: String): String =
            """  <g id="sg-${UUID.randomUUID()}">
    <path id="$id" d="$d" fill="#7F7F7F" stroke="none" shaper:cutType="pocket" shaper:cutOffset="$SHAPER_CUT_OFFSET" shaper:toolDia="$SHAPER_TOOL_DIA"/>
  </g>"""


        // ── Width dimension annotation ───────────────────────────────────────────
        // Bracket lines remain inside the fretboard; text is placed ABOVE the top edge.
        fun widthAnnotation(xPos: Double, yT: Double, yB: Double, width: Double, label: String): String {
            val xDim  = xPos + 2.5
            val text  = "$label: ${f1(width)} ${request.unit}"
            val textY = yT - 3.5
            return buildString {
                // Horizontal witness ticks from fretboard edge to dimension line (outside only)
                appendLine("""    <line x1="${f(xPos + 0.3)}" y1="${f(yT)}" x2="${f(xDim + 0.6)}" y2="${f(yT)}" stroke="#555555" stroke-width="0.15"/>""")
                appendLine("""    <line x1="${f(xPos + 0.3)}" y1="${f(yB)}" x2="${f(xDim + 0.6)}" y2="${f(yB)}" stroke="#555555" stroke-width="0.15"/>""")
                // Short shafts outside the fretboard (above top, below bottom)
                appendLine("""    <line x1="${f(xDim)}" y1="${f(yT - 1.8)}" x2="${f(xDim)}" y2="${f(yT - 1.2)}" stroke="#555555" stroke-width="0.15"/>""")
                appendLine("""    <line x1="${f(xDim)}" y1="${f(yB + 1.2)}" x2="${f(xDim)}" y2="${f(yB + 1.8)}" stroke="#555555" stroke-width="0.15"/>""")
                // Arrowheads at fretboard edges pointing inward (top → down, bottom → up)
                appendLine("""    <polygon points="${f(xDim - 0.55)},${f(yT - 1.2)} ${f(xDim + 0.55)},${f(yT - 1.2)} ${f(xDim)},${f(yT)}" fill="#555555"/>""")
                appendLine("""    <polygon points="${f(xDim - 0.55)},${f(yB + 1.2)} ${f(xDim + 0.55)},${f(yB + 1.2)} ${f(xDim)},${f(yB)}" fill="#555555"/>""")
                // Dashed leader from top shaft up to text label
                appendLine("""    <line x1="${f(xDim)}" y1="${f(yT - 1.8)}" x2="${f(xDim)}" y2="${f(textY + 1.5)}" stroke="#555555" stroke-width="0.1" stroke-dasharray="0.8,0.8"/>""")
                append("""    <text x="${f(xDim)}" y="${f(textY)}" font-size="2.3" text-anchor="middle" dominant-baseline="auto" fill="#555555" font-family="sans-serif">$text</text>""")
            }
        }

        // ── Build SVG ────────────────────────────────────────────────────────────
        val hasGuides = request.showCenterLine || request.showFretNumbers || request.showWidthAnnotations ||
                        request.showBoundingBox || request.label.isNotBlank() ||
                        (request.showRadius && request.radiusValue > 0.0) ||
                        request.showPinholes

        return buildString {
            appendLine("""<?xml version="1.0" encoding="UTF-8"?>""")
            appendLine("""<!-- Fretboard SVG — scale ${request.scaleLength} ${request.unit}, ${request.numberOfFrets} frets -->""")
            appendLine("""<!-- shaper:cutType="online" = fret slots/outline. "pocket" = inlay markers. Locked layer = guides (gesperrt). -->""")
            appendLine(
                """<svg xmlns="http://www.w3.org/2000/svg" """ +
                """xmlns:shaper="http://www.shapertools.com/namespaces/shaper" """ +
                """xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" """ +
                """width="${f(svgWidth)}mm" height="${f(svgHeight)}mm" """ +
                """viewBox="0 0 ${f(svgWidth)} ${f(svgHeight)}">"""
            )

            // ── Online cuts: outline, nut, fret slots ───────────────────────────
            val outlineD =
                "M ${f(x0)} ${f(yTop(0.0))} " +
                "L ${f(xHeel)} ${f(yTop(request.scaleLength))} " +
                "L ${f(xHeel)} ${f(yBottom(request.scaleLength))} " +
                "L ${f(x0)} ${f(yBottom(0.0))} Z"
            appendLine(onlinePath("fretboard-outline", outlineD))

            // Nut — nut slot pocket or plain online line.
            // nutSlotDistance <= 0: right edge of slot at x0 + nutSlotDistance, left edge nutSlotWidth further back.
            // If slot does not reach the 0th fret (distance != 0), also draw the nut line at x0.
            if (request.showNutSlot) {
                val nsRight = x0 + request.nutSlotDistance
                val nsLeft  = nsRight - request.nutSlotWidth
                val nsD     = "M ${f(nsLeft)} ${f(yTop(0.0))} L ${f(nsRight)} ${f(yTop(0.0))} " +
                              "L ${f(nsRight)} ${f(yBottom(0.0))} L ${f(nsLeft)} ${f(yBottom(0.0))} Z"
                appendLine(pocketPath("nut-slot", nsD))
                if (request.nutSlotDistance != 0.0) {
                    appendLine(onlineLine("nut", x0, yTop(0.0) - ext, x0, yBottom(0.0) + ext))
                }
            } else {
                appendLine(onlineLine("nut", x0, yTop(0.0) - ext, x0, yBottom(0.0) + ext))
            }

            // Fret slots — always pocket cuts with specified tang width
            val tw = (request.tangWidth) / 2.0
            for (fret in fretPositions) {
                val x   = x0 + fret.distanceFromNut
                val ftD = "M ${f(x - tw)} ${f(yTop(fret.distanceFromNut) - ext)} L ${f(x + tw)} ${f(yTop(fret.distanceFromNut) - ext)} " +
                          "L ${f(x + tw)} ${f(yBottom(fret.distanceFromNut) + ext)} L ${f(x - tw)} ${f(yBottom(fret.distanceFromNut) + ext)} Z"
                appendLine(pocketPath("fret-${fret.fretNumber}", ftD))
            }

            // ── Pocket cuts: inlay markers ───────────────────────────────────────
            if (request.showInlays) {
                // Reference values at the first inlay fret for shrink/grow factor baselines
                val firstInlayFret = inlayFrets.firstOrNull { fn -> fretPositions.any { it.fretNumber == fn } }
                val refSpacing: Double
                val refWidth: Double
                if (firstInlayFret != null) {
                    val c  = fretPositions.first { it.fretNumber == firstInlayFret }
                    val pD = fretPositions.find  { it.fretNumber == firstInlayFret - 1 }?.distanceFromNut ?: 0.0
                    refSpacing = c.distanceFromNut - pD
                    refWidth   = widthAt((pD + c.distanceFromNut) / 2.0)
                } else {
                    refSpacing = 1.0
                    refWidth   = 1.0
                }

                for (inlayFret in inlayFrets) {
                    val curr     = fretPositions.find { it.fretNumber == inlayFret } ?: continue
                    val prevDist = fretPositions.find { it.fretNumber == inlayFret - 1 }?.distanceFromNut ?: 0.0
                    val midDist  = (prevDist + curr.distanceFromNut) / 2.0
                    val xMid     = x0 + midDist

                    val fretSpacing = curr.distanceFromNut - prevDist
                    val scaleW = (1.0 - request.inlayShrinkWidth  + request.inlayShrinkWidth  * (fretSpacing / refSpacing)).coerceIn(0.01, 1.0)
                    val scaleH = (1.0 - request.inlayGrowHeight + request.inlayGrowHeight * (widthAt(midDist) / refWidth)).coerceAtLeast(0.01)
                    val effectiveSize   = request.inlaySize   * scaleW
                    val effectiveHeight = request.inlayHeight * scaleH
                    val edgePad         = effectiveSize / 2.0 + INLAY_EDGE_PAD_OFFSET

                    val preset = INLAY_PRESETS.find { it.id == request.inlayShape } ?: INLAY_PRESETS.first()
                    val ctx = InlayShapeCtx(
                        baseId       = "inlay-$inlayFret",
                        cx           = xMid,
                        midDist      = midDist,
                        effectiveSize   = effectiveSize,
                        effectiveHeight = effectiveHeight,
                        trap         = request.inlayTrapezoid,
                        edgePad      = edgePad,
                        doubleOffset = request.inlayDoubleOffset,
                        isDouble          = request.doubleInlays && inlayFret in doubleFrets,
                        position          = request.inlayPosition,
                        doubleOrientation = request.inlayDoubleOrientation,
                        f            = { v -> f(v) },
                        yTop         = { d -> yTop(d) },
                        yBottom      = { d -> yBottom(d) },
                        centerY      = centerY,
                        pocketPath   = { id, d -> pocketPath(id, d) },
                    )
                    for (element in preset.draw(ctx)) appendLine(element)
                }
            }

            // ── Pocket cuts: alignment pinholes ─────────────────────────────────
            // Two pinholes per fret (top and bottom), each PINHOLE_INDENT mm from the fretboard edge.
            if (request.showPinholes) {
                for (pinFret in pinholeFrets) {
                    val fret = fretPositions.find { it.fretNumber == pinFret } ?: continue
                    val px   = x0 + fret.distanceFromNut
                    val pyT  = yTop(fret.distanceFromNut) + PINHOLE_INDENT
                    val pyB  = yBottom(fret.distanceFromNut) - PINHOLE_INDENT
                    for ((suffix, py) in listOf("top" to pyT, "bot" to pyB)) {
                        val phD = "M ${f(px - PINHOLE_RADIUS)} ${f(py)} " +
                                  "A ${f(PINHOLE_RADIUS)} ${f(PINHOLE_RADIUS)} 0 1 0 ${f(px + PINHOLE_RADIUS)} ${f(py)} " +
                                  "A ${f(PINHOLE_RADIUS)} ${f(PINHOLE_RADIUS)} 0 1 0 ${f(px - PINHOLE_RADIUS)} ${f(py)} Z"
                        appendLine(pocketPath("pinhole-$pinFret-$suffix", phD))
                    }
                }
            }

            // ── Gesperrt / locked layer: guides ─────────────────────────────────
            if (hasGuides) {
                appendLine("""  <g id="guides" inkscape:groupmode="layer" inkscape:label="locked" pointer-events="none">""")

                // Instrument label heading
                if (request.label.isNotBlank()) {
                    val esc = request.label.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    appendLine("""    <text x="${f(svgWidth / 2.0)}" y="5.0" font-size="3.5" text-anchor="middle" dominant-baseline="auto" fill="#333333" font-family="sans-serif" font-weight="bold">$esc</text>""")
                }

                // Centre line
                if (request.showCenterLine) {
                    appendLine(
                        """    <line x1="${f(x0)}" y1="${f(centerY)}" """ +
                        """x2="${f(xHeel)}" y2="${f(centerY)}" """ +
                        """stroke="#aaaaaa" stroke-width="0.2" stroke-dasharray="2,2"/>"""
                    )
                }

                // Fret numbers — placed BELOW the fretboard bottom edge at each fret position
                if (request.showFretNumbers) {
                    for (fret in fretPositions) {
                        val x      = x0 + fret.distanceFromNut
                        val labelY = yBottom(fret.distanceFromNut) + ext + 4.5
                        appendLine(
                            """    <text x="${f(x)}" y="${f(labelY)}" """ +
                            """font-size="2.5" text-anchor="middle" fill="#888888" """ +
                            """font-family="sans-serif">${fret.fretNumber}</text>"""
                        )
                    }
                }

                // Width dimension annotations — text placed ABOVE the fretboard top edge
                if (request.showWidthAnnotations) {
                    appendLine(widthAnnotation(x0, yTop(0.0), yBottom(0.0), request.nutWidth, "Nut"))
                    fretPositions.find { it.fretNumber == 12 }?.let { fret ->
                        val x = x0 + fret.distanceFromNut
                        appendLine(widthAnnotation(x, yTop(fret.distanceFromNut), yBottom(fret.distanceFromNut),
                            request.width12thFret, "Fr.12"))
                    }
                    fretPositions.find { it.fretNumber == 24 }?.let { fret ->
                        val x = x0 + fret.distanceFromNut
                        appendLine(widthAnnotation(x, yTop(fret.distanceFromNut), yBottom(fret.distanceFromNut),
                            widthAt(fret.distanceFromNut), "Fr.24"))
                    }

                    // Scale length horizontal dimension — below the fretboard at the heel end
                    val yLine    = yBottom(request.scaleLength) + ext + 13.0
                    val xMidSvg  = (x0 + xHeel) / 2.0
                    appendLine("""    <line x1="${f(x0)}" y1="${f(yLine - 1.2)}" x2="${f(x0)}" y2="${f(yLine + 1.2)}" stroke="#555555" stroke-width="0.15"/>""")
                    appendLine("""    <line x1="${f(xHeel)}" y1="${f(yLine - 1.2)}" x2="${f(xHeel)}" y2="${f(yLine + 1.2)}" stroke="#555555" stroke-width="0.15"/>""")
                    appendLine("""    <line x1="${f(x0 + 1.5)}" y1="${f(yLine)}" x2="${f(xHeel - 1.5)}" y2="${f(yLine)}" stroke="#555555" stroke-width="0.15"/>""")
                    appendLine("""    <polygon points="${f(x0 + 1.5)},${f(yLine - 0.55)} ${f(x0 + 1.5)},${f(yLine + 0.55)} ${f(x0)},${f(yLine)}" fill="#555555"/>""")
                    appendLine("""    <polygon points="${f(xHeel - 1.5)},${f(yLine - 0.55)} ${f(xHeel - 1.5)},${f(yLine + 0.55)} ${f(xHeel)},${f(yLine)}" fill="#555555"/>""")
                    appendLine("""    <text x="${f(xMidSvg)}" y="${f(yLine - 1.5)}" font-size="2.3" text-anchor="middle" dominant-baseline="auto" fill="#555555" font-family="sans-serif">Scale: ${f1(request.scaleLength)} ${request.unit}</text>""")
                }

                // Bounding box of the fretboard blank rectangle
                if (request.showBoundingBox) {
                    val bbY1 = yTop(request.scaleLength)
                    val bbY2 = yBottom(request.scaleLength)
                    appendLine("""    <rect x="${f(x0)}" y="${f(bbY1)}" width="${f(request.scaleLength)}" height="${f(bbY2 - bbY1)}" fill="none" stroke="#0288d1" stroke-width="0.3" stroke-dasharray="3,2"/>""")
                }

                // Alignment pinhole crosshairs + circles
                if (request.showPinholes) {
                    for (pinFret in pinholeFrets) {
                        val fret = fretPositions.find { it.fretNumber == pinFret } ?: continue
                        val px   = x0 + fret.distanceFromNut
                        val pyT  = yTop(fret.distanceFromNut) + PINHOLE_INDENT
                        val pyB  = yBottom(fret.distanceFromNut) - PINHOLE_INDENT
                        for (py in listOf(pyT, pyB)) {
                            appendLine("""    <line x1="${f(px - PINHOLE_ARM)}" y1="${f(py)}" x2="${f(px + PINHOLE_ARM)}" y2="${f(py)}" stroke="#1565c0" stroke-width="0.2"/>""")
                            appendLine("""    <line x1="${f(px)}" y1="${f(py - PINHOLE_ARM)}" x2="${f(px)}" y2="${f(py + PINHOLE_ARM)}" stroke="#1565c0" stroke-width="0.2"/>""")
                            appendLine("""    <circle cx="${f(px)}" cy="${f(py)}" r="${f(PINHOLE_RADIUS)}" fill="none" stroke="#1565c0" stroke-width="0.15"/>""")
                        }
                    }
                }

                // Radius contour zone lines + depth labels
                if (request.showRadius && request.radiusValue > 0.0) {
                    val R            = request.radiusValue
                    val N            = request.radiusSteps.coerceIn(2, 10)
                    val halfWidthNut  = request.nutWidth  / 2.0
                    val halfWidthHeel = widthAtEnd / 2.0
                    val labelX        = xHeel + 2.0

                    // Interior zone boundary lines (k = 1 .. N-1)
                    for (k in 1 until N) {
                        val frac     = k.toDouble() / N
                        val yNutT    = centerY - frac * halfWidthNut
                        val yHeelT   = centerY - frac * halfWidthHeel
                        val yNutB    = centerY + frac * halfWidthNut
                        val yHeelB   = centerY + frac * halfWidthHeel
                        appendLine("""    <line x1="${f(x0)}" y1="${f(yNutT)}" x2="${f(xHeel)}" y2="${f(yHeelT)}" stroke="#e65100" stroke-width="0.2" stroke-dasharray="2,1.5"/>""")
                        appendLine("""    <line x1="${f(x0)}" y1="${f(yNutB)}" x2="${f(xHeel)}" y2="${f(yHeelB)}" stroke="#e65100" stroke-width="0.2" stroke-dasharray="2,1.5"/>""")
                    }

                    // Section header to the right of the fretboard
                    val inchStr = String.format(Locale.US, "%.2f", R / 25.4)
                    appendLine("""    <text x="${f(labelX)}" y="${f(SVG_MARGIN_TOP)}" font-size="2.1" dominant-baseline="middle" fill="#e65100" font-family="sans-serif" font-weight="bold">R=${f1(R)}mm (${inchStr}")</text>""")

                    // One depth label per zone, positioned at zone midpoint Y (top side, at heel)
                    for (k in 1..N) {
                        val fracOuter = k.toDouble() / N
                        val fracInner = (k - 1).toDouble() / N
                        val yMid      = centerY - ((fracInner + fracOuter) / 2.0) * halfWidthHeel
                        val yEdge     = fracOuter * halfWidthHeel
                        val depth     = R - sqrt(R * R - yEdge * yEdge)
                        val depthStr  = String.format(Locale.US, "%.3f", depth)
                        appendLine("""    <text x="${f(labelX)}" y="${f(yMid)}" font-size="2.0" dominant-baseline="middle" fill="#e65100" font-family="sans-serif">Z$k: ${depthStr}mm</text>""")
                    }
                }

                appendLine("""  </g>""")
            }

            append("</svg>")
        }
    }
}
