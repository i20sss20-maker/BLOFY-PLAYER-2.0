package tv.blofy.player.ui.catchup

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.playback.CatchupUrlResolver
import tv.blofy.player.data.PlaylistManager
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpgEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.player.PlayerActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class CatchupActivity : AppCompatActivity() {
    private lateinit var list: LinearLayout
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) { finish(); return }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(34), dp(28), dp(34), dp(30))
            background = AppCompatResources.getDrawable(this@CatchupActivity, R.drawable.blofy_home_background)
            clipChildren = false
            clipToPadding = false
        }
        root.addView(TextView(this).apply {
            text = "أرشيف BLOFY"
            textSize = 30f
            setTextColor(Color.WHITE)
        })
        status = TextView(this).apply {
            text = "جاري تحميل البرامج السابقة..."
            textSize = 15f
            setTextColor(Color.rgb(190, 145, 255))
            setPadding(0, 5, 0, 18)
        }
        root.addView(status)
        list = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(2), 0, dp(24))
            clipChildren = false
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            overScrollMode = android.view.View.OVER_SCROLL_NEVER
            addView(list)
        }
        root.addView(scroll, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            if (!stream.archiveEnabled || provider.providerType.equals("m3u", true)) {
                status.text = "هذه القناة لا تدعم الأرشيف"
                return@launch
            }
            status.text = "${stream.name}  •  أرشيف ${stream.archiveDurationDays.coerceAtLeast(1)} يوم"
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
            status.text = "لا توجد برامج سابقة متاحة لهذه القناة"
            return
        }
        status.text = "${stream.name}  •  ${items.size} برنامج سابق  •  أرشيف ${stream.archiveDurationDays.coerceAtLeast(1)} يوم"
        items.forEach { item ->
            list.addView(TextView(this).apply {
                text = "${item.title}\n${time(item.startMs)} — ${time(item.endMs)}"
                textSize = 16.5f
                setTextColor(Color.WHITE)
                setPadding(dp(22), dp(10), dp(22), dp(10))
                gravity = Gravity.CENTER_VERTICAL
                maxLines = 2
                setLineSpacing(dp(2).toFloat(), 1.05f)
                isFocusable = true
                isClickable = true
                background = rowBackground(false)
                setOnFocusChangeListener { view, focused ->
                    view.background = rowBackground(focused)
                    view.animate().cancel()
                    view.animate()
                        .scaleX(if (focused) 1.015f else 1f)
                        .scaleY(if (focused) 1.015f else 1f)
                        .setDuration(90)
                        .start()
                }
                setOnClickListener { playCatchup(provider, stream, item) }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(76)).apply { topMargin = dp(7) })
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

    private fun rowBackground(focused: Boolean) = GradientDrawable().apply {
        cornerRadius = dp(16).toFloat()
        setColor(if (focused) Color.rgb(70, 34, 118) else Color.rgb(18, 17, 28))
        setStroke(dp(if (focused) 2 else 1), if (focused) Color.rgb(190, 135, 255) else 0x554D376B)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
