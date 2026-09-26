package tv.blofy.player.core.theme

import androidx.annotation.ColorInt

data class ThemeProfile(
    val id: String,
    val loginLayout: String,
    val homeLayout: String,
    @ColorInt val accent: Int,
    @ColorInt val background: Int,
    @ColorInt val surface: Int,
    val focusScale: Float = 1.055f,
    val focusElevationDp: Float = 18f,
    val motionMs: Long = 115L
)

object BlofyThemes {
    val VISION = ThemeProfile(
        id = "vision",
        loginLayout = "blofy_login_vision",
        homeLayout = "blofy_home_vision",
        accent = 0xFF8F44FF.toInt(),
        background = 0xFF06040B.toInt(),
        surface = 0xFF140D1F.toInt()
    )

    val CINEMA = ThemeProfile(
        id = "cinema",
        loginLayout = "blofy_login_cinema",
        homeLayout = "blofy_home_cinema",
        accent = 0xFFBD77FF.toInt(),
        background = 0xFF050309.toInt(),
        surface = 0xFF1A1028.toInt(),
        focusScale = 1.045f,
        focusElevationDp = 20f,
        motionMs = 120L
    )
}
