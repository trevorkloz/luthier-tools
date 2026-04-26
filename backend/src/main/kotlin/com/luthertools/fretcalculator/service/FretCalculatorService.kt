package com.luthertools.fretcalculator.service

import com.luthertools.fretcalculator.model.FretPosition
import org.springframework.stereotype.Service
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.pow

@Service
class FretCalculatorService {

    fun calculateFretPositions(scaleLength: Double, numberOfFrets: Int): List<FretPosition> {
        val positions = mutableListOf<FretPosition>()
        var previousPosition = 0.0

        for (i in 1..numberOfFrets) {
            // Equal temperament: position = scaleLength × (1 - 2^(-n/12))
            val distanceFromNut = scaleLength * (1.0 - 2.0.pow(-i.toDouble() / 12.0))
            val distanceFromPrevious = distanceFromNut - previousPosition
            positions.add(
                FretPosition(
                    fretNumber = i,
                    distanceFromNut = distanceFromNut.round4(),
                    distanceFromPreviousFret = distanceFromPrevious.round4(),
                )
            )
            previousPosition = distanceFromNut
        }

        return positions
    }
}

private fun Double.round4(): Double =
    BigDecimal(this).setScale(4, RoundingMode.HALF_UP).toDouble()
