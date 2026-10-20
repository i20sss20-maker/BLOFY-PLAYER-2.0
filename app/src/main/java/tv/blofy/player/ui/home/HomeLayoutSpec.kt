package tv.blofy.player.ui.home

/** Uses the current window so a tablet in split screen receives the compact layout. */
internal data class HomeLayoutSpec(val width: Int, val height: Int, val remote: Boolean) {
    val compact = !remote && width < 600
    val gutter = if (compact) 16 else if (remote) 20 else 18
    val railWidth = if (remote) 124 else 136
    val railRowHeight = if (remote) ((height - 116) / 8 - 6).coerceIn(30, 36) else 48
    val posterWidth = when {
        compact -> ((width - gutter * 2 - 25) / 3f).toInt().coerceIn(98, 142)
        remote -> ((width - gutter * 2 - railWidth - 22 - 10) / 5 - 12).coerceAtLeast(88)
        width < 1000 -> 122
        else -> 140
    }
    val heroHeight = when {
        compact -> (height * .62f).toInt().coerceIn(360, 490)
        remote && height <= 600 -> (height * .46f).toInt().coerceIn(220, 250)
        remote -> (height * .50f).toInt().coerceIn(310, 400)
        else -> 324
    }
    val actionHeight = if (remote) 36 else 52
}
