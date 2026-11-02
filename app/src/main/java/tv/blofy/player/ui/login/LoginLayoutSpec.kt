package tv.blofy.player.ui.login

/**
 * Pure window-size rules for pairing cards. Keep the QR square and the playlist rows usable
 * on 540dp Android TV boxes, larger televisions, and narrow phones.
 */
internal object LoginLayoutSpec {
    fun tvQrSizeDp(heightDp: Int): Int =
        if (heightDp <= 600) (heightDp - 405).coerceIn(128, 166)
        else (heightDp - 360).coerceIn(180, 220)

    fun phoneQrSizeDp(widthDp: Int): Int =
        ((widthDp - 48).coerceAtLeast(0) * 0.58f).toInt().coerceIn(156, 208)

    fun tvPlaylistRowHeightDp(heightDp: Int): Int = if (heightDp <= 600) 72 else 84

    fun tvActivationWeight(widthDp: Int): Float = if (widthDp <= 1000) 0.44f else 0.40f
}
