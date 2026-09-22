package tv.blofy.player.ui.catchup

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import tv.blofy.player.core.security.ContentAccessActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.playback.CatchupUrlResolver
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpgEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.common.TvUiTuning
import tv.blofy.player.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CatchupActivity : ContentAccessActivity() {
    private lateinit var list: LinearLayout
    private lateinit var status: TextView

    override fun onContentReady(savedInstanceState: Bundle?) {
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) { finish(); return }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(46), dp(34), dp(46), dp(34))
            background = AppCompatResources.getDrawable(this@CatchupActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.catchup_title)
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.TextPrimary)
        })
        status = TextView(this).apply {
            text = getString(R.string.catchup_loading)
            textSize = 15f
            typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.PurpleSoft)
            setPadding(0, dp(5), 0, dp(18))
        }
        root.addView(status)
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(list)
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            if (!stream.archiveEnabled || provider.providerType.equals("m3u", true)) {
                status.setText(R.string.catchup_unsupported)
                return@launch
            }
            val archiveDays = stream.archiveDurationDays.coerceAtLeast(1)
            val archiveDaysLabel = resources.getQuantityString(
                R.plurals.catchup_archive_days,
                archiveDays,
                archiveDays
            )
            status.text = getString(R.string.catchup_channel_archive, stream.name, archiveDaysLabel)
            runCatching {
                withContext(Dispatchers.IO) {
                    PlaylistManager(XtreamClient.api, dao).syncCatchupEpg(provider, stream.remoteId)
                }
            }
            val now = System.currentTimeMillis()
            val days = stream.archiveDurationDays.coerceIn(1, 30)
            val since = now - days * 24L * 60L * 60L * 1000L
            val items = withContext(Dispatchers.IO) { dao.catchupEpg(provider.id, stream.remoteId, since, now) }
            render(provider, stream, items)
        }
    }

    private fun render(provider: ProviderEntity, stream: StreamEntity, items: List<EpgEntity>) {
        list.removeAllViews()
        if (items.isEmpty()) {
            status.setText(R.string.catchup_empty)
            return
        }
        items.forEach { item ->
            list.addView(TextView(this).apply {
                text = "${time(item.startMs)}–${time(item.endMs)}   •   ${item.title}"
                textSize = 17f
                setTextColor(Color.WHITE)
                setPadding(dp(22), dp(16), dp(22), dp(16))
                gravity = Gravity.CENTER_VERTICAL
                isFocusable = true
                isClickable = true
                background = rowBackground(false)
                setOnFocusChangeListener { view, focused ->
                    view.background = rowBackground(focused)
                    view.animate().cancel()
                    val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.012f) else 1f
                    view.animate()
                        .scaleX(targetScale)
                        .scaleY(targetScale)
                        .translationZ(if (focused) TvUiTuning.focusElevation(view.context, dp(8).toFloat()) else 0f)
                        .setDuration(TvUiTuning.focusDuration(view.context, focused))
                        .start()
                }
                setOnClickListener { playCatchup(provider, stream, item) }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(64)).apply { topMargin = dp(6) })
        }
        list.getChildAt(0)?.requestFocus()
    }

    private fun playCatchup(provider: ProviderEntity, stream: StreamEntity, item: EpgEntity) {
        val url = CatchupUrlResolver.xtream(provider, stream, item.startMs, item.endMs)
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, "${stream.key}:catchup:${item.startMs}")
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "catchup")
            putExtra(PlayerActivity.EXTRA_TITLE, "${stream.name} • ${item.title}")
        })
    }

    private fun time(ms: Long): String = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date(ms))

    private fun rowBackground(focused: Boolean) =
        CinemaStyle.surface(this, focused = focused, radiusDp = 15)

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
