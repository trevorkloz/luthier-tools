package com.luthertools.fretcalculator

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class FretCalculatorApplication

fun main(args: Array<String>) {
    runApplication<FretCalculatorApplication>(*args)
}
