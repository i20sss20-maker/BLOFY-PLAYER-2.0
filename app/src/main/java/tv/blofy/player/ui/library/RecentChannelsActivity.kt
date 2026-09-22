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
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning
import tv.blofy.player.ui.player.PlayerActivity

class RecentChannelsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(48), dp(34), dp(48), dp(36))
            background = AppCompatResources.getDrawable(this@RecentChannelsActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY LIVE"
            textSize = 12f
            letterSpacing = .11f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.home_recent_channels)
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START
            setPadding(0, dp(4), 0, dp(14))
        })
        val list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(list)
        }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.providers().first().firstOrNull() ?: return@launch
            val keys = RecentChannelStore.keys(this@RecentChannelsActivity, provider.id)
            val streams = keys.mapNotNull { dao.stream(it) }
            if (streams.isEmpty()) {
                list.addView(TextView(this@RecentChannelsActivity).apply {
                    text = getString(R.string.recent_channels_empty)
                    textSize = 17f
                    setTextColor(BlofyTvDesign.TextMuted)
                    setPadding(0, dp(20), 0, 0)
                })
                return@launch
            }
            streams.forEach { stream ->
                val row = LinearLayout(this@RecentChannelsActivity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutDirection = resources.configuration.layoutDirection
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(16), dp(8), dp(16), dp(8))
                    isFocusable = true; isFocusableInTouchMode = true; isClickable = true
                    background = rowBackground(false)
                    val logo = ImageView(this@RecentChannelsActivity).apply {
                        scaleType = ImageView.ScaleType.CENTER_INSIDE
                        setPadding(dp(5), dp(5), dp(5), dp(5))
                        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(0xFF17111F.toInt()); setStroke(dp(1), 0xFF49375E.toInt()) }
                    }
                    addView(logo, LinearLayout.LayoutParams(dp(56), dp(56)).apply { marginStart = dp(14) })
                    if (!stream.icon.isNullOrBlank() || !stream.backdrop.isNullOrBlank()) ArtworkLoader.load(logo, listOf(stream.icon, stream.backdrop)) else logo.setImageResource(R.drawable.blofy_logo)
                    addView(TextView(this@RecentChannelsActivity).apply {
                        text = stream.name
                        textSize = 17f
                        typeface = BlofyTvDesign.HeadingTypeface
                        setTextColor(BlofyTvDesign.TextPrimary)
                        gravity = Gravity.START or Gravity.CENTER_VERTICAL
                        maxLines = 1
                    }, LinearLayout.LayoutParams(0, dp(64), 1f))
                    addView(TextView(this@RecentChannelsActivity).apply {
                        text = getString(R.string.recent_channels_live)
                        textSize = 12f
                        typeface = BlofyTvDesign.BodyTypeface
                        setTextColor(BlofyTvDesign.Mint)
                        gravity = Gravity.CENTER
                    }, LinearLayout.LayoutParams(dp(90), dp(64)))
                    setOnFocusChangeListener { view, focused ->
                        view.background = rowBackground(focused)
                        view.animate().cancel()
                        val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.012f) else 1f
                        view.animate()
                            .scaleX(targetScale)
                            .scaleY(targetScale)
                            .translationZ(if (focused) TvUiTuning.focusElevation(view.context, dp(9).toFloat()) else 0f)
                            .setDuration(TvUiTuning.focusDuration(view.context, focused))
                            .start()
                    }
                    setOnClickListener {
                        val profile = ProviderProfile(providerKey = provider.id, liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                        startActivity(Intent(this@RecentChannelsActivity, PlayerActivity::class.java).apply {
                            putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream)); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(PlayerActivity.EXTRA_KIND, "live"); putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType); putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine); putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, ArrayList(ContentUrlResolver.recoveryUrls(stream))); putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId)
                            putExtra(PlayerActivity.EXTRA_CATEGORY_ID, stream.categoryId); putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                        })
                    }
                }
                list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(78)).apply { topMargin = dp(8) })
            }
            list.getChildAt(0)?.requestFocus()
        }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun rowBackground(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF7139BE.toInt(), 0xFF402461.toInt()) else intArrayOf(0xFF241A34.toInt(), 0xFF18111F.toInt())
    ).apply {
        cornerRadius = dp(18).toFloat()
        setStroke(dp(if (focused) 2 else 1), if (focused) BlofyTvDesign.FocusStroke else 0xFF463455.toInt())
    }
}
