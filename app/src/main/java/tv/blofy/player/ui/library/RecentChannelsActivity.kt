package tv.blofy.player.ui.library

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.R
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.RecentChannelStore
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.player.PlayerActivity

class RecentChannelsActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(34), dp(28), dp(34), dp(30))
            background = AppCompatResources.getDrawable(this@RecentChannelsActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }
        root.addView(TextView(this).apply {
            text = "آخر القنوات"
            BlofyTvDesign.applyTitle(this)
            setPadding(dp(4), 0, 0, dp(12))
        })

        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(2), 0, dp(24))
            clipChildren = false
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            addView(list)
        }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.providers().first().firstOrNull() ?: run {
                showMessage("أضف قائمة تشغيل أولاً")
                return@launch
            }
            val keys = RecentChannelStore.keys(this@RecentChannelsActivity, provider.id)
            val streams = keys.mapNotNull { dao.stream(it) }
            if (streams.isEmpty()) {
                showMessage("لا توجد قنوات حديثة")
                return@launch
            }
            streams.forEach { stream -> addChannel(provider, stream) }
            list.getChildAt(0)?.requestFocus()
        }
    }

    private fun addChannel(provider: ProviderEntity, stream: StreamEntity) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(14), dp(9), dp(14), dp(9))
            isFocusable = true
            isClickable = true
            background = rowBackground(false)
            setOnFocusChangeListener { view, focused ->
                view.background = rowBackground(focused)
                view.animate().cancel()
                view.animate()
                    .scaleX(if (focused) 1.018f else 1f)
                    .scaleY(if (focused) 1.018f else 1f)
                    .translationZ(if (focused) 10f else 0f)
                    .setDuration(90)
                    .start()
            }
            setOnClickListener { openChannel(provider, stream) }
        }

        val logo = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(BlofyTvDesign.Surface)
        }
        ArtworkLoader.load(logo, stream.icon)
        row.addView(logo, LinearLayout.LayoutParams(dp(58), dp(58)).apply { marginStart = dp(14) })

        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT
        }
        info.addView(TextView(this).apply {
            text = stream.name
            textSize = 18f
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT
            maxLines = 1
        })
        info.addView(TextView(this).apply {
            text = "بث مباشر  •  اضغط للمشاهدة"
            textSize = 12.5f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.RIGHT
            setPadding(0, dp(4), 0, 0)
        })
        row.addView(info, LinearLayout.LayoutParams(0, dp(60), 1f))
        list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(78)).apply {
            bottomMargin = dp(8)
        })
    }

    private fun openChannel(provider: ProviderEntity, stream: StreamEntity) {
        val profile = ProviderProfile(
            providerKey = provider.id,
            liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS
        )
        startActivity(Intent(this, PlayerActivity::class.java).apply {
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

    private fun showMessage(message: String) {
        list.removeAllViews()
        list.addView(TextView(this).apply {
            text = message
            textSize = 17f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
            setPadding(0, dp(30), 0, dp(30))
        })
    }

    private fun rowBackground(focused: Boolean) = BlofyTvDesign.surface(dp(18).toFloat(), focused)\n\n    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
