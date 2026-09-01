package tv.blofy.player.core.theme

import androidx.annotation.ColorInt

data class ThemeProfile(
    val id: String,
    val loginLayout: String,
    val homeLayout: String,
    @ColorInt val accent: Int,
    @ColorInt val background: Int,
    @ColorInt val surface: Int,
    val focusScale: Float = 1.06f,
    val focusElevationDp: Float = 14f,
    val motionMs: Long = 130L
)

object BlofyThemes {
    val VISION = ThemeProfile(
        id = "vision",
        loginLayout = "blofy_login_vision",
        homeLayout = "blofy_home_vision",
        accent = 0xFF8B37FF.toInt(),
        background = 0xFF07070D.toInt(),
        surface = 0xFF12101D.toInt()
    )

    val CINEMA = ThemeProfile(
        id = "cinema",
        loginLayout = "blofy_login_cinema",
        homeLayout = "blofy_home_cinema",
        accent = 0xFFA84FFF.toInt(),
        background = 0xFF05040A.toInt(),
        surface = 0xFF171125.toInt(),
        focusScale = 1.05f
    )
}
