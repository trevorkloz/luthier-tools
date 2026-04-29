package com.luthertools.fretcalculator.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue

enum class InlayDoubleOrientation(val value: String) {
    VERTICAL("vertical"),
    HORIZONTAL("horizontal"),
    STAGGERED("staggered");

    @JsonValue fun toValue() = value

    companion object {
        @JsonCreator @JvmStatic
        fun fromValue(v: String) = entries.first { it.value == v }
    }
}
