package tv.blofy.player.benchmark

import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@LargeTest
class StartupBenchmark {
    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

    @Test
    fun coldStartup() = benchmarkRule.measureRepeated(
        packageName = PACKAGE_NAME,
        metrics = listOf(StartupTimingMetric()),
        compilationMode = CompilationMode.Partial(
            baselineProfileMode = CompilationMode.Partial.BaselineProfileMode.Require
        ),
        startupMode = StartupMode.COLD,
        iterations = 8,
        setupBlock = { pressHome() }
    ) {
        startActivityAndWait()
        device.waitForIdle()
    }

    private companion object {
        const val PACKAGE_NAME = "tv.blofy.player.v2"
    }
}
