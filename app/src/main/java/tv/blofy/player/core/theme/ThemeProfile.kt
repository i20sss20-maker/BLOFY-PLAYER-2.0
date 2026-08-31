package tv.blofy.player.core.theme

import androidx.annotation.ColorInt

data class ThemeProfile(
    val id: String,
    val loginLayout: String,
    val homeLayout: String,
    @ColorInt val accent: Int,
    @ColorInt val background: Int,
    @ColorInt val surface: Int,
    val focusScale: Float = 1.008f,
    val focusElevationDp: Float = 8f,
    val motionMs: Long = 90L
)

object BlofyThemes {
    /**
     * Original BLOFY theme copied from the first NEXT project visual system.
     * Keep this profile stable: the current 2.0 playback/data engine must not
     * change the approved legacy look.
     */
    val ORIGINAL = ThemeProfile(
        id = "original",
        loginLayout = "blofy_login_original",
        homeLayout = "blofy_home_original",
        accent = 0xFF7C2BFF.toInt(),
        background = 0xFF05050C.toInt(),
        surface = 0xFF11101E.toInt(),
        focusScale = 1.008f,
        focusElevationDp = 8f,
        motionMs = 90L
    )

    // Compatibility aliases for code that still references the previous names.
    val VISION = ORIGINAL
    val CINEMA = ORIGINAL
}
