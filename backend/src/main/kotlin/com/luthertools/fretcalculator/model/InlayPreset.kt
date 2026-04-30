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
                val ho = ctx.effectiveInlayDoubleOffset / 2.0
                when (ctx.doubleOrientation) {
                    InlayDoubleOrientation.HORIZONTAL -> {
                        listOf(
                            circle("${ctx.baseId}a", ctx.cx - ho, y), circle("${ctx.baseId}b", ctx.cx + ho, y)
                        )
                    }
                    InlayDoubleOrientation.STAGGERED -> {
                        listOf(
                            circle("${ctx.baseId}a", ctx.cx - ho, ctx.centerY - ho),
                            circle("${ctx.baseId}b", ctx.cx + ho, ctx.centerY + ho)
                        )
                    }
                    else -> { // vertical
                        val (y1, y2) = when (ctx.position) {
                            InlayPosition.TOP -> Pair(y, y + ctx.effectiveInlayDoubleOffset)
                            InlayPosition.BOTTOM -> Pair(y - ctx.effectiveInlayDoubleOffset, y)
                            else -> Pair(ctx.centerY - ho, ctx.centerY + ho)
                        }
                        listOf(
                            circle("${ctx.baseId}a", ctx.cx, y1), circle("${ctx.baseId}b", ctx.cx, y2)
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
                return when (ctx.position) {
                    InlayPosition.TOP -> {
                        val hL = (h * (1.0 - tr * 0.5)).coerceAtLeast(0.01)
                        val hR = h * (1.0 + tr * 0.5)
                        ctx.cutPath(id,
                            "M ${ctx.f(xL + hs)} ${ctx.f(ctx.yTop(dL) + dy)} " +
                            "L ${ctx.f(xR + hs)} ${ctx.f(ctx.yTop(dR) + dy)} " +
                            "L ${ctx.f(xR - hs)} ${ctx.f(ctx.yTop(dR) + hR + dy)} " +
                            "L ${ctx.f(xL - hs)} ${ctx.f(ctx.yTop(dL) + hL + dy)} Z"
                        )
                    }
                    InlayPosition.BOTTOM -> {
                        val hL = (h * (1.0 - tr * 0.5)).coerceAtLeast(0.01)
                        val hR = h * (1.0 + tr * 0.5)
                        ctx.cutPath(id,
                            "M ${ctx.f(xL + hs)} ${ctx.f(ctx.yBottom(dL) - hL + dy)} " +
                            "L ${ctx.f(xR + hs)} ${ctx.f(ctx.yBottom(dR) - hR + dy)} " +
                            "L ${ctx.f(xR - hs)} ${ctx.f(ctx.yBottom(dR) + dy)} " +
                            "L ${ctx.f(xL - hs)} ${ctx.f(ctx.yBottom(dL) + dy)} Z"
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
                val ho = ctx.effectiveInlayDoubleOffset / 2.0
                when (ctx.doubleOrientation) {
                    InlayDoubleOrientation.HORIZONTAL -> {
                        listOf(
                            rect("${ctx.baseId}a", ctx.cx - ho, ctx.midDist - ho),
                            rect("${ctx.baseId}b", ctx.cx + ho, ctx.midDist + ho)
                        )
                    }
                    InlayDoubleOrientation.STAGGERED -> {
                        listOf(
                            rect("${ctx.baseId}a", ctx.cx - ho, ctx.midDist, -ho),
                            rect("${ctx.baseId}b", ctx.cx + ho, ctx.midDist, +ho)
                        )
                    }
                    else -> { // vertical
                        val (dy1, dy2) = when (ctx.position) {
                            InlayPosition.TOP -> Pair(0.0, ctx.effectiveInlayDoubleOffset)
                            InlayPosition.BOTTOM -> Pair(-ctx.effectiveInlayDoubleOffset, 0.0)
                            else -> Pair(-ho, +ho)
                        }
                        listOf(
                            rect("${ctx.baseId}a", ctx.cx, ctx.midDist, dy1),
                            rect("${ctx.baseId}b", ctx.cx, ctx.midDist, dy2)
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
            val segs = ctx.customPath
            if (segs.size < 3) return emptyList()
            if (segs[0].size != 2) return emptyList()

            val w = ctx.effectiveSize
            val h = if (ctx.effectiveHeight > 0.0) ctx.effectiveHeight else ctx.effectiveSize
            val hs = ctx.parallelogram * h / 2.0

            fun shape(id: String, cxOff: Double, dyOff: Double): String {
                val yBase = when (ctx.position) {
                    InlayPosition.TOP    -> ctx.yTop(ctx.midDist) + dyOff
                    InlayPosition.BOTTOM -> ctx.yBottom(ctx.midDist) - h + dyOff
                    else                 -> ctx.centerY - h / 2.0 + dyOff
                }
                val cx = ctx.cx + cxOff

                fun tx(px: Double, py: Double): Pair<Double, Double> {
                    val trapScale = (1.0 + ctx.trap * (px - 0.5)).coerceAtLeast(0.01)
                    val xLocal    = cx + (px - 0.5) * w
                    val yLocal    = yBase + py * h * trapScale
                    return Pair(xLocal + hs * (1.0 - 2.0 * py), yLocal)
                }

                val sb = StringBuilder()
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
                if (ctx.customPathClosed) {
                    sb.append(" Z")
                    return ctx.cutPath(id, sb.toString())
                }
                // Open path → stroke (online) cut. Falls back to the regular cutPath if
                // no online callback was provided (preserves existing behaviour).
                return (ctx.cutPathOnline ?: ctx.cutPath).invoke(id, sb.toString())
            }

            return if (ctx.isDouble) {
                val ho = ctx.effectiveInlayDoubleOffset / 2.0
                when (ctx.doubleOrientation) {
                    InlayDoubleOrientation.HORIZONTAL -> listOf(
                        shape("${ctx.baseId}a", -ho, 0.0),
                        shape("${ctx.baseId}b", +ho, 0.0)
                    )
                    InlayDoubleOrientation.STAGGERED -> listOf(
                        shape("${ctx.baseId}a", -ho, -ho),
                        shape("${ctx.baseId}b", +ho, +ho)
                    )
                    else -> { // VERTICAL
                        val (dy1, dy2) = when (ctx.position) {
                            InlayPosition.TOP    -> Pair(0.0, ctx.effectiveInlayDoubleOffset)
                            InlayPosition.BOTTOM -> Pair(-ctx.effectiveInlayDoubleOffset, 0.0)
                            else                 -> Pair(-ho, +ho)
                        }
                        listOf(
                            shape("${ctx.baseId}a", 0.0, dy1),
                            shape("${ctx.baseId}b", 0.0, dy2)
                        )
                    }
                }
            } else {
                listOf(shape(ctx.baseId, 0.0, 0.0))
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
                val ho = ctx.effectiveInlayDoubleOffset / 2.0
                when (ctx.doubleOrientation) {
                    InlayDoubleOrientation.HORIZONTAL -> {
                        listOf(
                            diamond("${ctx.baseId}a", ctx.cx - ho, y), diamond("${ctx.baseId}b", ctx.cx + ho, y)
                        )
                    }
                    InlayDoubleOrientation.STAGGERED -> {
                        listOf(
                            diamond("${ctx.baseId}a", ctx.cx - ho, ctx.centerY - ho),
                            diamond("${ctx.baseId}b", ctx.cx + ho, ctx.centerY + ho)
                        )
                    }
                    else -> { // vertical
                        val (y1, y2) = when (ctx.position) {
                            InlayPosition.TOP -> Pair(y, y + ctx.effectiveInlayDoubleOffset)
                            InlayPosition.BOTTOM -> Pair(y - ctx.effectiveInlayDoubleOffset, y)
                            else -> Pair(ctx.centerY - ho, ctx.centerY + ho)
                        }
                        listOf(
                            diamond("${ctx.baseId}a", ctx.cx, y1), diamond("${ctx.baseId}b", ctx.cx, y2)
                        )
                    }
                }
            } else {
                listOf(diamond(ctx.baseId, ctx.cx, y))
            }
        }
    }
}
