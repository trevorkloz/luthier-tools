package com.luthertools.fretcalculator.controller

import com.luthertools.fretcalculator.model.LightingRequest
import com.luthertools.fretcalculator.model.LightingResponse
import com.luthertools.fretcalculator.service.FretCalculatorService
import com.luthertools.fretcalculator.service.SvgGeneratorService
import com.luthertools.fretcalculator.service.doubleFrets
import com.luthertools.fretcalculator.service.inlayFrets
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/lighting")
class LightingController(
    private val fretCalculatorService: FretCalculatorService,
    private val svgGeneratorService: SvgGeneratorService,
) {

    @PostMapping("/generate")
    fun generate(@RequestBody request: LightingRequest): ResponseEntity<LightingResponse> {
        val positions = fretCalculatorService.calculateFretPositions(request.scaleLength, request.numberOfFrets)
        val svg = svgGeneratorService.generateLightingSvg(request, positions)
        val chCount = inlayFrets
            .filter { f -> positions.any { it.fretNumber == f } }
            .fold(0) { acc, f -> acc + if (f in doubleFrets) 2 else 1 }
        val totalLen = positions
            .filter { it.fretNumber in inlayFrets }
            .sumOf { fp ->
                val prevDist = positions.find { it.fretNumber == fp.fretNumber - 1 }?.distanceFromNut ?: 0.0
                request.scaleLength - (prevDist + fp.distanceFromNut) / 2.0
            }
        return ResponseEntity.ok(
            LightingResponse(
                svgContent         = svg,
                channelCount       = chCount,
                totalChannelLength = totalLen,
                unit               = request.unit,
                scaleLength        = request.scaleLength,
            )
        )
    }
}
