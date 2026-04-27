package com.luthertools.fretcalculator.service

import com.luthertools.fretcalculator.model.*
import com.luthertools.fretcalculator.model.Unit
import org.springframework.stereotype.Service
import java.util.Locale
import kotlin.math.sqrt

// ── File-private helpers ─────────────────────────────────────────────────────

private fun fretboardOutlineD(
    x0: Double, xHeel: Double, scaleLength: Double,
    yTop: (Double) -> Double, yBottom: (Double) -> Double,
): String =
    "M ${x0.f4()} ${yTop(0.0).f4()} " +
    "L ${xHeel.f4()} ${yTop(scaleLength).f4()} " +
    "L ${xHeel.f4()} ${yBottom(scaleLength).f4()} " +
    "L ${x0.f4()} ${yBottom(0.0).f4()} Z"

// Width dimension annotation: bracket lines inside the fretboard, text above the top edge.
private fun LayerScope.widthAnnotation(xPos: Double, yT: Double, yB: Double, width: Double, label: String, unit: Unit) {
    val xDim    = xPos + 2.5
    val textY   = yT - 3.5
    val content = "$label: ${width.f1()} $unit"
    // Witness ticks from fretboard edge outward
    line(xPos + 0.3, yT, xDim + 0.6, yT, "#555555", 0.15)
    line(xPos + 0.3, yB, xDim + 0.6, yB, "#555555", 0.15)
    // Short dimension line shafts
    line(xDim, yT - 1.8, xDim, yT - 1.2, "#555555", 0.15)
    line(xDim, yB + 1.2, xDim, yB + 1.8, "#555555", 0.15)
    // Arrowheads pointing inward at fretboard edges
    polygon("${(xDim - 0.55).f4()},${(yT - 1.2).f4()} ${(xDim + 0.55).f4()},${(yT - 1.2).f4()} ${xDim.f4()},${yT.f4()}", "#555555")
    polygon("${(xDim - 0.55).f4()},${(yB + 1.2).f4()} ${(xDim + 0.55).f4()},${(yB + 1.2).f4()} ${xDim.f4()},${yB.f4()}", "#555555")
    // Dashed leader up to text
    line(xDim, yT - 1.8, xDim, textY + 1.5, "#555555", 0.1, "0.8,0.8")
    text(xDim, textY, content, 2.3, "#555555")
}

// ── Service ──────────────────────────────────────────────────────────────────

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

    private data class Wire(val fretNumber: Int, val inlayX: Double, val inlayY: Double)

    // ── Public: fretboard layout SVG ─────────────────────────────────────────

    fun generateSvg(request: FretRequest, fretPositions: List<FretPosition>): String {
        val geo        = FretboardGeometry(request.scaleLength, request.nutWidth, request.width12thFret)
        val widthAtEnd = geo.widthAtEnd
        val centerY    = geo.centerY
        fun widthAt(d: Double) = geo.widthAt(d)
        fun yTop(d: Double)    = geo.yTop(d)
        fun yBottom(d: Double) = geo.yBottom(d)

        val ext      = request.fretExtensionAmount
        val nutSlotW = if (request.showNutSlot) request.nutSlotWidth else 0.0
        // Dynamic left origin: nut slot may extend before the 0th fret position.
        // nutSlotDistance <= 0 so -nutSlotDistance >= 0; slot left edge is at x0 - nutSlotW - |nutSlotDistance|
        val x0 = maxOf(SVG_MARGIN_H, nutSlotW - request.nutSlotDistance + 2.0)

        val marginRight = if (request.showRadius && request.radiusValue > 0.0) SVG_MARGIN_RIGHT_RADIUS else SVG_MARGIN_H
        val svgWidth  = x0 + request.scaleLength + marginRight
        val svgHeight = widthAtEnd + SVG_MARGIN_TOP + SVG_MARGIN_BOT_LAYOUT + maxOf(0.0, ext)
        val xHeel     = x0 + request.scaleLength

        val hasGuides = request.showCenterLine || request.showFretNumbers || request.showWidthAnnotations ||
                        request.showBoundingBox || request.label.isNotBlank() ||
                        (request.showRadius && request.radiusValue > 0.0) || request.showPinholes

        val pocketFn: (String, String) -> String = { id, d -> pocketPathStr(id, d) }

        return buildSvg(svgWidth, svgHeight,
            "Fretboard SVG — scale ${request.scaleLength} ${request.unit}, ${request.numberOfFrets} frets") {

            raw("""<!-- shaper:cutType="online" = fret slots/outline. "pocket" = inlay markers. Locked layer = guides (gesperrt). -->""")

            // ── Online cuts: fretboard outline ───────────────────────────────
            shaper {
                online("fretboard-outline") {
                    path(fretboardOutlineD(x0, xHeel, request.scaleLength, { d -> yTop(d) }, { d -> yBottom(d) }))
                }
            }

            // ── Nut: pocket or online line ───────────────────────────────────
            // nutSlotDistance <= 0: right edge of slot at x0 + nutSlotDistance, left edge nutSlotWidth further back.
            // If slot does not reach the 0th fret (distance != 0), also draw the nut line at x0.
            if (request.showNutSlot) {
                val nsRight = x0 + request.nutSlotDistance
                val nsLeft  = nsRight - request.nutSlotWidth
                shaper {
                    pocket("nut-slot") { rect(nsLeft, yTop(0.0), nsRight, yBottom(0.0)) }
                }
                if (request.nutSlotDistance != 0.0) shaper {
                    online("nut") { line(x0, yTop(0.0) - ext, x0, yBottom(0.0) + ext) }
                }
            } else {
                shaper {
                    online("nut") { line(x0, yTop(0.0) - ext, x0, yBottom(0.0) + ext) }
                }
            }

            // ── Fret slots: pocket cuts with specified tang width ────────────
            val tw = request.tangWidth / 2.0
            shaper {
                for (fret in fretPositions) {
                    val x = x0 + fret.distanceFromNut
                    pocket("fret-${fret.fretNumber}") {
                        rect(x - tw, yTop(fret.distanceFromNut) - ext, x + tw, yBottom(fret.distanceFromNut) + ext)
                    }
                }
            }

            // ── Inlay markers ────────────────────────────────────────────────
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

                    val fretSpacing = curr.distanceFromNut - prevDist
                    val scaleW = (1.0 - request.inlayShrinkWidth  + request.inlayShrinkWidth  * (fretSpacing / refSpacing)).coerceIn(0.01, 1.0)
                    val scaleH = (1.0 - request.inlayGrowHeight + request.inlayGrowHeight * (widthAt(midDist) / refWidth)).coerceAtLeast(0.01)
                    val effectiveSize   = request.inlaySize   * scaleW
                    val effectiveHeight = request.inlayHeight * scaleH
                    val effectiveInlayDoubleOffset = request.inlayDoubleOffset * scaleW

                    val preset = INLAY_PRESETS.find { it.id.toValue() == request.inlayShape } ?: INLAY_PRESETS.first()
                    val ctx = InlayShapeCtx(
                        baseId            = "inlay-$inlayFret",
                        cx                = x0 + midDist,
                        midDist           = midDist,
                        effectiveSize     = effectiveSize,
                        effectiveHeight   = effectiveHeight,
                        trap              = request.inlayTrapezoid,
                        edgePad           = effectiveSize / 2.0 + INLAY_EDGE_PAD_OFFSET,
                        effectiveInlayDoubleOffset      = effectiveInlayDoubleOffset,
                        isDouble          = request.doubleInlays && inlayFret in doubleFrets,
                        position          =  InlayPosition.fromValue(request.inlayPosition),
                        doubleOrientation = request.inlayDoubleOrientation,
                        f                 = { v -> v.f4() },
                        yTop              = { d -> yTop(d) },
                        yBottom           = { d -> yBottom(d) },
                        centerY           = centerY,
                        pocketPath        = pocketFn,
                    )
                    for (element in preset.draw(ctx)) raw(element)
                }
            }

            // ── Alignment pinholes: 1 mm pocket circles ──────────────────────
            // Two pinholes per fret (top and bottom), each PINHOLE_INDENT mm from the fretboard edge.
            if (request.showPinholes) {
                shaper {
                    for (pinFret in pinholeFrets) {
                        val fret = fretPositions.find { it.fretNumber == pinFret } ?: continue
                        val px   = x0 + fret.distanceFromNut
                        pocket("pinhole-$pinFret-top") { circle(px, yTop(fret.distanceFromNut)    + PINHOLE_INDENT, PINHOLE_RADIUS * 2) }
                        pocket("pinhole-$pinFret-bot") { circle(px, yBottom(fret.distanceFromNut) - PINHOLE_INDENT, PINHOLE_RADIUS * 2) }
                    }
                }
            }

            // ── Locked layer: guides ─────────────────────────────────────────
            if (hasGuides) layer("guides") {
                if (request.label.isNotBlank()) {
                    val esc = request.label.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    text(svgWidth / 2.0, 5.0, esc, 3.5, "#333333", weight = "bold")
                }

                if (request.showCenterLine)
                    line(x0, centerY, xHeel, centerY, "#aaaaaa", 0.2, "2,2")

                // Fret numbers — placed BELOW the fretboard bottom edge
                if (request.showFretNumbers)
                    for (fret in fretPositions)
                        text(x0 + fret.distanceFromNut, yBottom(fret.distanceFromNut) + ext + 4.5,
                            fret.fretNumber.toString(), 2.5, "#888888")

                // Width dimension annotations — text placed ABOVE the fretboard top edge
                if (request.showWidthAnnotations) {
                    widthAnnotation(x0, yTop(0.0), yBottom(0.0), request.nutWidth, "Nut", request.unit)
                    fretPositions.find { it.fretNumber == 12 }?.let { fret ->
                        val x = x0 + fret.distanceFromNut
                        widthAnnotation(x, yTop(fret.distanceFromNut), yBottom(fret.distanceFromNut),
                            request.width12thFret, "Fr.12", request.unit)
                    }
                    fretPositions.find { it.fretNumber == 24 }?.let { fret ->
                        val x = x0 + fret.distanceFromNut
                        widthAnnotation(x, yTop(fret.distanceFromNut), yBottom(fret.distanceFromNut),
                            widthAt(fret.distanceFromNut), "Fr.24", request.unit)
                    }
                    // Scale length horizontal dimension — below the fretboard at the heel end
                    val yLine   = yBottom(request.scaleLength) + ext + 13.0
                    val xMidSvg = (x0 + xHeel) / 2.0
                    line(x0,    yLine - 1.2, x0,    yLine + 1.2, "#555555", 0.15)
                    line(xHeel, yLine - 1.2, xHeel, yLine + 1.2, "#555555", 0.15)
                    line(x0 + 1.5, yLine, xHeel - 1.5, yLine, "#555555", 0.15)
                    polygon("${(x0 + 1.5).f4()},${(yLine - 0.55).f4()} ${(x0 + 1.5).f4()},${(yLine + 0.55).f4()} ${x0.f4()},${yLine.f4()}", "#555555")
                    polygon("${(xHeel - 1.5).f4()},${(yLine - 0.55).f4()} ${(xHeel - 1.5).f4()},${(yLine + 0.55).f4()} ${xHeel.f4()},${yLine.f4()}", "#555555")
                    text(xMidSvg, yLine - 1.5, "Scale: ${request.scaleLength.f1()} ${request.unit}", 2.3, "#555555")
                }

                // Bounding box of the fretboard blank rectangle
                if (request.showBoundingBox) {
                    val bbY1 = yTop(request.scaleLength)
                    val bbY2 = yBottom(request.scaleLength)
                    rect(x0, bbY1, request.scaleLength, bbY2 - bbY1, stroke = "#0288d1", strokeWidth = 0.3, dash = "3,2")
                }

                // Pinhole crosshairs + reference circles
                if (request.showPinholes)
                    for (pinFret in pinholeFrets) {
                        val fret = fretPositions.find { it.fretNumber == pinFret } ?: continue
                        val px   = x0 + fret.distanceFromNut
                        for (py in listOf(
                            yTop(fret.distanceFromNut)    + PINHOLE_INDENT,
                            yBottom(fret.distanceFromNut) - PINHOLE_INDENT,
                        )) {
                            line(px - PINHOLE_ARM, py, px + PINHOLE_ARM, py, "#1565c0", 0.2)
                            line(px, py - PINHOLE_ARM, px, py + PINHOLE_ARM, "#1565c0", 0.2)
                            circle(px, py, PINHOLE_RADIUS, stroke = "#1565c0", strokeWidth = 0.15)
                        }
                    }

                // Radius contour zone lines + depth labels
                if (request.showRadius && request.radiusValue > 0.0) {
                    val R             = request.radiusValue
                    val N             = request.radiusSteps.coerceIn(2, 10)
                    val halfWidthNut  = request.nutWidth / 2.0
                    val halfWidthHeel = widthAtEnd / 2.0
                    val labelX        = xHeel + 2.0

                    // Interior zone boundary lines (k = 1 .. N-1)
                    for (k in 1 until N) {
                        val frac = k.toDouble() / N
                        line(x0, centerY - frac * halfWidthNut,  xHeel, centerY - frac * halfWidthHeel, "#e65100", 0.2, "2,1.5")
                        line(x0, centerY + frac * halfWidthNut,  xHeel, centerY + frac * halfWidthHeel, "#e65100", 0.2, "2,1.5")
                    }

                    val inchStr = String.format(Locale.US, "%.2f", R / 25.4)
                    text(labelX, SVG_MARGIN_TOP, "R=${R.f1()}mm (${inchStr}\")", 2.1, "#e65100",
                        anchor = "start", weight = "bold", baseline = "middle")

                    // One depth label per zone, positioned at zone midpoint Y (top side, at heel)
                    for (k in 1..N) {
                        val fracOuter = k.toDouble() / N
                        val fracInner = (k - 1).toDouble() / N
                        val yMid  = centerY - ((fracInner + fracOuter) / 2.0) * halfWidthHeel
                        val yEdge = fracOuter * halfWidthHeel
                        val depth = R - sqrt(R * R - yEdge * yEdge)
                        text(labelX, yMid, "Z$k: ${String.format(Locale.US, "%.3f", depth)}mm", 2.0, "#e65100",
                            anchor = "start", baseline = "middle")
                    }
                }
            }
        }
    }

    // ── Public: fretboard lighting SVG ───────────────────────────────────────

    fun generateLightingSvg(request: LightingRequest, fretPositions: List<FretPosition>): String {
        val geo        = FretboardGeometry(request.scaleLength, request.nutWidth, request.width12thFret)
        val widthAtEnd = geo.widthAtEnd
        val centerY    = geo.centerY
        fun yTop(d: Double)    = geo.yTop(d)
        fun yBottom(d: Double) = geo.yBottom(d)

        val x0        = SVG_MARGIN_H
        val xHeel     = x0 + request.scaleLength
        val svgWidth  = xHeel + SVG_MARGIN_H
        val svgHeight = widthAtEnd + SVG_MARGIN_TOP + SVG_MARGIN_BOT_LIGHTING

        val trussHalf = request.trussRodWidth / 2.0
        val halfW     = request.channelWidth / 2.0
        val edgePad   = request.inlaySize / 2.0 + LIGHTING_EDGE_PAD_OFFSET

        val wires = mutableListOf<Wire>()
        if (request.showInlays) {
            for (inlayFret in inlayFrets) {
                val curr     = fretPositions.find { it.fretNumber == inlayFret } ?: continue
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

        val n      = wires.size
        val trunkY = if (request.inlayPosition == "top")
            centerY - trussHalf - LIGHTING_WIRE_GAP
        else
            centerY + trussHalf + LIGHTING_WIRE_GAP
        val ledR   = request.ledPocketSize / 2.0
        val firstX = if (wires.isNotEmpty()) wires.minOf { it.inlayX } - halfW else xHeel - 10.0

        return buildSvg(svgWidth, svgHeight, "Fretboard Lighting SVG — underside channel routing") {

            // ── Online cut: fretboard outline ────────────────────────────────
            shaper {
                online("fretboard-outline") {
                    path(fretboardOutlineD(x0, xHeel, request.scaleLength, { d -> yTop(d) }, { d -> yBottom(d) }))
                }
            }

            // ── Pocket cuts: trunk channel ───────────────────────────────────
            // Three wires (GND, 5V, DATA) share a single trunk channel along
            // the same side as the inlay markers, outside the truss rod zone.
            shaper {
                pocket("trunk") { rect(firstX, trunkY - halfW, xHeel, trunkY + halfW) }
            }

            // ── Pocket cuts: LED pockets, solder bays, stub channels ─────────
            shaper {
                for (wire in wires) {
                    val ix = wire.inlayX
                    val iy = wire.inlayY
                    pocket("led-f${wire.fretNumber}-${iy.toInt()}")    { circle(ix, iy, request.ledPocketSize) }
                    pocket("solder-f${wire.fretNumber}-${iy.toInt()}") { rect(ix + ledR, iy - ledR - 1.0, ix + ledR + LIGHTING_SOLDER_BAY, iy + ledR + 1.0) }
                    val stubTop = iy + ledR
                    val stubBot = trunkY - halfW
                    if (stubBot - stubTop > 0.1)
                        pocket("stub-f${wire.fretNumber}-${iy.toInt()}") { rect(ix - halfW, stubTop, ix + halfW, stubBot) }
                    else if (iy - ledR > trunkY + halfW)
                        pocket("stub-f${wire.fretNumber}-${iy.toInt()}") { rect(ix - halfW, trunkY + halfW, ix + halfW, iy - ledR) }
                }
            }

            // ── Locked layer: guides ─────────────────────────────────────────
            layer("guides") {
                text(svgWidth / 2.0, 5.0, "Fretboard Lighting — Electrical (addressable chain)", 3.5, "#333")

                for (wire in wires)
                    circle(wire.inlayX, wire.inlayY, 0.8, stroke = "#0277bd", strokeWidth = 0.2)

                wires.groupBy { it.fretNumber }.forEach { (num, grp) ->
                    text(grp.first().inlayX, grp.minOf { it.inlayY } - 2.0, num.toString(), 2.0, "#0277bd")
                }

                text((firstX + xHeel) / 2.0, trunkY + 3.5, "GND · 5V · DATA trunk", 2.0, "#2e7d32")
                rect(x0, centerY - trussHalf, request.scaleLength, request.trussRodWidth,
                    fill = "#ffcc02", fillOpacity = 0.12, stroke = "#f9a825", strokeWidth = 0.2, dash = "2,2")
                text(x0 + 5.0, centerY + 0.7, "truss rod", 2.0, "#f57f17", anchor = "start", baseline = "middle")
                text(xHeel + 1.5, trunkY, "$n LEDs", 2.0, "#e65100", anchor = "start", baseline = "middle")
                line(x0, centerY, xHeel, centerY, "#aaa", 0.2, "2,2")
            }
        }
    }
}
