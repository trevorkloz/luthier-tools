package com.luthertools.fretcalculator.service

import com.luthertools.fretcalculator.model.FretPosition
import com.luthertools.fretcalculator.model.FretRequest
import org.springframework.stereotype.Service
import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.pow

@Service
class FretCalculatorService {

    fun calculateFretPositions(request: FretRequest): List<FretPosition> =
        if (request.multiscale)
            calculateFanFretPositions(request)
        else
            calculateFretPositions(request.scaleLength, request.numberOfFrets)

    fun calculateFretPositions(scaleLength: Double, numberOfFrets: Int): List<FretPosition> {
        val positions = mutableListOf<FretPosition>()
        var previousPosition = 0.0

        for (i in 1..numberOfFrets) {
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

    // Multiscale: scale lengths are interpolated linearly from treble (string 0) to bass (string N-1).
    // Center string (midpoint) is used for distanceFromNut and inlay positions.
    // xOffsetTreble / xOffsetBass are x-offsets from x_perp (the perpendicular fret anchor).
    private fun calculateFanFretPositions(request: FretRequest): List<FretPosition> {
        val sl = request.scaleLength       // center scale (used for fret table distances)
        val slT = request.trebleScaleLength
        val slB = request.bassScaleLength
        val P   = request.perpendicularFret

        // Factor shared by all per-string calculations: fret-n offset from x_perp = S * (2^(-P/12) - 2^(-n/12))
        fun xOffset(scaleLen: Double, fretN: Int): Double =
            scaleLen * (2.0.pow(-P.toDouble() / 12.0) - 2.0.pow(-fretN.toDouble() / 12.0))

        // Nut offsets from x_perp (fret 0)
        fun nutOffset(scaleLen: Double): Double =
            scaleLen * (2.0.pow(-P.toDouble() / 12.0) - 1.0)  // negative = left of x_perp

        val positions = mutableListOf<FretPosition>()
        var previousCenter = 0.0

        // Fret 0 = nut: represented by the controller as the start; not in positions list.
        // Positions list starts at fret 1.
        for (i in 1..request.numberOfFrets) {
            val distCenter = sl * (1.0 - 2.0.pow(-i.toDouble() / 12.0))
            val distFromPrev = distCenter - previousCenter

            // x_perp is placed such that x_nut(bass) = x0 (left margin).
            // x_offset = signed offset from x_perp for this fret on treble/bass string.
            val offT = xOffset(slT, i)
            val offB = xOffset(slB, i)

            positions.add(
                FretPosition(
                    fretNumber = i,
                    distanceFromNut = distCenter.round4(),
                    distanceFromPreviousFret = distFromPrev.round4(),
                    xOffsetTreble = offT.round4(),
                    xOffsetBass   = offB.round4(),
                )
            )
            previousCenter = distCenter
        }

        return positions
    }
}

private fun Double.round4(): Double =
    BigDecimal(this).setScale(4, RoundingMode.HALF_UP).toDouble()
