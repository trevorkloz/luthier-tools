package com.luthertools.fretcalculator.controller

import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping

@Controller
class WebController {

    @GetMapping("/")
    fun home(): String = "home"

    @GetMapping("/layout")
    fun layout(): String = "index"

    @GetMapping("/lighting")
    fun lighting(): String = "lighting"
}
