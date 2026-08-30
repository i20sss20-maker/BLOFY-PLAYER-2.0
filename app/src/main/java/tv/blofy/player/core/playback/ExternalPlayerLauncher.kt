package tv.blofy.player.core.playback

import android.content.Context
import android.content.Intent
import android.net.Uri

object ExternalPlayerLauncher {
    private val preferredPackages = listOf(
        "org.videolan.vlc",
        "com.mxtech.videoplayer.ad",
        "com.mxtech.videoplayer.pro"
    )

    fun launchPreferred(context: Context, url: String, title: String? = null): Boolean {
        preferredPackages.forEach { packageName ->
            val intent = baseIntent(url, title).setPackage(packageName)
            if (intent.resolveActivity(context.packageManager) != null) {
                context.startActivity(intent)
                return true
            }
        }
        return launch(context, url, title)
    }

    fun launch(context: Context, url: String, title: String? = null): Boolean {
        val intent = baseIntent(url, title)
        val resolved = intent.resolveActivity(context.packageManager) ?: return false
        context.startActivity(Intent.createChooser(intent, "تشغيل بواسطة").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return resolved != null
    }

    private fun baseIntent(url: String, title: String?) = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(url), "video/*")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        title?.takeIf { it.isNotBlank() }?.let { putExtra(Intent.EXTRA_TITLE, it) }
    }
}
