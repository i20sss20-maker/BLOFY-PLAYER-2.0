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
        accent = 0xFFA653FF.toInt(),
        background = 0xFF0D0A18.toInt(),
        surface = 0xFF21182F.toInt(),
        focusScale = 1.025f,
        focusElevationDp = 12f,
        motionMs = 85L
    )

    val CINEMA = ThemeProfile(
        id = "cinema",
        loginLayout = "blofy_login_cinema",
        homeLayout = "blofy_home_cinema",
        accent = 0xFFA653FF.toInt(),
        background = 0xFF0D0A18.toInt(),
        surface = 0xFF241A36.toInt(),
        focusScale = 1.025f,
        focusElevationDp = 12f,
        motionMs = 85L
    )
}
