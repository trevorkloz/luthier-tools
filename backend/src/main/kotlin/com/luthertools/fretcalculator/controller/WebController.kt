package com.luthertools.fretcalculator.controller

import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping

@Controller
class WebController {

    @GetMapping("/")
    fun index(): String = "index"

    @GetMapping("/lighting")
    fun lighting(): String = "lighting"
}
