package tv.blofy.player.ui.library

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
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
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.player.PlayerActivity

class RecentChannelsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(48, 34, 48, 36)
            background = AppCompatResources.getDrawable(this@RecentChannelsActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY LIVE"
            textSize = 12f
            letterSpacing = .11f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.RIGHT
        })
        root.addView(TextView(this).apply {
            text = "آخر القنوات"
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.RIGHT
            setPadding(0, 4, 0, 14)
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
                    setTextColor(BlofyTvDesign.TextMuted)
                    setPadding(0, 20, 0, 0)
                })
                return@launch
            }
            streams.forEach { stream ->
                val row = LinearLayout(this@RecentChannelsActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutDirection = View.LAYOUT_DIRECTION_RTL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(16, 8, 16, 8)
                    isFocusable = true; isFocusableInTouchMode = true; isClickable = true
                    background = rowBackground(false)
                    val logo = ImageView(this@RecentChannelsActivity).apply {
                        scaleType = ImageView.ScaleType.CENTER_INSIDE
                        setPadding(5, 5, 5, 5)
                        background = GradientDrawable().apply { cornerRadius = 12f; setColor(0xFF17111F.toInt()); setStroke(1, 0xFF49375E.toInt()) }
                    }
                    addView(logo, LinearLayout.LayoutParams(56, 56).apply { marginStart = 14 })
                    if (!stream.icon.isNullOrBlank()) ArtworkLoader.load(logo, stream.icon) else logo.setImageResource(R.drawable.blofy_logo)
                    addView(TextView(this@RecentChannelsActivity).apply {
                        text = stream.name
                        textSize = 17f
                        typeface = BlofyTvDesign.HeadingTypeface
                        setTextColor(BlofyTvDesign.TextPrimary)
                        gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL
                        maxLines = 1
                    }, LinearLayout.LayoutParams(0, 64, 1f))
                    addView(TextView(this@RecentChannelsActivity).apply {
                        text = "● مباشر"
                        textSize = 12f
                        typeface = BlofyTvDesign.BodyTypeface
                        setTextColor(BlofyTvDesign.Mint)
                        gravity = Gravity.CENTER
                    }, LinearLayout.LayoutParams(90, 64))
                    setOnFocusChangeListener { view, focused ->
                        view.background = rowBackground(focused)
                        view.animate().cancel()
                        view.animate().scaleX(if (focused) 1.015f else 1f).scaleY(if (focused) 1.015f else 1f).translationZ(if (focused) 9f else 1f).setDuration(75).start()
                    }
                    setOnClickListener {
                        val profile = ProviderProfile(providerKey = provider.id, liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                        startActivity(Intent(this@RecentChannelsActivity, PlayerActivity::class.java).apply {
                            putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream)); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(PlayerActivity.EXTRA_KIND, "live"); putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType); putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine); putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                            putExtra(PlayerActivity.EXTRA_CATEGORY_ID, stream.categoryId); putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                        })
                    }
                }
                root.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 78).apply { topMargin = 8 })
            }
            root.getChildAt(2)?.requestFocus()
        }
    }

    private fun rowBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF7139BE.toInt(), 0xFF402461.toInt()) else intArrayOf(0xFF241A34.toInt(), 0xFF18111F.toInt())
    ).apply {
        cornerRadius = 18f
        setStroke(if (focused) 2 else 1, if (focused) BlofyTvDesign.PurpleBright else 0xFF463455.toInt())
    }
}
