package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.CinematicMetadataRepository
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

class PersonDetailsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val personName = intent.getStringExtra(EXTRA_NAME).orEmpty()
        val suppliedProfile = intent.getStringExtra(EXTRA_PROFILE)
        if (personName.isBlank()) { finish(); return }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.TOP
            setPadding(dp(48), dp(34), dp(48), dp(30))
            setBackgroundColor(0xFF090711.toInt())
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
        }
        val portrait = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(0xFF181020.toInt()) }
            clipToOutline = true
        }
        header.addView(portrait, LinearLayout.LayoutParams(dp(150), dp(190)).apply { marginStart = dp(26) })
        val copy = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.RIGHT }
        copy.addView(TextView(this).apply {
            text = "BLOFY CAST"; textSize = 11.5f; letterSpacing = .12f; typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(BlofyTvDesign.PurpleBright); gravity = Gravity.RIGHT
        })
        copy.addView(TextView(this).apply {
            text = personName; textSize = 34f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(Color.WHITE); gravity = Gravity.RIGHT
        })
        val status = TextView(this).apply {
            text = "جاري البحث عن أعماله الموجودة في باقتك…"; textSize = 13.5f; typeface = BlofyTvDesign.BodyTypeface
            setTextColor(BlofyTvDesign.TextMuted); gravity = Gravity.RIGHT; setPadding(0, dp(8), 0, 0)
        }
        copy.addView(status)
        header.addView(copy, LinearLayout.LayoutParams(0, dp(190), 1f))
        root.addView(header)
        root.addView(TextView(this).apply {
            text = "أعمال موجودة في باقتك"; textSize = 20f; typeface = BlofyTvDesign.HeadingTypeface; setTextColor(Color.WHITE)
            gravity = Gravity.RIGHT; setPadding(0, dp(22), 0, dp(10))
        })
        val scroll = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; overScrollMode = View.OVER_SCROLL_NEVER }
        val worksRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; clipChildren = false }
        scroll.addView(worksRow)
        root.addView(scroll, LinearLayout.LayoutParams(-1, dp(300)))
        setContentView(root)
        suppliedProfile?.let { ArtworkLoader.load(portrait, it) }

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = withContext(Dispatchers.IO) { dao.providers().first().firstOrNull() } ?: return@launch
            val person = withContext(Dispatchers.IO) { CinematicMetadataRepository.personWorks(personName) }
            person?.profileUrl?.let { ArtworkLoader.load(portrait, it) }
            val matched = withContext(Dispatchers.IO) {
                val out = ArrayList<StreamEntity>()
                val seen = HashSet<String>()
                val titles = person?.titles.orEmpty()
                for (title in titles) {
                    for (item in dao.searchStreams(provider.id, title, 5)) {
                        if ((item.kind == "movie" || item.kind == "series") && seen.add(item.key)) out += item
                        if (out.size >= 30) break
                    }
                    if (out.size >= 30) break
                }
                out
            }
            status.text = if (matched.isEmpty()) "ما لقينا أعمال مطابقة داخل الباقة الحالية" else "${matched.size} عمل متوفر داخل باقتك"
            matched.forEach { item -> worksRow.addView(workCard(provider.id, item), LinearLayout.LayoutParams(dp(176), dp(286)).apply { marginStart = dp(10) }) }
            worksRow.getChildAt(0)?.requestFocus()
        }
    }

    private fun workCard(providerId: String, item: StreamEntity) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; isFocusable = true; isClickable = true
        setPadding(dp(5), dp(5), dp(5), dp(7)); background = card(false)
        val art = ImageView(this@PersonDetailsActivity).apply { scaleType = ImageView.ScaleType.CENTER_CROP; clipToOutline = true }
        addView(art, LinearLayout.LayoutParams(-1, dp(226)))
        ArtworkLoader.load(art, item.icon ?: item.backdrop)
        addView(TextView(this@PersonDetailsActivity).apply {
            text = item.name; textSize = 12.5f; typeface = BlofyTvDesign.MediumTypeface; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(-1, dp(44)))
        setOnFocusChangeListener { v, f -> v.background = card(f); v.animate().scaleX(if (f) 1.02f else 1f).scaleY(if (f) 1.02f else 1f).setDuration(65).start() }
        setOnClickListener {
            startActivity(Intent(this@PersonDetailsActivity, if (item.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
                putExtra("provider_id", providerId); putExtra("content_key", item.key)
            })
        }
    }

    private fun card(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.TL_BR,
        if (focused) intArrayOf(0xFF563179.toInt(), 0xFF24162E.toInt()) else intArrayOf(0xFF1D1527.toInt(), 0xFF130E1B.toInt())
    ).apply { cornerRadius = dp(15).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) BlofyTvDesign.PurpleBright else 0xFF3A2A48.toInt()) }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    companion object { const val EXTRA_NAME = "person_name"; const val EXTRA_PROFILE = "person_profile" }
}
