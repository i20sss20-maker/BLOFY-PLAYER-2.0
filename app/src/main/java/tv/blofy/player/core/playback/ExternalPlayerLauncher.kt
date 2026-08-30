package tv.blofy.player.core.playback

import android.content.Context
import android.content.Intent
import android.net.Uri

object ExternalPlayerLauncher {
    fun launch(context: Context, url: String, title: String? = null): Boolean {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(Uri.parse(url), "video/*")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            title?.takeIf { it.isNotBlank() }?.let { putExtra(Intent.EXTRA_TITLE, it) }
        }
        val resolved = intent.resolveActivity(context.packageManager) ?: return false
        context.startActivity(Intent.createChooser(intent, "تشغيل بواسطة").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return resolved != null
    }
}
