package com.luthertools.fretcalculator.model

import com.luthertools.fretcalculator.service.COLOR_CUT_ONLINE
import com.luthertools.fretcalculator.service.SHAPER_CUT_OFFSET
import com.luthertools.fretcalculator.service.SHAPER_TOOL_DIA
import com.luthertools.fretcalculator.service.STROKE_SHAPER_CUT
import com.luthertools.fretcalculator.service.circlePathD
import com.luthertools.fretcalculator.service.pathStr
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

sealed class InlayPreset(
    val id: InlayShape,
    val name: String,
) {
    abstract fun draw(ctx: InlayShapeCtx): List<String>

    data object Circle : InlayPreset(InlayShape.CIRCLE, "Circle") {
        override fun draw(ctx: InlayShapeCtx): List<String> {
            val r = ctx.effectiveSize / 2.0
            fun circle(id: String, cx: Double, cy: Double): String =
                ctx.cutPath(id, circlePathD(cx, cy, r))

            val y = when (ctx.position) {
                InlayPosition.TOP -> ctx.yTop(ctx.midDist) + ctx.edgePad
                InlayPosition.BOTTOM -> ctx.yBottom(ctx.midDist) - ctx.edgePad
                else -> ctx.centerY
            }
            return if (ctx.isDouble) {
                val hoH  = ctx.effectiveInlayDoubleOffsetH / 2.0
                val effV = ctx.effectiveInlayDoubleOffsetV
                val hoV  = effV / 2.0
                when (ctx.doubleOrientation) {
                    InlayDoubleOrientation.HORIZONTAL -> listOf(
                        circle("${ctx.baseId}a", ctx.cx - hoH, y - hoV),
                        circle("${ctx.baseId}b", ctx.cx + hoH, y + hoV),
                    )
                    else -> { // VERTICAL
                        val (y1, y2) = when (ctx.position) {
                            InlayPosition.TOP    -> Pair(y,        y + effV)
                            InlayPosition.BOTTOM -> Pair(y - effV, y)
                            else                 -> Pair(ctx.centerY - hoV, ctx.centerY + hoV)
                        }
                        listOf(
                            circle("${ctx.baseId}a", ctx.cx - hoH, y1),
                            circle("${ctx.baseId}b", ctx.cx + hoH, y2),
                        )
                    }
                }
            } else {
                listOf(circle(ctx.baseId, ctx.cx, y))
            }
        }
    }

    data object Rectangle : InlayPreset(InlayShape.RECTANGLE, "Rectangle") {
        override fun draw(ctx: InlayShapeCtx): List<String> {
            val hw  = ctx.effectiveSize / 2.0
            val h   = ctx.effectiveHeight
            val tr  = ctx.trap
            // Split the lean equally across both edges so the centroid stays at cx.
            val hs  = ctx.parallelogram * h / 2.0
            fun rect(id: String, cx: Double, d: Double, dy: Double = 0.0): String {
                val dL = d - hw
                val dR = d + hw
                val xL = cx - hw
                val xR = cx + hw
                val em = ctx.edgePad - hw
                return when (ctx.position) {
                    InlayPosition.TOP -> {
                        val hL = (h * (1.0 - tr * 0.5)).coerceAtLeast(0.01)
                        val hR = h * (1.0 + tr * 0.5)
                        ctx.cutPath(id,
                            "M ${ctx.f(xL + hs)} ${ctx.f(ctx.yTop(dL) + em + dy)} " +
                            "L ${ctx.f(xR + hs)} ${ctx.f(ctx.yTop(dR) + em + dy)} " +
                            "L ${ctx.f(xR - hs)} ${ctx.f(ctx.yTop(dR) + hR + em + dy)} " +
                            "L ${ctx.f(xL - hs)} ${ctx.f(ctx.yTop(dL) + hL + em + dy)} Z"
                        )
                    }
                    InlayPosition.BOTTOM -> {
                        val hL = (h * (1.0 - tr * 0.5)).coerceAtLeast(0.01)
                        val hR = h * (1.0 + tr * 0.5)
                        ctx.cutPath(id,
                            "M ${ctx.f(xL + hs)} ${ctx.f(ctx.yBottom(dL) - hL - em + dy)} " +
                            "L ${ctx.f(xR + hs)} ${ctx.f(ctx.yBottom(dR) - hR - em + dy)} " +
                            "L ${ctx.f(xR - hs)} ${ctx.f(ctx.yBottom(dR) - em + dy)} " +
                            "L ${ctx.f(xL - hs)} ${ctx.f(ctx.yBottom(dL) - em + dy)} Z"
                        )
                    }
                    else -> {
                        val hhL = (h / 2.0 * (1.0 - tr * 0.5)).coerceAtLeast(0.01)
                        val hhR = h / 2.0 * (1.0 + tr * 0.5)
                        ctx.cutPath(id,
                            "M ${ctx.f(xL + hs)} ${ctx.f(ctx.centerY - hhL + dy)} " +
                            "L ${ctx.f(xR + hs)} ${ctx.f(ctx.centerY - hhR + dy)} " +
                            "L ${ctx.f(xR - hs)} ${ctx.f(ctx.centerY + hhR + dy)} " +
                            "L ${ctx.f(xL - hs)} ${ctx.f(ctx.centerY + hhL + dy)} Z"
                        )
                    }
                }
            }
            return if (ctx.isDouble) {
                val hoH  = ctx.effectiveInlayDoubleOffsetH / 2.0
                val effV = ctx.effectiveInlayDoubleOffsetV
                val hoV  = effV / 2.0
                when (ctx.doubleOrientation) {
                    InlayDoubleOrientation.HORIZONTAL -> listOf(
                        rect("${ctx.baseId}a", ctx.cx - hoH, ctx.midDist - hoH, -hoV),
                        rect("${ctx.baseId}b", ctx.cx + hoH, ctx.midDist + hoH, +hoV),
                    )
                    else -> { // VERTICAL
                        val (dy1, dy2) = when (ctx.position) {
                            InlayPosition.TOP    -> Pair(0.0,   effV)
                            InlayPosition.BOTTOM -> Pair(-effV, 0.0)
                            else                 -> Pair(-hoV,  +hoV)
                        }
                        listOf(
                            rect("${ctx.baseId}a", ctx.cx - hoH, ctx.midDist, dy1),
                            rect("${ctx.baseId}b", ctx.cx + hoH, ctx.midDist, dy2),
                        )
                    }
                }
            } else {
                listOf(rect(ctx.baseId, ctx.cx, ctx.midDist))
            }
        }
    }

    // ── Custom ────────────────────────────────────────────────────────────────
    // User-drawn polygon. Path points are in normalized [0,1]² space:
    // x = 0 maps to the left of the bounding box, x = 1 to the right;
    // y = 0 maps to the "top" edge of the inlay (towards the fretboard edge for
    // TOP/BOTTOM positions), y = 1 to the opposite edge.
    // Each entry of customPath is a segment:
    //   length 2 -> line to [x, y]                          (or 'M' if first)
    //   length 4 -> quadratic Bezier with control + end     [cx, cy, x, y]
    //   length 6 -> cubic Bezier with two controls + end    [c1x, c1y, c2x, c2y, x, y]
    // Trapezoid + parallelogram are applied with the same convention as Rectangle:
    //   - trap: vertical side scales by (1 + tr*(px - 0.5)) — left short, right tall when tr>0
    //   - parallelogram: horizontal shift hs = parallelogram * h / 2, by (1 - 2*py)
    data object Custom : InlayPreset(InlayShape.CUSTOM, "Custom") {
        override fun draw(ctx: InlayShapeCtx): List<String> {
            val subpaths = ctx.customPath
            if (subpaths.isEmpty() || subpaths.all { it.size < 2 }) return emptyList()

            val w = ctx.effectiveSize
            val h = if (ctx.effectiveHeight > 0.0) ctx.effectiveHeight else ctx.effectiveSize
            val hs = ctx.parallelogram * h / 2.0

            // Builds one SVG path element combining all subpaths (multiple M…Z blocks).
            // Multiple closed subpaths with even-odd winding produce correct holes
            // (e.g. the inner triangle of a letter "A").
            val edgeMargin = ctx.edgePad - ctx.effectiveSize / 2.0
            fun shape(id: String, cxOff: Double, dyOff: Double): List<String> {
                val cx = ctx.cx + cxOff

                // Evaluate the reference edge y at the actual fret distance of each normalized x,
                // so the custom shape tracks the fretboard taper exactly like Rectangle does.
                fun yBaseAt(px: Double): Double {
                    val d = ctx.midDist + (px - 0.5) * w
                    return when (ctx.position) {
                        InlayPosition.TOP    -> ctx.yTop(d)    + edgeMargin      + dyOff
                        InlayPosition.BOTTOM -> ctx.yBottom(d) - h - edgeMargin  + dyOff
                        else                 -> ctx.centerY    - h / 2.0         + dyOff
                    }
                }

                fun tx(px: Double, py: Double): Pair<Double, Double> {
                    val trapScale = (1.0 + ctx.trap * (px - 0.5)).coerceAtLeast(0.01)
                    val xLocal    = cx + (px - 0.5) * w
                    val yLocal    = yBaseAt(px) + py * h * trapScale
                    return Pair(xLocal + hs * (1.0 - 2.0 * py), yLocal)
                }

                val sb = StringBuilder()
                for (segs in subpaths) {
                    if (segs.size < 2) continue
                    val (sx, sy) = tx(segs[0][0], segs[0][1])
                    sb.append("M ").append(ctx.f(sx)).append(' ').append(ctx.f(sy))
                    for (i in 1 until segs.size) {
                        val seg = segs[i]
                        when (seg.size) {
                            2 -> {
                                val (x, y) = tx(seg[0], seg[1])
                                sb.append(" L ").append(ctx.f(x)).append(' ').append(ctx.f(y))
                            }
                            4 -> {
                                val (qcx, qcy) = tx(seg[0], seg[1])
                                val (qx, qy)   = tx(seg[2], seg[3])
                                sb.append(" Q ").append(ctx.f(qcx)).append(' ').append(ctx.f(qcy))
                                  .append(' ').append(ctx.f(qx)).append(' ').append(ctx.f(qy))
                            }
                            6 -> {
                                val (c1x, c1y) = tx(seg[0], seg[1])
                                val (c2x, c2y) = tx(seg[2], seg[3])
                                val (cx2, cy2) = tx(seg[4], seg[5])
                                sb.append(" C ").append(ctx.f(c1x)).append(' ').append(ctx.f(c1y))
                                  .append(' ').append(ctx.f(c2x)).append(' ').append(ctx.f(c2y))
                                  .append(' ').append(ctx.f(cx2)).append(' ').append(ctx.f(cy2))
                            }
                        }
                    }
                    if (ctx.customPathClosed && segs.size >= 3) sb.append(" Z")
                }

                val pathD = sb.toString()
                if (pathD.isBlank()) return emptyList()

                val pathElem = if (ctx.customPathClosed) {
                    ctx.cutPath(id, pathD)
                } else {
                    (ctx.cutPathOnline ?: ctx.cutPath).invoke(id, pathD)
                }

                return listOf(pathElem)
            }

            return if (ctx.isDouble) {
                val hoH  = ctx.effectiveInlayDoubleOffsetH / 2.0
                val effV = ctx.effectiveInlayDoubleOffsetV
                val hoV  = effV / 2.0
                when (ctx.doubleOrientation) {
                    InlayDoubleOrientation.HORIZONTAL -> listOf(
                        shape("${ctx.baseId}a", -hoH, -hoV),
                        shape("${ctx.baseId}b", +hoH, +hoV),
                    ).flatten()
                    else -> { // VERTICAL
                        val (dy1, dy2) = when (ctx.position) {
                            InlayPosition.TOP    -> Pair(0.0,   effV)
                            InlayPosition.BOTTOM -> Pair(-effV, 0.0)
                            else                 -> Pair(-hoV,  +hoV)
                        }
                        listOf(
                            shape("${ctx.baseId}a", -hoH, dy1),
                            shape("${ctx.baseId}b", +hoH, dy2),
                        ).flatten()
                    }
                }
            } else {
                shape(ctx.baseId, 0.0, 0.0)
            }
        }
    }

    data object Diamond : InlayPreset(InlayShape.DIAMOND, "Diamond") {
        override fun draw(ctx: InlayShapeCtx): List<String> {
            val h = ctx.effectiveSize / 2.0
            val y = when (ctx.position) {
                InlayPosition.TOP -> ctx.yTop(ctx.midDist) + ctx.edgePad
                InlayPosition.BOTTOM -> ctx.yBottom(ctx.midDist) - ctx.edgePad
                else -> ctx.centerY
            }

            fun diamond(id: String, cx: Double, cy: Double): String {
                val d =
                    "M ${ctx.f(cx)} ${ctx.f(cy - h)} " + "L ${ctx.f(cx + h)} ${ctx.f(cy)} " + "L ${ctx.f(cx)} ${ctx.f(cy + h)} " + "L ${
                        ctx.f(cx - h)
                    } ${ctx.f(cy)} Z"
                return ctx.cutPath(id, d)
            }

            return if (ctx.isDouble) {
                val hoH  = ctx.effectiveInlayDoubleOffsetH / 2.0
                val effV = ctx.effectiveInlayDoubleOffsetV
                val hoV  = effV / 2.0
                when (ctx.doubleOrientation) {
                    InlayDoubleOrientation.HORIZONTAL -> listOf(
                        diamond("${ctx.baseId}a", ctx.cx - hoH, y - hoV),
                        diamond("${ctx.baseId}b", ctx.cx + hoH, y + hoV),
                    )
                    else -> { // VERTICAL
                        val (y1, y2) = when (ctx.position) {
                            InlayPosition.TOP    -> Pair(y,        y + effV)
                            InlayPosition.BOTTOM -> Pair(y - effV, y)
                            else                 -> Pair(ctx.centerY - hoV, ctx.centerY + hoV)
                        }
                        listOf(
                            diamond("${ctx.baseId}a", ctx.cx - hoH, y1),
                            diamond("${ctx.baseId}b", ctx.cx + hoH, y2),
                        )
                    }
                }
            } else {
                listOf(diamond(ctx.baseId, ctx.cx, y))
            }
        }
    }
}
