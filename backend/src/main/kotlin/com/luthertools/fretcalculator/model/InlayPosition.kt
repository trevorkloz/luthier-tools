package com.luthertools.fretcalculator.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue

enum class InlayPosition(val value: String) {
    CENTER("center"),
    TOP("top"),
    BOTTOM("bottom");

    @JsonValue fun toValue() = value

    companion object {
        @JsonCreator @JvmStatic
        fun fromValue(v: String) = entries.first { it.value == v }
    }
}
