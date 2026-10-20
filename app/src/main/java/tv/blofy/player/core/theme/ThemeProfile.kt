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
        accent = 0xFFB99152.toInt(),
        background = 0xFF08080B.toInt(),
        surface = 0xFF1A1518.toInt(),
        focusScale = 1.025f,
        focusElevationDp = 12f,
        motionMs = 85L
    )

    val CINEMA = ThemeProfile(
        id = "cinema",
        loginLayout = "blofy_login_cinema",
        homeLayout = "blofy_home_cinema",
        accent = 0xFFF2D28B.toInt(),
        background = 0xFF08080B.toInt(),
        surface = 0xFF241B1F.toInt(),
        focusScale = 1.025f,
        focusElevationDp = 12f,
        motionMs = 85L
    )
}
