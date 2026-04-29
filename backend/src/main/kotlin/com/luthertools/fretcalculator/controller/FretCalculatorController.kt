package com.luthertools.fretcalculator.controller

import com.luthertools.fretcalculator.model.FretPosition
import com.luthertools.fretcalculator.model.FretRequest
import com.luthertools.fretcalculator.model.FretResponse
import com.luthertools.fretcalculator.model.InlayPreset
import com.luthertools.fretcalculator.service.FretCalculatorService
import com.luthertools.fretcalculator.service.SvgGeneratorService
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/frets")
class FretCalculatorController(
    private val fretCalculatorService: FretCalculatorService,
    private val svgGeneratorService: SvgGeneratorService,
) {

    @GetMapping("/inlay-presets")
    fun getInlayPresets(): ResponseEntity<List<InlayPreset>> =
        ResponseEntity.ok(SvgGeneratorService.INLAY_PRESETS)

    @PostMapping("/calculate")
    fun calculate(@RequestBody request: FretRequest): ResponseEntity<FretResponse> {
        val (positions, svg) = generateFretboardSvg(request)
        return ResponseEntity.ok(
            FretResponse(
                fretPositions = positions,
                svgContent = svg,
                unit = request.unit,
                scaleLength = request.scaleLength,
            )
        )
    }

    @PostMapping("/download", produces = ["image/svg+xml"])
    fun downloadSvg(@RequestBody request: FretRequest): ResponseEntity<String> {
        val (_, svg) = generateFretboardSvg(request)
        val filename = "fretboard-${request.scaleLength}${request.unit}-${request.numberOfFrets}frets.svg"
        return ResponseEntity.ok()
            .header("Content-Disposition", "attachment; filename=\"$filename\"")
            .contentType(MediaType.parseMediaType("image/svg+xml"))
            .body(svg)
    }

    @PostMapping("/inlays-sheet", produces = ["image/svg+xml"])
    fun inlaysSheet(@RequestBody request: FretRequest): ResponseEntity<String> {
        val positions = fretCalculatorService.calculateFretPositions(request.scaleLength, request.numberOfFrets)
        val svg       = svgGeneratorService.generateInlaysSheet(request, positions)
        val preset    = SvgGeneratorService.INLAY_PRESETS.find { it.id == request.inlayShape }?.name ?: "inlays"
        return ResponseEntity.ok()
            .header("Content-Disposition", "attachment; filename=\"inlays-sheet-${request.scaleLength}${request.unit}-${preset}.svg\"")
            .contentType(MediaType.parseMediaType("image/svg+xml"))
            .body(svg)
    }

    private fun generateFretboardSvg(request: FretRequest): Pair<List<FretPosition>, String> {
        val positions = fretCalculatorService.calculateFretPositions(request.scaleLength, request.numberOfFrets)
        return positions to svgGeneratorService.generateSvg(request, positions)
    }
}
