package com.luthertools.fretcalculator.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue

enum class Unit(val label: String) {
    MM("mm"),
    INCH("inch");

    @JsonValue fun toValue() = label

    companion object {
        @JsonCreator @JvmStatic
        fun fromValue(v: String) = entries.first { it.label == v }
    }
}
