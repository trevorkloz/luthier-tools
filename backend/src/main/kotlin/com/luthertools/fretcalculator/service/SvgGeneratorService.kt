package com.luthertools.fretcalculator.service

import com.luthertools.fretcalculator.model.*
import com.luthertools.fretcalculator.model.Unit
import org.springframework.stereotype.Service
import java.util.Locale
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.pow
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
    val xDim = xPos + 2.5
    val textY = yT - 3.5
    val content = "$label ${width.f1()} $unit"
    line(xPos + 0.3, yT, xDim + 0.6, yT, COLOR_DIM, STROKE_DIM)
    line(xPos + 0.3, yB, xDim + 0.6, yB, COLOR_DIM, STROKE_DIM)
    line(xDim, yT - 1.8, xDim, yT - 1.2, COLOR_DIM, STROKE_DIM)
    line(xDim, yB + 1.2, xDim, yB + 1.8, COLOR_DIM, STROKE_DIM)
    polygon(
        "${(xDim - 0.55).f4()},${(yT - 1.2).f4()} ${(xDim + 0.55).f4()},${(yT - 1.2).f4()} ${xDim.f4()},${yT.f4()}",
        COLOR_DIM
    )
    polygon(
        "${(xDim - 0.55).f4()},${(yB + 1.2).f4()} ${(xDim + 0.55).f4()},${(yB + 1.2).f4()} ${xDim.f4()},${yB.f4()}",
        COLOR_DIM
    )
    line(xDim, yT - 1.8, xDim, textY + 1.5, COLOR_DIM, STROKE_DIM_LEADER, "0.8,0.8")
    text(xDim, textY, content, 2.3, COLOR_DIM)
}

// ── Service ──────────────────────────────────────────────────────────────────

@Service
class SvgGeneratorService {

    companion object {
        val INLAY_PRESETS: List<InlayPreset> = listOf(
            InlayPreset.Circle,
            InlayPreset.Rectangle,
            InlayPreset.Diamond,
            InlayPreset.Custom,
        )
    }

    private data class Wire(val fretNumber: Int, val inlayX: Double, val inlayY: Double)

    // ── Public: fretboard layout SVG ─────────────────────────────────────────

    fun generateSvg(request: FretRequest, fretPositions: List<FretPosition>): String {
        val isMultiscale = request.multiscale

        // Center scale drives the y-taper model (nut width → 12th fret width).
        val centerScale = if (isMultiscale)
            (request.trebleScaleLength + request.bassScaleLength) / 2.0
        else request.scaleLength

        val geo = FretboardGeometry(centerScale, request.nutWidth, request.width12thFret)
        val widthAtEnd = geo.widthAtEnd
        val centerY = geo.centerY
        fun widthAt(d: Double) = geo.widthAt(d)
        fun yTop(d: Double) = geo.yTop(d)
        fun yBottom(d: Double) = geo.yBottom(d)

        val ext = request.fretExtensionAmount
        val nutSlotW = if (request.showNutSlot) request.nutSlotWidth else 0.0
        // Dynamic left origin: nut slot may extend before the 0th fret position.
        val x0 = maxOf(SVG_MARGIN_H, nutSlotW - request.nutSlotDistance + 2.0)

        // ── Fan fret (multiscale) geometry ────────────────────────────────────
        // x_perp: x-coordinate shared by all strings at the perpendicular fret.
        // Anchored so that the bass-side nut lands exactly at x0.
        val perpendicularFret = request.perpendicularFret
        val trebleScaleLength = request.trebleScaleLength
        val bassScaleLength = request.bassScaleLength
        val perpFactor = 2.0.pow(-perpendicularFret.toDouble() / 12.0)
        val xPerp = if (isMultiscale) x0 + bassScaleLength * (1.0 - perpFactor) else x0

        val xNutTreble = if (isMultiscale) xPerp + trebleScaleLength * (perpFactor - 1.0) else x0
        val xNutBass = x0  // bass nut always at x0 in multiscale; equals x0 in single-scale
        val xBridgeTreble = if (isMultiscale) xPerp + trebleScaleLength * perpFactor else x0 + request.scaleLength
        val xBridgeBass = if (isMultiscale) xPerp + bassScaleLength * perpFactor else x0 + request.scaleLength

        fun xFretTreble(fret: FretPosition) =
            if (isMultiscale) xPerp + (fret.xOffsetTreble ?: 0.0) else x0 + fret.distanceFromNut

        fun xFretBass(fret: FretPosition) =
            if (isMultiscale) xPerp + (fret.xOffsetBass ?: 0.0) else x0 + fret.distanceFromNut

        fun xFretCenter(fret: FretPosition) =
            if (isMultiscale) (xFretTreble(fret) + xFretBass(fret)) / 2.0 else x0 + fret.distanceFromNut

        val effectiveScale = if (isMultiscale) bassScaleLength else request.scaleLength
        // Always reserve right-margin space for multiscale annotations
        val marginRight = when {
            isMultiscale || (request.showRadius && request.radiusValue > 0.0) -> SVG_MARGIN_RIGHT_RADIUS
            else -> SVG_MARGIN_H
        }
        val svgWidth = x0 + effectiveScale + marginRight
        val svgHeight = widthAtEnd + SVG_MARGIN_TOP + SVG_MARGIN_BOT_LAYOUT + maxOf(0.0, ext)
        val xHeel = x0 + effectiveScale

        val hasGuides = request.showCenterLine || request.showFretNumbers || request.showWidthAnnotations ||
                request.showBoundingBox || request.label.isNotBlank() ||
                (request.showRadius && request.radiusValue > 0.0) || request.showPinholes || isMultiscale ||
                request.stringPreset.gaugesIn.isNotEmpty()

        val cutFn: (String, String) -> String = { id, d ->
            pathStr(
                id,
                d,
                cutOffset = SHAPER_CUT_OFFSET,
                cutType = "inside",
                strokeColor = COLOR_CUT_INSIDE
            )
        }
        val cutFnOnline: (String, String) -> String =
            { id, d -> pathStr(id, d, cutType = "online", strokeColor = COLOR_CUT_ONLINE) }

        val outlinePathD = if (isMultiscale)
            "M ${xNutTreble.f4()} ${yTop(0.0).f4()} " +
                    "L ${xBridgeTreble.f4()} ${yTop(centerScale).f4()} " +
                    "L ${xBridgeBass.f4()} ${yBottom(centerScale).f4()} " +
                    "L ${xNutBass.f4()} ${yBottom(0.0).f4()} Z"
        else
            fretboardOutlineD(x0, xHeel, request.scaleLength, { d -> yTop(d) }, { d -> yBottom(d) })

        val svgTitle = if (isMultiscale)
            "Fretboard SVG — ${trebleScaleLength.f1()}/${bassScaleLength.f1()} ${request.unit}, ${request.numberOfFrets} frets, perp fret $perpendicularFret"
        else
            "Fretboard SVG — scale ${request.scaleLength} ${request.unit}, ${request.numberOfFrets} frets"

        return buildSvg(svgWidth, svgHeight, svgTitle) {

            raw("""<!-- outside = fretboard outline, inside = inlay/nut cuts, online = fret slots. Locked layer = guides. -->""")

            // ── Outside cut: fretboard outline ───────────────────────────────
            shaper {
                outside("fretboard-outline") {
                    path(outlinePathD)
                }
            }

            // ── Nut: inside cut or online line ───────────────────────────────
            if (isMultiscale) {
                if (request.showNutSlot) {
                    // Angled nut slot: parallelogram centred on the nut line
                    val nx1 = xNutTreble;
                    val ny1 = yTop(0.0)
                    val nx2 = xNutBass;
                    val ny2 = yBottom(0.0)
                    val slotLen = sqrt((nx2 - nx1) * (nx2 - nx1) + (ny2 - ny1) * (ny2 - ny1))
                    val sDirX = (nx2 - nx1) / slotLen;
                    val sDirY = (ny2 - ny1) / slotLen
                    val pDirX = -sDirY;
                    val pDirY = sDirX
                    val hw = request.nutSlotWidth / 2.0
                    val slotD =
                        "M ${(nx1 - pDirX * hw).f4()} ${(ny1 - pDirY * hw).f4()} " +
                                "L ${(nx1 + pDirX * hw).f4()} ${(ny1 + pDirY * hw).f4()} " +
                                "L ${(nx2 + pDirX * hw).f4()} ${(ny2 + pDirY * hw).f4()} " +
                                "L ${(nx2 - pDirX * hw).f4()} ${(ny2 - pDirY * hw).f4()} Z"
                    shaper { pocket("nut-slot") { path(slotD) } }
                } else {
                    shaper {
                        online("fret-0") {
                            line(xNutTreble, yTop(0.0) - ext, xNutBass, yBottom(0.0) + ext)
                        }
                    }
                }
            } else {
                // nutSlotDistance <= 0: right edge of slot at x0 + nutSlotDistance, left edge nutSlotWidth further back.
                // If slot does not reach the 0th fret (distance != 0), also draw the nut line at x0.
                if (request.showNutSlot) {
                    val nsRight = x0 + request.nutSlotDistance
                    val nsLeft = nsRight - request.nutSlotWidth
                    shaper {
                        pocket("nut-slot") {
                            rect(nsLeft, yTop(0.0), nsRight, yBottom(0.0))
                        }
                    }
                    if (request.nutSlotDistance != 0.0) shaper {
                        online("fret-0") {
                            line(x0, yTop(0.0) - ext, x0, yBottom(0.0) + ext)
                        }
                    }
                } else {
                    shaper {
                        online("fret-0") {
                            line(x0, yTop(0.0) - ext, x0, yBottom(0.0) + ext)
                        }
                    }
                }
            }

            // ── Fret slots: online cuts (tool diameter determines slot width) ──
            shaper {
                for (fret in fretPositions) {
                    val xt = xFretTreble(fret)
                    val xb = xFretBass(fret)
                    val yt = yTop(fret.distanceFromNut)
                    val yb = yBottom(fret.distanceFromNut)
                    if (isMultiscale && ext > 0.0) {
                        // Extend along the fret angle direction rather than purely vertically
                        val dx = xb - xt;
                        val dy = yb - yt
                        val len = sqrt(dx * dx + dy * dy).coerceAtLeast(0.001)
                        val ex = ext * dx / len;
                        val ey = ext * dy / len
                        online("fret-${fret.fretNumber}") { line(xt - ex, yt - ey, xb + ex, yb + ey) }
                    } else {
                        online("fret-${fret.fretNumber}") { line(xt, yt - ext, xb, yb + ext) }
                    }
                }
            }

            // ── Inlay markers ────────────────────────────────────────────────
            if (request.showInlays) group("layer-inlays") {
                val firstInlayFret = inlayFrets.firstOrNull { fn -> fretPositions.any { it.fretNumber == fn } }
                val refSpacing: Double
                val refWidth: Double
                if (firstInlayFret != null) {
                    val c = fretPositions.first { it.fretNumber == firstInlayFret }
                    val pD = fretPositions.find { it.fretNumber == firstInlayFret - 1 }?.distanceFromNut ?: 0.0
                    refSpacing = c.distanceFromNut - pD
                    refWidth = widthAt((pD + c.distanceFromNut) / 2.0)
                } else {
                    refSpacing = 1.0
                    refWidth = 1.0
                }

                for (inlayFret in inlayFrets) {
                    val curr = fretPositions.find { it.fretNumber == inlayFret } ?: continue
                    val prevFret = fretPositions.find { it.fretNumber == inlayFret - 1 }
                    val prevDist = prevFret?.distanceFromNut ?: 0.0
                    val midDist = (prevDist + curr.distanceFromNut) / 2.0

                    // cx: midpoint along the center string between the two bordering fret lines
                    val prevCenterX = when {
                        isMultiscale && prevFret != null -> (xFretTreble(prevFret) + xFretBass(prevFret)) / 2.0
                        isMultiscale -> (xNutTreble + xNutBass) / 2.0
                        else -> x0 + prevDist
                    }
                    val inlayCx = (prevCenterX + xFretCenter(curr)) / 2.0

                    val fretSpacing = curr.distanceFromNut - prevDist
                    val scaleW =
                        (1.0 - request.inlayShrinkWidth + request.inlayShrinkWidth * (fretSpacing / refSpacing)).coerceAtLeast(
                            0.01
                        )
                    val scaleH =
                        (1.0 - request.inlayGrowHeight + request.inlayGrowHeight * (widthAt(midDist) / refWidth)).coerceAtLeast(
                            0.01
                        )
                    val scale1224W = if (inlayFret in doubleFrets) (1.0 - request.inlayShrinkWidth1224) else 1.0
                    val scale1224H = if (inlayFret in doubleFrets) (1.0 - request.inlayShrinkHeight1224) else 1.0
                    val effectiveSize = request.inlaySize * scaleW * scale1224W
                    val effectiveHeight = request.inlayHeight * scaleH * scale1224H
                    val effDoubleV = request.inlayDoubleOffsetV
                    val effDoubleH =
                        if (request.inlayDoubleOrientation == InlayDoubleOrientation.HORIZONTAL)
                            request.inlayDoubleOffsetH * scaleW
                        else
                            request.inlayDoubleOffsetH

                    val preset = INLAY_PRESETS.find { it.id == request.inlayShape } ?: INLAY_PRESETS.first()
                    val ctx = InlayShapeCtx(
                        baseId = "inlay-$inlayFret",
                        cx = inlayCx,
                        midDist = midDist,
                        effectiveSize = effectiveSize,
                        effectiveHeight = effectiveHeight,
                        trap = request.inlayTrapezoid,
                        parallelogram = request.inlayParallelogram,
                        edgePad = effectiveSize / 2.0 + request.inlayEdgeMargin,
                        effectiveInlayDoubleOffsetV = effDoubleV,
                        effectiveInlayDoubleOffsetH = effDoubleH,
                        isDouble = request.doubleInlays && inlayFret in doubleFrets,
                        position = request.inlayPosition,
                        doubleOrientation = request.inlayDoubleOrientation,
                        f = { v -> v.f4() },
                        yTop = { d -> yTop(d) },
                        yBottom = { d -> yBottom(d) },
                        centerY = centerY,
                        cutPath = cutFn,
                        cutPathOnline = cutFnOnline,
                        fretNumber = inlayFret,
                        customPath = request.inlayCustomPath,
                        customPathClosed = request.inlayCustomClosed,
                    )
                    if (isMultiscale) {
                        // Shear each inlay to match the local fan-fret angle.
                        val prevXTreble = prevFret?.let { xFretTreble(it) } ?: xNutTreble
                        val prevXBass = prevFret?.let { xFretBass(it) } ?: xNutBass
                        val midXTreble = (prevXTreble + xFretTreble(curr)) / 2.0
                        val midXBass = (prevXBass + xFretBass(curr)) / 2.0
                        val shear = (midXBass - midXTreble) / widthAt(midDist)
                        val skewDeg = String.format(Locale.US, "%.2f", Math.toDegrees(atan(shear)))
                        raw("""  <g transform="translate(${inlayCx.f4()} ${centerY.f4()}) skewX($skewDeg) translate(${(-inlayCx).f4()} ${(-centerY).f4()})">""")
                        for (element in preset.draw(ctx)) raw(element)
                        raw("  </g>")
                    } else {
                        for (element in preset.draw(ctx)) raw(element)
                    }
                }
            }

            // ── Alignment pinholes: 1 mm pocket circles ──────────────────────
            if (request.showPinholes) {
                shaper {
                    for (pinFret in pinholeFrets) {
                        val fret = fretPositions.find { it.fretNumber == pinFret } ?: continue
                        val px = xFretCenter(fret)
                        inside("pinhole-$pinFret-top") {
                            circle(
                                px,
                                yTop(fret.distanceFromNut) + PINHOLE_INDENT,
                                PINHOLE_RADIUS
                            )
                        }
                        inside("pinhole-$pinFret-bot") {
                            circle(
                                px,
                                yBottom(fret.distanceFromNut) - PINHOLE_INDENT,
                                PINHOLE_RADIUS
                            )
                        }
                    }
                }
            }

            // ── Locked layer: guides ─────────────────────────────────────────
            if (hasGuides) layer("guides") {
                if (request.label.isNotBlank()) {
                    val esc = request.label.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                    text(svgWidth / 2.0, 5.0, esc, 3.5, COLOR_TITLE, weight = "bold")
                }

                if (request.showCenterLine) {
                    val cxLeft = if (isMultiscale) (xNutTreble + xNutBass) / 2.0 else x0
                    val cxRight = if (isMultiscale) (xBridgeTreble + xBridgeBass) / 2.0 else xHeel
                    line(cxLeft, centerY, cxRight, centerY, COLOR_CENTER_LINE, STROKE_GUIDE, "2,2")
                }

                // String guide lines
                val gaugesIn = request.stringPreset.gaugesIn
                val numStrings = gaugesIn.size
                if (numStrings > 0) {
                    val edgeNut = request.stringPreset.edgeNutMm
                    val edgeHeel = edgeNut * widthAtEnd / request.nutWidth
                    for (n in 0 until numStrings) {
                        val frac = if (numStrings > 1) n.toDouble() / (numStrings - 1) else 0.5
                        val gaugeIn = gaugesIn[n]
                        val nutY = yTop(0.0) + edgeNut + frac * (request.nutWidth - 2 * edgeNut)
                        val heelY = yTop(centerScale) + edgeHeel + frac * (widthAtEnd - 2 * edgeHeel)
                        val nutX = if (isMultiscale) xNutTreble + frac * (xNutBass - xNutTreble) else x0
                        val heelX = if (isMultiscale) xBridgeTreble + frac * (xBridgeBass - xBridgeTreble) else xHeel
                        val stringThickness = gaugeIn.inchToMM()
                        line(nutX, nutY, heelX, heelY, COLOR_STRING, stringThickness, "", OPACITY_STRING)
                        val label = ".${(gaugeIn * 1000).toInt().toString().padStart(3, '0')}"
                        text(nutX - 1.5, nutY, label, 1.8, COLOR_STRING, anchor = "end", baseline = "middle")
                    }
                }

                // Fret numbers — placed BELOW the fretboard bottom edge
                if (request.showFretNumbers)
                    for (fret in fretPositions)
                        text(
                            xFretCenter(fret), yBottom(fret.distanceFromNut) + ext + 6.5,
                            fret.fretNumber.toString(), 2.5, COLOR_FRET_NUM
                        )

                // Width dimension annotations — text placed ABOVE the fretboard top edge
                if (request.showWidthAnnotations) {
                    val xNutAnnot = if (isMultiscale) (xNutTreble + xNutBass) / 2.0 else x0
                    widthAnnotation(xNutAnnot, yTop(0.0), yBottom(0.0), request.nutWidth, "", request.unit)
                    fretPositions.find { it.fretNumber == 12 }?.let { fret ->
                        widthAnnotation(
                            xFretCenter(fret), yTop(fret.distanceFromNut), yBottom(fret.distanceFromNut),
                            request.width12thFret, "", request.unit
                        )
                    }
                    fretPositions.find { it.fretNumber == 24 }?.let { fret ->
                        widthAnnotation(
                            xFretCenter(fret), yTop(fret.distanceFromNut), yBottom(fret.distanceFromNut),
                            widthAt(fret.distanceFromNut), "", request.unit
                        )
                    }
                    val yLine = yBottom(centerScale) + ext + 13.0
                    val xMidSvg = (x0 + xHeel) / 2.0
                    line(x0, yLine - 1.2, x0, yLine + 1.2, COLOR_DIM, STROKE_DIM)
                    line(xHeel, yLine - 1.2, xHeel, yLine + 1.2, COLOR_DIM, STROKE_DIM)
                    line(x0 + 1.5, yLine, xHeel - 1.5, yLine, COLOR_DIM, STROKE_DIM)
                    polygon(
                        "${(x0 + 1.5).f4()},${(yLine - 0.55).f4()} ${(x0 + 1.5).f4()},${(yLine + 0.55).f4()} ${x0.f4()},${yLine.f4()}",
                        COLOR_DIM
                    )
                    polygon(
                        "${(xHeel - 1.5).f4()},${(yLine - 0.55).f4()} ${(xHeel - 1.5).f4()},${(yLine + 0.55).f4()} ${xHeel.f4()},${yLine.f4()}",
                        COLOR_DIM
                    )
                    val scaleLabel = if (isMultiscale)
                        "Bass: ${bassScaleLength.f1()} ${request.unit} / Treble: ${trebleScaleLength.f1()} ${request.unit}"
                    else
                        "Scale: ${request.scaleLength.f1()} ${request.unit}"
                    text(xMidSvg, yLine - 1.5, scaleLabel, 2.3, COLOR_DIM)
                }

                // Bounding box of the fretboard blank rectangle
                if (request.showBoundingBox) {
                    val bbY1 = yTop(centerScale)
                    val bbY2 = yBottom(centerScale)
                    rect(
                        x0,
                        bbY1,
                        effectiveScale,
                        bbY2 - bbY1,
                        stroke = COLOR_BBOX,
                        strokeWidth = STROKE_BBOX,
                        dash = "3,2"
                    )
                }

                // Pinhole crosshairs + reference circles
                if (request.showPinholes)
                    for (pinFret in pinholeFrets) {
                        val fret = fretPositions.find { it.fretNumber == pinFret } ?: continue
                        val px = xFretCenter(fret)
                        for (py in listOf(
                            yTop(fret.distanceFromNut) + PINHOLE_INDENT,
                            yBottom(fret.distanceFromNut) - PINHOLE_INDENT,
                        )) {
                            line(px - PINHOLE_ARM, py, px + PINHOLE_ARM, py, COLOR_PINHOLE, STROKE_GUIDE)
                            line(px, py - PINHOLE_ARM, px, py + PINHOLE_ARM, COLOR_PINHOLE, STROKE_GUIDE)
                            circle(px, py, PINHOLE_RADIUS, stroke = COLOR_PINHOLE, strokeWidth = STROKE_DIM)
                        }
                    }

                // Radius contour zone rectangles (overlapping trapezoids) + depth labels.
                if (request.showRadius && request.radiusValue > 0.0) {
                    val R = request.radiusValue
                    val N = request.radiusSteps.coerceIn(2, 10)
                    val halfWidthNut = request.nutWidth / 2.0
                    val halfWidthHeel = widthAtEnd / 2.0
                    val labelX = xHeel + 2.0

                    for (k in N downTo 1) {
                        val frac = k.toDouble() / N
                        val yTN = centerY - frac * halfWidthNut
                        val yTH = centerY - frac * halfWidthHeel
                        val yBH = centerY + frac * halfWidthHeel
                        val yBN = centerY + frac * halfWidthNut
                        polygon(
                            "${x0.f4()},${yTN.f4()} ${xHeel.f4()},${yTH.f4()} ${xHeel.f4()},${yBH.f4()} ${x0.f4()},${yBN.f4()}",
                            COLOR_RADIUS, fillOpacity = OPACITY_RADIUS
                        )
                    }

                    val inchStr = String.format(Locale.US, "%.2f", R / 25.4)
                    text(
                        labelX, SVG_MARGIN_TOP, "R=${R.f1()}mm (${inchStr}\")", 2.1, COLOR_RADIUS,
                        anchor = "start", weight = "bold", baseline = "middle"
                    )

                    for (k in 1..N) {
                        val fracOuter = k.toDouble() / N
                        val fracInner = (k - 1).toDouble() / N
                        val yMid = centerY - ((fracInner + fracOuter) / 2.0) * halfWidthHeel
                        val yEdge = fracOuter * halfWidthHeel
                        val depth = R - sqrt(R * R - yEdge * yEdge)
                        text(
                            labelX, yMid, "Z$k: ${String.format(Locale.US, "%.3f", depth)}mm", 2.0, COLOR_RADIUS,
                            anchor = "start", baseline = "middle"
                        )
                    }
                }

                // Multiscale-specific guides: perpendicular fret, bridge line, angle annotations
                if (isMultiscale) {
                    fretPositions.find { it.fretNumber == perpendicularFret }?.let { perpFret ->
                        line(
                            xFretTreble(perpFret), yTop(perpFret.distanceFromNut),
                            xFretBass(perpFret), yBottom(perpFret.distanceFromNut),
                            COLOR_PERP_FRET, STROKE_SHAPER_CUT * 2
                        )
                    }
                    // Dashed bridge-position guide line
                    line(
                        xBridgeTreble, yTop(centerScale), xBridgeBass, yBottom(centerScale),
                        COLOR_CENTER_LINE, STROKE_GUIDE, "3,2"
                    )

                    val nutDx = xNutBass - xNutTreble
                    val nutDy = yBottom(0.0) - yTop(0.0)
                    val bridgeDx = xBridgeBass - xBridgeTreble
                    val nutAngle = Math.toDegrees(atan2(nutDx, nutDy))
                    val bridgeAngle = Math.toDegrees(atan2(bridgeDx, nutDy))
                    val annotX = xHeel + 2.0
                    text(
                        annotX,
                        SVG_MARGIN_TOP + 0.0,
                        "Perp fret: $perpendicularFret",
                        2.1,
                        COLOR_PERP_FRET,
                        anchor = "start",
                        weight = "bold"
                    )
                    text(
                        annotX,
                        SVG_MARGIN_TOP + 5.0,
                        "Bass:   ${bassScaleLength.f1()} ${request.unit}",
                        2.1,
                        COLOR_DIM,
                        anchor = "start"
                    )
                    text(
                        annotX,
                        SVG_MARGIN_TOP + 9.0,
                        "Treble: ${trebleScaleLength.f1()} ${request.unit}",
                        2.1,
                        COLOR_DIM,
                        anchor = "start"
                    )
                    text(
                        annotX,
                        SVG_MARGIN_TOP + 13.0,
                        "Nut angle:    ${String.format(Locale.US, "%.1f", nutAngle)}°",
                        2.1,
                        COLOR_DIM,
                        anchor = "start"
                    )
                    text(
                        annotX,
                        SVG_MARGIN_TOP + 17.0,
                        "Bridge angle: ${String.format(Locale.US, "%.1f", bridgeAngle)}°",
                        2.1,
                        COLOR_DIM,
                        anchor = "start"
                    )
                }
            }
        }
    }

    // ── Public: fretboard lighting SVG ───────────────────────────────────────

    fun generateLightingSvg(request: LightingRequest, fretPositions: List<FretPosition>): String {
        val geo = FretboardGeometry(request.scaleLength, request.nutWidth, request.width12thFret)
        val widthAtEnd = geo.widthAtEnd
        val centerY = geo.centerY
        fun yTop(d: Double) = geo.yTop(d)
        fun yBottom(d: Double) = geo.yBottom(d)

        val x0 = SVG_MARGIN_H
        val xHeel = x0 + request.scaleLength
        val svgWidth = xHeel + SVG_MARGIN_H
        val svgHeight = widthAtEnd + SVG_MARGIN_TOP + SVG_MARGIN_BOT_LIGHTING

        val trussHalf = request.trussRodWidth / 2.0
        val halfW = request.channelWidth / 2.0
        val edgePad = request.inlaySize / 2.0 + LIGHTING_EDGE_PAD_OFFSET

        val wires = mutableListOf<Wire>()
        if (request.showInlays) {
            for (inlayFret in inlayFrets) {
                val curr = fretPositions.find { it.fretNumber == inlayFret } ?: continue
                val prevDist = fretPositions.find { it.fretNumber == inlayFret - 1 }?.distanceFromNut ?: 0.0
                val midDist = (prevDist + curr.distanceFromNut) / 2.0
                val inlayX = x0 + midDist
                val isDouble = request.doubleInlays && inlayFret in doubleFrets

                val vOff = request.inlayDoubleOffsetV
                val yCenters: List<Double> = when (request.inlayPosition) {
                    InlayPosition.TOP -> if (isDouble)
                        listOf(yTop(midDist) + edgePad, yTop(midDist) + edgePad + vOff)
                    else listOf(yTop(midDist) + edgePad)

                    InlayPosition.BOTTOM -> if (isDouble)
                        listOf(yBottom(midDist) - edgePad - vOff, yBottom(midDist) - edgePad)
                    else listOf(yBottom(midDist) - edgePad)

                    else -> if (isDouble)
                        listOf(centerY - vOff / 2.0, centerY + vOff / 2.0)
                    else listOf(centerY)
                }
                yCenters.forEach { yc -> wires.add(Wire(inlayFret, inlayX, yc)) }
            }
        }

        val n = wires.size
        val trunkY = if (request.inlayPosition == InlayPosition.TOP)
            centerY - trussHalf - LIGHTING_WIRE_GAP
        else
            centerY + trussHalf + LIGHTING_WIRE_GAP
        val ledR = request.ledPocketSize / 2.0
        val firstX = if (wires.isNotEmpty()) wires.minOf { it.inlayX } - halfW else xHeel - 10.0

        return buildSvg(svgWidth, svgHeight, "Fretboard Lighting SVG — underside channel routing") {

            // ── Outside cut: fretboard outline ───────────────────────────────
            shaper {
                outside("fretboard-outline") {
                    path(fretboardOutlineD(x0, xHeel, request.scaleLength, { d -> yTop(d) }, { d -> yBottom(d) }))
                }
            }

            // ── Pocket cuts: trunk channel ───────────────────────────────────
            shaper {
                pocket("trunk") { rect(firstX, trunkY - halfW, xHeel, trunkY + halfW) }
            }

            // ── Pocket cuts: LED pockets, solder bays, stub channels ─────────
            shaper {
                for (wire in wires) {
                    val ix = wire.inlayX
                    val iy = wire.inlayY
                    pocket("led-f${wire.fretNumber}-${iy.toInt()}") { circle(ix, iy, ledR) }
                    pocket("solder-f${wire.fretNumber}-${iy.toInt()}") {
                        rect(
                            ix + ledR,
                            iy - ledR - 1.0,
                            ix + ledR + LIGHTING_SOLDER_BAY,
                            iy + ledR + 1.0
                        )
                    }
                    val stubTop = iy + ledR
                    val stubBot = trunkY - halfW
                    if (stubBot - stubTop > 0.1)
                        pocket("stub-f${wire.fretNumber}-${iy.toInt()}") {
                            rect(
                                ix - halfW,
                                stubTop,
                                ix + halfW,
                                stubBot
                            )
                        }
                    else if (iy - ledR > trunkY + halfW)
                        pocket("stub-f${wire.fretNumber}-${iy.toInt()}") {
                            rect(
                                ix - halfW,
                                trunkY + halfW,
                                ix + halfW,
                                iy - ledR
                            )
                        }
                }
            }

            // ── Locked layer: guides ─────────────────────────────────────────
            layer("guides") {
                text(svgWidth / 2.0, 5.0, "Fretboard Lighting — Electrical (addressable chain)", 3.5, COLOR_TITLE)

                for (wire in wires)
                    circle(wire.inlayX, wire.inlayY, 0.8, stroke = COLOR_LIGHT_INLAY, strokeWidth = STROKE_GUIDE)

                wires.groupBy { it.fretNumber }.forEach { (num, grp) ->
                    text(grp.first().inlayX, grp.minOf { it.inlayY } - 2.0, num.toString(), 2.0, COLOR_LIGHT_INLAY)
                }

                text((firstX + xHeel) / 2.0, trunkY + 3.5, "GND · 5V · DATA trunk", 2.0, COLOR_LIGHT_TRUNK)
                rect(
                    x0,
                    centerY - trussHalf,
                    request.scaleLength,
                    request.trussRodWidth,
                    fill = COLOR_LIGHT_TRUSS_FILL,
                    fillOpacity = 0.12,
                    stroke = COLOR_LIGHT_TRUSS_STROKE,
                    strokeWidth = STROKE_GUIDE,
                    dash = "2,2"
                )
                text(
                    x0 + 5.0,
                    centerY + 0.7,
                    "truss rod",
                    2.0,
                    COLOR_LIGHT_TRUSS_TEXT,
                    anchor = "start",
                    baseline = "middle"
                )
                text(xHeel + 1.5, trunkY, "$n LEDs", 2.0, COLOR_LIGHT_ACCENT, anchor = "start", baseline = "middle")
                line(x0, centerY, xHeel, centerY, COLOR_CENTER_LINE, STROKE_GUIDE, "2,2")
            }
        }
    }

    // ── Public: compact inlays cutting sheet ─────────────────────────────────
    // Groups equal shapes together and lays them out in a dense grid, each cell
    // labelled with the fret number(s) that shape belongs to.

    fun generateInlaysSheet(request: FretRequest, fretPositions: List<FretPosition>): String {
        if (!request.showInlays) return buildSvg(50.0, 20.0, "Inlays Sheet") {}

        val geo = FretboardGeometry(request.scaleLength, request.nutWidth, request.width12thFret)
        fun widthAt(d: Double) = geo.widthAt(d)

        val firstInlayFret = inlayFrets.firstOrNull { fn -> fretPositions.any { it.fretNumber == fn } }
        val refSpacing: Double
        val refWidth: Double
        if (firstInlayFret != null) {
            val c = fretPositions.first { it.fretNumber == firstInlayFret }
            val pD = fretPositions.find { it.fretNumber == firstInlayFret - 1 }?.distanceFromNut ?: 0.0
            refSpacing = c.distanceFromNut - pD
            refWidth = widthAt((pD + c.distanceFromNut) / 2.0)
        } else {
            refSpacing = 1.0
            refWidth = 1.0
        }

        data class FretShape(
            val fretNumber: Int,
            val effSize: Double,
            val effHeight: Double,
            val effOffsetV: Double,
            val effOffsetH: Double,
            val isDouble: Boolean,
        )

        val shapes = mutableListOf<FretShape>()
        for (inlayFret in inlayFrets) {
            val curr = fretPositions.find { it.fretNumber == inlayFret } ?: continue
            val prevDist = fretPositions.find { it.fretNumber == inlayFret - 1 }?.distanceFromNut ?: 0.0
            val midDist = (prevDist + curr.distanceFromNut) / 2.0
            val fretSpacing = curr.distanceFromNut - prevDist
            val scaleW =
                (1.0 - request.inlayShrinkWidth + request.inlayShrinkWidth * (fretSpacing / refSpacing)).coerceAtLeast(
                    0.01
                )
            val scaleH =
                (1.0 - request.inlayGrowHeight + request.inlayGrowHeight * (widthAt(midDist) / refWidth)).coerceAtLeast(
                    0.01
                )
            val scale1224W = if (inlayFret in doubleFrets) (1.0 - request.inlayShrinkWidth1224) else 1.0
            val scale1224H = if (inlayFret in doubleFrets) (1.0 - request.inlayShrinkHeight1224) else 1.0
            shapes.add(
                FretShape(
                    fretNumber = inlayFret,
                    effSize = request.inlaySize * scaleW * scale1224W,
                    effHeight = request.inlayHeight * scaleH * scale1224H,
                    effOffsetV = request.inlayDoubleOffsetV,
                    effOffsetH = if (request.inlayDoubleOrientation == InlayDoubleOrientation.HORIZONTAL)
                        request.inlayDoubleOffsetH * scaleW
                    else
                        request.inlayDoubleOffsetH,
                    isDouble = request.doubleInlays && inlayFret in doubleFrets,
                )
            )
        }

        if (shapes.isEmpty()) return buildSvg(50.0, 20.0, "Inlays Sheet — no frets") {}

        fun FretShape.key() = "${effSize.f1()}_${effHeight.f1()}_${effOffsetV.f1()}_${effOffsetH.f1()}_$isDouble"
        val groups = LinkedHashMap<String, Pair<FretShape, MutableList<Int>>>()
        for (s in shapes) groups.getOrPut(s.key()) { Pair(s, mutableListOf()) }.second.add(s.fretNumber)
        val groupList = groups.values.toList()

        val paraAbs = abs(request.inlayParallelogram)
        val trAbs = abs(request.inlayTrapezoid)
        fun bounds(fs: FretShape): Pair<Double, Double> {
            val baseH = if (fs.effHeight > 0.0) fs.effHeight else fs.effSize
            val effH = if (request.inlayShape == InlayShape.RECTANGLE) baseH * (1.0 + trAbs * 0.5) else baseH
            val sW = fs.effSize + paraAbs * baseH
            val sH = effH
            if (!fs.isDouble) return Pair(sW, sH)
            return Pair(fs.effOffsetH + sW, fs.effOffsetV + sH)
        }

        val CELL_PAD = 7.0
        val LABEL_H = 7.0
        val GAP = 5.0
        val MARGIN = 8.0
        val TITLE_H = 8.0
        val MAX_COLS = 4

        val maxBW = groupList.maxOf { bounds(it.first).first }
        val maxBH = groupList.maxOf { bounds(it.first).second }
        val cellW = maxBW + CELL_PAD * 2
        val cellH = maxBH + CELL_PAD * 2 + LABEL_H

        val nCols = minOf(groupList.size, MAX_COLS)
        val nRows = (groupList.size + nCols - 1) / nCols
        val svgW = MARGIN * 2 + nCols * cellW + (nCols - 1) * GAP
        val svgH = MARGIN + TITLE_H + nRows * cellH + (nRows - 1) * GAP + MARGIN

        val preset = INLAY_PRESETS.find { it.id == request.inlayShape } ?: INLAY_PRESETS.first()
        val sheetCut: (String, String) -> String = { id, d ->
            pathStr(id, d, cutOffset = SHAPER_CUT_OFFSET, cutType = "outside", strokeColor = COLOR_CUT_OUTSIDE)
        }
        val sheetCutOnline: (String, String) -> String = { id, d ->
            pathStr(id, d, cutType = "online", strokeColor = COLOR_CUT_ONLINE)
        }

        return buildSvg(svgW, svgH, "Inlays Sheet — ${preset.name}") {

            layer("guides") {
                text(
                    svgW / 2.0, MARGIN + TITLE_H / 2.0, "Inlays — ${preset.name}", 3.5, COLOR_TITLE,
                    weight = "bold", baseline = "middle"
                )
                for ((idx, entry) in groupList.withIndex()) {
                    val col = idx % nCols
                    val row = idx / nCols
                    val cellX = MARGIN + col * (cellW + GAP)
                    val cellY = MARGIN + TITLE_H + row * (cellH + GAP)
                    val lx = cellX + cellW / 2.0
                    val ly = cellY + CELL_PAD + maxBH + CELL_PAD * 0.5 + LABEL_H * 0.5
                    text(lx, ly, "Fret " + entry.second.joinToString(", "), 2.8, COLOR_FRET_NUM, baseline = "middle")
                }
            }

            val shapeEdgeInset = request.inlayEdgeMargin

            for ((idx, entry) in groupList.withIndex()) {
                val (fs, _) = entry
                val col = idx % nCols
                val row = idx / nCols
                val cellX = MARGIN + col * (cellW + GAP)
                val cellY = MARGIN + TITLE_H + row * (cellH + GAP)
                val cellCx = cellX + cellW / 2.0
                val cellCy = cellY + CELL_PAD + maxBH / 2.0

                // Position virtual yTop/yBottom so the shape's bounding box centers on cellCy
                // for whichever position the user chose (TOP/BOTTOM/CENTER).
                val (_, sH) = bounds(fs)
                val yTopVal = cellCy - sH / 2.0 - shapeEdgeInset
                val yBottomVal = cellCy + sH / 2.0 + shapeEdgeInset

                val ctx = InlayShapeCtx(
                    baseId = "sheet-$idx",
                    cx = cellCx,
                    midDist = 0.0,
                    effectiveSize = fs.effSize,
                    effectiveHeight = fs.effHeight,
                    trap = request.inlayTrapezoid,
                    parallelogram = request.inlayParallelogram,
                    edgePad = fs.effSize / 2.0 + request.inlayEdgeMargin,
                    effectiveInlayDoubleOffsetV = fs.effOffsetV,
                    effectiveInlayDoubleOffsetH = fs.effOffsetH,
                    isDouble = fs.isDouble,
                    position = request.inlayPosition,
                    doubleOrientation = request.inlayDoubleOrientation,
                    f = { v -> v.f4() },
                    yTop = { _ -> yTopVal },
                    yBottom = { _ -> yBottomVal },
                    centerY = cellCy,
                    cutPath = sheetCut,
                    cutPathOnline = sheetCutOnline,
                    fretNumber = entry.second.first(),
                    customPath = request.inlayCustomPath,
                    customPathClosed = request.inlayCustomClosed,
                )
                for (element in preset.draw(ctx)) raw(element)
            }
        }
    }
}

private fun Double.inchToMM() = this * 25.4
