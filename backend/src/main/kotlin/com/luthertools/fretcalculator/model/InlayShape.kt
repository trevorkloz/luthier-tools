package com.luthertools.fretcalculator.model

import com.fasterxml.jackson.annotation.JsonCreator
import com.fasterxml.jackson.annotation.JsonValue

enum class InlayShape(val id: String) {

    CIRCLE("circle"),
    RECTANGLE("rectangle"),
    DIAMOND("diamond"),
    CUSTOM("custom");

    @JsonValue fun toValue() = id

    companion object {
        @JsonCreator @JvmStatic
        fun fromValue(v: String) = entries.first { it.id == v }
    }
}
