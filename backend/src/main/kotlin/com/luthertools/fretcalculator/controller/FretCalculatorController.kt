package com.luthertools.fretcalculator.controller

import com.luthertools.fretcalculator.model.FretPosition
import com.luthertools.fretcalculator.model.FretRequest
import com.luthertools.fretcalculator.model.FretResponse
import com.luthertools.fretcalculator.model.InlayPreset
import com.luthertools.fretcalculator.model.InstrumentPreset
import com.luthertools.fretcalculator.model.RadiusPreset
import com.luthertools.fretcalculator.model.StringPreset
import com.luthertools.fretcalculator.service.FretCalculatorService
import com.luthertools.fretcalculator.service.SVG_MARGIN_H
import com.luthertools.fretcalculator.service.SvgGeneratorService
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/fretboard")
class FretCalculatorController(
    private val fretCalculatorService: FretCalculatorService,
    private val svgGeneratorService: SvgGeneratorService,
) {

    // ── Presets ──────────────────────────────────────────────────────────────

    @GetMapping("/presets/inlays")
    fun presetsInlays(): ResponseEntity<List<InlayPreset>> =
        ResponseEntity.ok(SvgGeneratorService.INLAY_PRESETS)

    @GetMapping("/presets/instruments")
    fun presetsInstruments(): ResponseEntity<List<InstrumentPreset>> =
        ResponseEntity.ok(InstrumentPreset.ALL)

    @GetMapping("/presets/strings")
    fun presetsStrings(): ResponseEntity<List<Map<String, Any>>> =
        ResponseEntity.ok(StringPreset.entries.map {
            mapOf(
                "id" to it.name,
                "label" to it.label,
                "numStrings" to it.gaugesIn.size
            )
        })

    @GetMapping("/presets/radius")
    fun presetsRadius(): ResponseEntity<List<RadiusPreset>> =
        ResponseEntity.ok(RadiusPreset.ALL)

    // ── Generation ───────────────────────────────────────────────────────────

    @PostMapping("/generate")
    fun generate(@RequestBody request: FretRequest): ResponseEntity<FretResponse> {
        val (positions, svg) = generateFretboardSvg(request)
        val nutSlotW = if (request.showNutSlot) request.nutSlotWidth else 0.0
        val nutOffsetMm = maxOf(SVG_MARGIN_H, nutSlotW - request.nutSlotDistance + 2.0)
        return ResponseEntity.ok(
            FretResponse(
                fretPositions = positions,
                svgContent = svg,
                unit = request.unit,
                scaleLength = request.scaleLength,
                nutOffsetMm = nutOffsetMm,
            )
        )
    }

    @PostMapping("/generate/frets-only", produces = ["image/svg+xml"])
    fun generateFretsOnly(@RequestBody request: FretRequest): ResponseEntity<String> {
        val (_, svg) = generateFretboardSvg(
            request.copy(
                showInlays = false,
                showBoundingBox = true,
                showFretNumbers = false,
                showCenterLine = true,
                showWidthAnnotations = false,
                showRadius = false,
                stringPreset = StringPreset.NONE,
            )
        )
        val filename = "fretboard-${request.scaleLength}${request.unit}-${request.numberOfFrets}frets.svg"
        return ResponseEntity.ok()
            .header("Content-Disposition", "attachment; filename=\"$filename\"")
            .contentType(MediaType.parseMediaType("image/svg+xml"))
            .body(svg)
    }

    @PostMapping("/generate/inlays-only", produces = ["image/svg+xml"])
    fun generateInlaysOnly(@RequestBody request: FretRequest): ResponseEntity<String> {
        val positions = fretCalculatorService.calculateFretPositions(request)
        val svg = svgGeneratorService.generateInlaysSheet(request, positions)
        val preset = SvgGeneratorService.INLAY_PRESETS.find { it.id == request.inlayShape }?.name ?: "inlays"
        return ResponseEntity.ok()
            .header(
                "Content-Disposition",
                "attachment; filename=\"inlays-sheet-${request.scaleLength}${request.unit}-${preset}.svg\""
            )
            .contentType(MediaType.parseMediaType("image/svg+xml"))
            .body(svg)
    }

    private fun generateFretboardSvg(request: FretRequest): Pair<List<FretPosition>, String> {
        val positions = fretCalculatorService.calculateFretPositions(request)
        return positions to svgGeneratorService.generateSvg(request, positions)
    }
}
