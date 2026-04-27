package com.luthertools.fretcalculator.model

sealed class InlayPreset(
    val id: InlayShape,
    val name: String,
) {
    abstract fun draw(ctx: InlayShapeCtx): List<String>

    data object Circle : InlayPreset(InlayShape.CIRCLE, "Circle") {
        override fun draw(ctx: InlayShapeCtx): List<String> {
            val r = ctx.effectiveSize / 2.0
            fun circle(id: String, cx: Double, cy: Double): String {
                val d =
                    "M ${ctx.f(cx - r)} ${ctx.f(cy)} " + "A ${ctx.f(r)} ${ctx.f(r)} 0 1 0 ${ctx.f(cx + r)} ${ctx.f(cy)} " + "A ${
                        ctx.f(r)
                    } ${ctx.f(r)} 0 1 0 ${ctx.f(cx - r)} ${ctx.f(cy)} Z"
                return ctx.pocketPath(id, d)
            }

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
            val hw = ctx.effectiveSize / 2.0
            val h = ctx.effectiveHeight
            val tr = ctx.trap
            fun rect(id: String, cx: Double, d: Double, dy: Double = 0.0): String {
                val dL = d - hw;
                val dR = d + hw
                val xL = cx - hw;
                val xR = cx + hw
                return when (ctx.position) {
                    InlayPosition.TOP -> {
                        val hL = (h * (1.0 - tr * 0.5)).coerceAtLeast(0.01)
                        val hR = h * (1.0 + tr * 0.5)
                        ctx.pocketPath(
                            id,
                            "M ${ctx.f(xL)} ${ctx.f(ctx.yTop(dL) + dy)} " + "L ${ctx.f(xR)} ${ctx.f(ctx.yTop(dR) + dy)} " + "L ${
                                ctx.f(xR)
                            } ${ctx.f(ctx.yTop(dR) + hR + dy)} " + "L ${ctx.f(xL)} ${ctx.f(ctx.yTop(dL) + hL + dy)} Z"
                        )
                    }

                    InlayPosition.BOTTOM -> {
                        val hL = (h * (1.0 - tr * 0.5)).coerceAtLeast(0.01)
                        val hR = h * (1.0 + tr * 0.5)
                        ctx.pocketPath(
                            id, "M ${ctx.f(xL)} ${ctx.f(ctx.yBottom(dL) - hL + dy)} " + "L ${ctx.f(xR)} ${
                                ctx.f(
                                    ctx.yBottom(dR) - hR + dy
                                )
                            } " + "L ${ctx.f(xR)} ${ctx.f(ctx.yBottom(dR) + dy)} " + "L ${ctx.f(xL)} ${
                                ctx.f(
                                    ctx.yBottom(dL) + dy
                                )
                            } Z"
                        )
                    }

                    else -> {
                        val hhL = (h / 2.0 * (1.0 - tr * 0.5)).coerceAtLeast(0.01)
                        val hhR = h / 2.0 * (1.0 + tr * 0.5)
                        ctx.pocketPath(
                            id,
                            "M ${ctx.f(xL)} ${ctx.f(ctx.centerY - hhL + dy)} " + "L ${ctx.f(xR)} ${ctx.f(ctx.centerY - hhR + dy)} " + "L ${
                                ctx.f(xR)
                            } ${ctx.f(ctx.centerY + hhR + dy)} " + "L ${ctx.f(xL)} ${ctx.f(ctx.centerY + hhL + dy)} Z"
                        )
                    }
                }
            }
            return if (ctx.isDouble) {
                val ho = ctx.effectiveInlayDoubleOffset / 2.0
                if (ctx.doubleOrientation == InlayDoubleOrientation.HORIZONTAL) {
                    listOf(
                        rect("${ctx.baseId}a", ctx.cx - ho, ctx.midDist - ho),
                        rect("${ctx.baseId}b", ctx.cx + ho, ctx.midDist + ho)
                    )
                } else { // vertical
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
            } else {
                listOf(rect(ctx.baseId, ctx.cx, ctx.midDist))
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
                return ctx.pocketPath(id, d)
            }

            return if (ctx.isDouble) {
                val ho = ctx.effectiveInlayDoubleOffset / 2.0
                if (ctx.doubleOrientation == InlayDoubleOrientation.HORIZONTAL) {
                    listOf(
                        diamond("${ctx.baseId}a", ctx.cx - ho, y), diamond("${ctx.baseId}b", ctx.cx + ho, y)
                    )
                } else { // vertical
                    val (y1, y2) = when (ctx.position) {
                        InlayPosition.TOP -> Pair(y, y + ctx.effectiveInlayDoubleOffset)
                        InlayPosition.BOTTOM -> Pair(y - ctx.effectiveInlayDoubleOffset, y)
                        else -> Pair(ctx.centerY - ho, ctx.centerY + ho)
                    }
                    listOf(
                        diamond("${ctx.baseId}a", ctx.cx, y1), diamond("${ctx.baseId}b", ctx.cx, y2)
                    )
                }
            } else {
                listOf(diamond(ctx.baseId, ctx.cx, y))
            }
        }
    }
}
