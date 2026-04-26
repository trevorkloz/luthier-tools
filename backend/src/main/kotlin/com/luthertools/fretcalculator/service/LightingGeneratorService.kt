package com.luthertools.fretcalculator.service

import com.luthertools.fretcalculator.model.FretPosition
import com.luthertools.fretcalculator.model.LightingRequest
import org.springframework.stereotype.Service
import java.util.UUID

@Service
class LightingGeneratorService {

    private data class Wire(val fretNumber: Int, val inlayX: Double, val inlayY: Double)

    fun generateSvg(request: LightingRequest, fretPositions: List<FretPosition>): String {
        val geo        = FretboardGeometry(request.scaleLength, request.nutWidth, request.width12thFret)
        val widthAtEnd = geo.widthAtEnd
        val centerY    = geo.centerY
        fun widthAt(d: Double) = geo.widthAt(d)
        fun yTop(d: Double)    = geo.yTop(d)
        fun yBottom(d: Double) = geo.yBottom(d)

        val x0        = SVG_MARGIN_H
        val xHeel     = x0 + request.scaleLength
        val svgWidth  = xHeel + SVG_MARGIN_H
        val svgHeight = widthAtEnd + SVG_MARGIN_TOP + SVG_MARGIN_BOT_LIGHTING

        val trussHalf = request.trussRodWidth / 2.0

        fun f(v: Double) = v.f4()
        fun uid() = UUID.randomUUID().toString()

        fun pocketPath(id: String, d: String) =
            """  <g id="sg-${uid()}">
    <path id="$id" d="$d" fill="#7F7F7F" stroke="none" shaper:cutType="pocket" shaper:cutOffset="$SHAPER_CUT_OFFSET" shaper:toolDia="$SHAPER_TOOL_DIA"/>
  </g>"""

        fun pocketRect(id: String, x1: Double, y1: Double, x2: Double, y2: Double): String {
            val d = "M ${f(x1)} ${f(y1)} L ${f(x2)} ${f(y1)} L ${f(x2)} ${f(y2)} L ${f(x1)} ${f(y2)} Z"
            return pocketPath(id, d)
        }

        fun pocketCircle(id: String, cx: Double, cy: Double, size: Double): String {
            val r = size / 2.0
            val d = "M ${f(cx - r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)} Z"
            return pocketPath(id, d)
        }

        val edgePad = request.inlaySize / 2.0 + LIGHTING_EDGE_PAD_OFFSET
        val wires = mutableListOf<Wire>()
        if (request.showInlays) {
            for (inlayFret in inlayFrets) {
                val curr = fretPositions.find { it.fretNumber == inlayFret } ?: continue
                val prevDist = fretPositions.find { it.fretNumber == inlayFret - 1 }?.distanceFromNut ?: 0.0
                val midDist  = (prevDist + curr.distanceFromNut) / 2.0
                val inlayX   = x0 + midDist
                val isDouble = request.doubleInlays && inlayFret in doubleFrets

                val yCenters: List<Double> = when (request.inlayPosition) {
                    "top"    -> if (isDouble)
                        listOf(yTop(midDist) + edgePad, yTop(midDist) + edgePad + request.inlayDoubleOffset)
                    else listOf(yTop(midDist) + edgePad)
                    "bottom" -> if (isDouble)
                        listOf(yBottom(midDist) - edgePad - request.inlayDoubleOffset, yBottom(midDist) - edgePad)
                    else listOf(yBottom(midDist) - edgePad)
                    else     -> if (isDouble)   // "center"
                        listOf(centerY - request.inlayDoubleOffset / 2.0, centerY + request.inlayDoubleOffset / 2.0)
                    else listOf(centerY)
                }
                yCenters.forEach { yc -> wires.add(Wire(inlayFret, inlayX, yc)) }
            }
        }

        val halfW = request.channelWidth / 2.0
        val n     = wires.size

        return buildString {
            appendLine("""<?xml version="1.0" encoding="UTF-8"?>""")
            appendLine("""<!-- Fretboard Lighting SVG — underside channel routing -->""")
            appendLine(
                """<svg xmlns="http://www.w3.org/2000/svg" """ +
                """xmlns:shaper="http://www.shapertools.com/namespaces/shaper" """ +
                """xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" """ +
                """width="${f(svgWidth)}mm" height="${f(svgHeight)}mm" """ +
                """viewBox="0 0 ${f(svgWidth)} ${f(svgHeight)}">"""
            )

            // ── Fretboard outline (online cut) ──────────────────────────────────
            val outlineD =
                "M ${f(x0)} ${f(yTop(0.0))} " +
                "L ${f(xHeel)} ${f(yTop(request.scaleLength))} " +
                "L ${f(xHeel)} ${f(yBottom(request.scaleLength))} " +
                "L ${f(x0)} ${f(yBottom(0.0))} Z"
            appendLine(
                """  <g id="sg-${uid()}">
                    <path id="fretboard-outline" d="$outlineD" fill="none" stroke="#7F7F7F" stroke-width="0.1" shaper:cutType="online" shaper:cutOffset="$SHAPER_CUT_OFFSET" shaper:toolDia="$SHAPER_TOOL_DIA"/>
                  </g>"""
            )


            // ── ELECTRICAL MODE — daisy-chain trunk ─────────────────────────
            // Three wires (GND, 5V, DATA) share a single trunk channel along
            // the same side as the inlay markers, outside the truss rod zone.
            // Each LED gets a pocket at the inlay position plus a solder bay.
            val trunkY = if (request.inlayPosition == "top")
                centerY - trussHalf - LIGHTING_WIRE_GAP
            else
                centerY + trussHalf + LIGHTING_WIRE_GAP
            val ledR   = request.ledPocketSize / 2.0

            val firstX = if (wires.isNotEmpty()) wires.minOf { it.inlayX } - halfW else xHeel - 10.0
            appendLine(pocketRect("trunk", firstX, trunkY - halfW, xHeel, trunkY + halfW))

            for (wire in wires) {
                val ix = wire.inlayX
                val iy = wire.inlayY
                appendLine(pocketCircle("led-f${wire.fretNumber}-${iy.toInt()}", ix, iy, request.ledPocketSize))
                val bayX1 = ix + ledR
                val bayHW = ledR + 1.0
                appendLine(pocketRect("solder-f${wire.fretNumber}-${iy.toInt()}", bayX1, iy - bayHW, bayX1 + LIGHTING_SOLDER_BAY, iy + bayHW))
                val stubTop = iy + ledR
                val stubBot = trunkY - halfW
                if (stubBot - stubTop > 0.1) {
                    appendLine(pocketRect("stub-f${wire.fretNumber}-${iy.toInt()}", ix - halfW, stubTop, ix + halfW, stubBot))
                } else if (iy - ledR > trunkY + halfW) {
                    appendLine(pocketRect("stub-f${wire.fretNumber}-${iy.toInt()}", ix - halfW, trunkY + halfW, ix + halfW, iy - ledR))
                }
            }

            appendLine("""  <g id="guides" inkscape:groupmode="layer" inkscape:label="locked" pointer-events="none">""")
            appendLine("""    <text x="${f(svgWidth / 2.0)}" y="5.0" font-size="3.5" text-anchor="middle" fill="#333" font-family="sans-serif" font-weight="bold">Fretboard Lighting — Electrical (addressable chain)</text>""")
            for (wire in wires) {
                appendLine("""    <circle cx="${f(wire.inlayX)}" cy="${f(wire.inlayY)}" r="0.8" fill="none" stroke="#0277bd" stroke-width="0.2"/>""")
            }
            wires.groupBy { it.fretNumber }.forEach { (num, grp) ->
                val lx = grp.first().inlayX
                val ly = grp.minOf { it.inlayY } - 2.0
                appendLine("""    <text x="${f(lx)}" y="${f(ly)}" font-size="2.0" text-anchor="middle" fill="#0277bd" font-family="sans-serif">$num</text>""")
            }
            appendLine("""    <text x="${f((firstX + xHeel) / 2.0)}" y="${f(trunkY + 3.5)}" font-size="2.0" text-anchor="middle" fill="#2e7d32" font-family="sans-serif">GND · 5V · DATA trunk</text>""")
            appendLine("""    <rect x="${f(x0)}" y="${f(centerY - trussHalf)}" width="${f(request.scaleLength)}" height="${f(request.trussRodWidth)}" fill="#ffcc02" fill-opacity="0.12" stroke="#f9a825" stroke-width="0.2" stroke-dasharray="2,2"/>""")
            appendLine("""    <text x="${f(x0 + 5.0)}" y="${f(centerY + 0.7)}" font-size="2.0" dominant-baseline="middle" fill="#f57f17" font-family="sans-serif">truss rod</text>""")
            appendLine("""    <text x="${f(xHeel + 1.5)}" y="${f(trunkY)}" font-size="2.0" dominant-baseline="middle" fill="#e65100" font-family="sans-serif">${n} LEDs</text>""")
            appendLine("""    <line x1="${f(x0)}" y1="${f(centerY)}" x2="${f(xHeel)}" y2="${f(centerY)}" stroke="#aaa" stroke-width="0.2" stroke-dasharray="2,2"/>""")
            appendLine("""  </g>""")

            append("</svg>")
        }
    }
}
