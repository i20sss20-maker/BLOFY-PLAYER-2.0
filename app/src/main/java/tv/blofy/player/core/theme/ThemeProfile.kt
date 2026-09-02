package tv.blofy.player.core.theme

import androidx.annotation.ColorInt

data class ThemeProfile(
    val id: String,
    val loginLayout: String,
    val homeLayout: String,
    @ColorInt val accent: Int,
    @ColorInt val background: Int,
    @ColorInt val surface: Int,
    val focusScale: Float = 1.05f,
    val focusElevationDp: Float = 12f,
    val motionMs: Long = 110L
)

object BlofyThemes {
    val VISION = ThemeProfile(
        id = "vision",
        loginLayout = "blofy_login_vision",
        homeLayout = "blofy_home_vision",
        accent = 0xFF682ACC.toInt(),
        background = 0xFFF5F5F8.toInt(),
        surface = 0xFFFFFFFF.toInt(),
        focusScale = 1.035f,
        focusElevationDp = 12f,
        motionMs = 95L
    )

    val CINEMA = ThemeProfile(
        id = "cinema",
        loginLayout = "blofy_login_cinema",
        homeLayout = "blofy_home_cinema",
        accent = 0xFF8245E1.toInt(),
        background = 0xFFF8F7FA.toInt(),
        surface = 0xFFFCFBFE.toInt(),
        focusScale = 1.035f,
        focusElevationDp = 12f,
        motionMs = 95L
    )
}
