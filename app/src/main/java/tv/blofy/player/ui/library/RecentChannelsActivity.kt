package tv.blofy.player.ui.library

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.RecentChannelStore
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.player.PlayerActivity

class RecentChannelsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 36, 48, 36)
            setBackgroundColor(Color.rgb(5, 5, 10))
        }
        root.addView(TextView(this).apply {
            text = "آخر القنوات"
            textSize = 28f
            setTextColor(Color.WHITE)
        })
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.providers().first().firstOrNull() ?: return@launch
            val keys = RecentChannelStore.keys(this@RecentChannelsActivity, provider.id)
            val streams = keys.mapNotNull { dao.stream(it) }
            if (streams.isEmpty()) {
                root.addView(TextView(this@RecentChannelsActivity).apply {
                    text = "لا توجد قنوات حديثة"
                    textSize = 17f
                    setTextColor(Color.LTGRAY)
                    setPadding(0, 20, 0, 0)
                })
                return@launch
            }
            streams.forEach { stream ->
                root.addView(TextView(this@RecentChannelsActivity).apply {
                    text = stream.name
                    textSize = 18f
                    setTextColor(Color.WHITE)
                    setPadding(20, 16, 20, 16)
                    isFocusable = true
                    setOnClickListener {
                        val profile = ProviderProfile(
                            providerKey = provider.id,
                            liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS
                        )
                        startActivity(Intent(this@RecentChannelsActivity, PlayerActivity::class.java).apply {
                            putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream))
                            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
                            putExtra(PlayerActivity.EXTRA_KIND, "live")
                            putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
                            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
                            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
                            putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                            putExtra(PlayerActivity.EXTRA_CATEGORY_ID, stream.categoryId)
                            putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                        })
                    }
                })
            }
            root.getChildAt(1)?.requestFocus()
        }
    }
}
