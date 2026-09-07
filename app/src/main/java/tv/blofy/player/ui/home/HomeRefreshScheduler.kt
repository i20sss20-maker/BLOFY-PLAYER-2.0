package tv.blofy.player.ui.home

import android.os.Handler

/** One clock loop and one hero loop, owned by the visible Home screen. */
internal class HomeRefreshScheduler(
    private val handler: Handler,
    private val clockIntervalMs: Long,
    private val heroIntervalMs: Long,
    private val refreshClock: () -> Unit,
    private val rotateHero: () -> Unit,
) {
    private var running = false
    private val clock = object : Runnable {
        override fun run() {
            if (!running) return
            refreshClock()
            if (running) handler.postDelayed(this, clockIntervalMs)
        }
    }
    private val hero = object : Runnable {
        override fun run() {
            if (!running) return
            rotateHero()
            if (running) handler.postDelayed(this, heroIntervalMs)
        }
    }

    fun start() {
        if (running) return
        running = true
        handler.post(clock)
        handler.postDelayed(hero, heroIntervalMs)
    }

    fun restartHero() {
        handler.removeCallbacks(hero)
        if (running) handler.postDelayed(hero, heroIntervalMs)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(clock)
        handler.removeCallbacks(hero)
    }
}
