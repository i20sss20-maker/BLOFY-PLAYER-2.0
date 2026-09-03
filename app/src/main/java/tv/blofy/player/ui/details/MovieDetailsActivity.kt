package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.CinematicMetadataRepository
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.player.PlayerActivity

class MovieDetailsActivity : AppCompatActivity() {
    private lateinit var favoriteButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId = intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty()
        val contentKey = intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if (providerId.isBlank() || contentKey.isBlank()) {
            finish()
            return
        }

        val root = FrameLayout(this).apply { setBackgroundColor(0xFF090711.toInt()) }
        val backdrop = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            alpha = .56f
        }
        root.addView(backdrop, FrameLayout.LayoutParams(-1, -1))
        root.addView(View(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(0xFA090711.toInt(), 0xE80D0915.toInt(), 0x85171024.toInt(), 0x30090711)
            )
        }, FrameLayout.LayoutParams(-1, -1))

        val body = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(48), dp(24), dp(48), dp(24))
        }
        root.addView(body, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)

        lifecycleScope.launch {
            val dao = BlofyDatabase.get(applicationContext).dao()
            val provider = dao.provider(providerId) ?: run { finish(); return@launch }
            val stream = dao.stream(contentKey) ?: run { finish(); return@launch }
            val watch = dao.watchState(contentKey)
            val url = ContentUrlResolver.movie(provider, stream)
            val enrichment = withContext(Dispatchers.IO) {
                val metadata = CinematicMetadataRepository.movie(applicationContext, stream.name, stream.year)
                val similar = if (metadata == null) emptyList() else {
                    val titles = CinematicMetadataRepository.recommendations(metadata)
                    SimilarStrip.match(titles, dao.allStreamsForProvider(providerId), "movie")
                        .filterNot { it.key == stream.key }
                }
                metadata to similar
            }
            val metadata = enrichment.first
            val similar = enrichment.second

            ArtworkLoader.loadPriority(backdrop, listOf(metadata?.backdropUrl, stream.backdrop, stream.icon))

            val posterCard = LinearLayout(this@MovieDetailsActivity).apply {
                gravity = Gravity.CENTER
                setPadding(dp(6), dp(6), dp(6), dp(6))
                background = cardBackground()
                elevation = dp(8).toFloat()
            }
            val poster = ImageView(this@MovieDetailsActivity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setBackgroundColor(0xFF16101F.toInt())
            }
            posterCard.addView(poster, LinearLayout.LayoutParams(dp(242), dp(360)))
            ArtworkLoader.loadPriority(poster, listOf(metadata?.posterUrl, stream.icon, stream.backdrop))
            body.addView(posterCard, LinearLayout.LayoutParams(dp(254), dp(372)).apply { marginStart = dp(34) })

            val info = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.TOP or Gravity.END
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                setPadding(dp(12), dp(8), dp(12), dp(32))
            }
            val scroll = ScrollView(this@MovieDetailsActivity).apply {
                isFillViewport = true
                isVerticalScrollBarEnabled = false
                overScrollMode = View.OVER_SCROLL_NEVER
                clipToPadding = false
            }
            scroll.addView(info, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
            body.addView(scroll, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))

            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = "BLOFY CINEMA"
                textSize = 11.5f
                letterSpacing = .12f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.PurpleBright)
                gravity = Gravity.END
            })

            val title = metadata?.title?.takeIf(String::isNotBlank) ?: stream.name
            metadata?.logoUrl?.takeIf(String::isNotBlank)?.let { logoUrl ->
                val logo = ImageView(this@MovieDetailsActivity).apply {
                    scaleType = ImageView.ScaleType.FIT_END
                    adjustViewBounds = true
                    contentDescription = title
                }
                info.addView(logo, LinearLayout.LayoutParams(dp(390), dp(86)).apply {
                    gravity = Gravity.END
                    topMargin = dp(4)
                })
                ArtworkLoader.load(logo, logoUrl)
            }
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = title
                textSize = if (metadata?.logoUrl.isNullOrBlank()) 36f else 19f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.END
                maxLines = 2
                includeFontPadding = false
                alpha = if (metadata?.logoUrl.isNullOrBlank()) 1f else .9f
            })

            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = buildList {
                    add("فيلم")
                    (metadata?.releaseDate?.take(4) ?: stream.year)?.takeIf(String::isNotBlank)?.let(::add)
                    metadata?.runtimeMinutes?.takeIf { it > 0 }?.let { add("$it دقيقة") }
                        ?: stream.duration?.takeIf(String::isNotBlank)?.let(::add)
                    metadata?.rating?.let { add("TMDb %.1f/10".format(java.util.Locale.US, it)) }
                        ?: stream.rating?.takeIf(String::isNotBlank)?.let { add("★ $it") }
                    val genres = metadata?.genres?.filter(String::isNotBlank).orEmpty()
                    if (genres.isNotEmpty()) add(genres.take(3).joinToString(" / "))
                    else stream.genre?.takeIf(String::isNotBlank)?.let(::add)
                    stream.extension?.takeIf(String::isNotBlank)?.let { add(it.uppercase()) }
                }.joinToString("   •   ")
                textSize = 13.5f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(0xFFE8D8FA.toInt())
                gravity = Gravity.END
                setPadding(0, dp(7), 0, dp(10))
            })

            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = "القصة"
                textSize = 13f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.END
                setPadding(0, 0, 0, dp(3))
            })
            info.addView(TextView(this@MovieDetailsActivity).apply {
                text = metadata?.overview?.takeIf(String::isNotBlank)
                    ?: stream.plot?.takeIf(String::isNotBlank)
                    ?: "لا يتوفر وصف لهذا الفيلم من السيرفر حاليًا."
                textSize = 15f
                typeface = BlofyTvDesign.BodyTypeface
                maxLines = 7
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.END
                setLineSpacing(0f, 1.16f)
                setPadding(0, 0, 0, dp(9))
            })

            if (!metadata?.crew.isNullOrEmpty()) {
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = metadata!!.crew.joinToString("   •   ") { "${it.job}: ${it.name}" }
                    textSize = 11.5f
                    typeface = BlofyTvDesign.MediumTypeface
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.END
                    maxLines = 2
                    setPadding(0, 0, 0, dp(8))
                })
            }

            val resumeMs = watch?.positionMs ?: 0L
            val durationMs = watch?.durationMs ?: 0L
            if (resumeMs > 30_000L && durationMs > 0L) {
                val progress = ((resumeMs * 100L) / durationMs).coerceIn(1, 99)
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = "متابعة المشاهدة   •   $progress%"
                    textSize = 12.5f
                    typeface = BlofyTvDesign.HeadingTypeface
                    setTextColor(BlofyTvDesign.Mint)
                    gravity = Gravity.END
                    setPadding(0, 0, 0, dp(7))
                })
            }

            val actions = LinearLayout(this@MovieDetailsActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = View.LAYOUT_DIRECTION_RTL
                gravity = Gravity.END
            }
            val play = actionButton(if (resumeMs > 30_000L) "▶  استئناف" else "▶  شاهد الآن", true) {
                openPlayer(provider, stream, url, resumeMs)
            }
            actions.addView(play, LinearLayout.LayoutParams(dp(182), dp(56)).apply { marginStart = dp(8) })
            if (resumeMs > 30_000L) {
                actions.addView(actionButton("↺  من البداية") { openPlayer(provider, stream, url, 0L) },
                    LinearLayout.LayoutParams(dp(150), dp(56)).apply { marginStart = dp(8) })
            }
            metadata?.trailerUrl?.takeIf(String::isNotBlank)?.let { trailerUrl ->
                actions.addView(actionButton("▷  الإعلان") { openExternal(trailerUrl) },
                    LinearLayout.LayoutParams(dp(142), dp(56)).apply { marginStart = dp(8) })
            }
            favoriteButton = actionButton(if (stream.favorite) "★  المفضلة" else "☆  المفضلة") {
                lifecycleScope.launch {
                    val current = dao.stream(contentKey) ?: return@launch
                    dao.setFavorite(contentKey, !current.favorite)
                    favoriteButton.text = if (!current.favorite) "★  المفضلة" else "☆  المفضلة"
                }
            }
            actions.addView(favoriteButton, LinearLayout.LayoutParams(dp(150), dp(56)))
            info.addView(actions)

            if (!metadata?.cast.isNullOrEmpty()) {
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = "طاقم التمثيل"
                    textSize = 16f
                    typeface = BlofyTvDesign.HeadingTypeface
                    setTextColor(Color.WHITE)
                    gravity = Gravity.END
                    setPadding(0, dp(14), 0, dp(5))
                })
                info.addView(CastStrip.build(this@MovieDetailsActivity, metadata!!.cast), LinearLayout.LayoutParams(-1, dp(184)))
            } else {
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = "بيانات طاقم التمثيل غير متوفرة من المصدر الحالي"
                    textSize = 12f
                    typeface = BlofyTvDesign.BodyTypeface
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.END
                    setPadding(0, dp(12), 0, dp(4))
                })
            }

            if (similar.isNotEmpty()) {
                info.addView(TextView(this@MovieDetailsActivity).apply {
                    text = "قد يعجبك أيضًا"
                    textSize = 16f
                    typeface = BlofyTvDesign.HeadingTypeface
                    setTextColor(Color.WHITE)
                    gravity = Gravity.END
                    setPadding(0, dp(12), 0, dp(5))
                })
                info.addView(SimilarStrip.build(this@MovieDetailsActivity, similar) { selected ->
                    startActivity(Intent(this@MovieDetailsActivity, MovieDetailsActivity::class.java).apply {
                        putExtra(EXTRA_PROVIDER_ID, providerId)
                        putExtra(EXTRA_CONTENT_KEY, selected.key)
                    })
                }, LinearLayout.LayoutParams(-1, dp(234)))
            }

            play.requestFocus()
        }
    }

    private fun openPlayer(provider: ProviderEntity, stream: StreamEntity, url: String, resume: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_URL, url)
            putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
            putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id)
            putExtra(PlayerActivity.EXTRA_KIND, "movie")
            putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType)
            putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
            putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine)
            putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
            putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream))
            putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
            putExtra(PlayerActivity.EXTRA_RESUME_MS, resume)
        })
    }

    private fun openExternal(url: String) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply { addCategory(Intent.CATEGORY_BROWSABLE) })
        }.onFailure {
            Toast.makeText(this, "تعذر فتح الإعلان على هذا الجهاز", Toast.LENGTH_SHORT).show()
        }
    }

    private fun actionButton(label: String, primary: Boolean = false, action: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 13.5f
        typeface = BlofyTvDesign.HeadingTypeface
        isFocusable = true
        isFocusableInTouchMode = true
        setTextColor(Color.WHITE)
        background = buttonBackground(false, primary)
        setOnFocusChangeListener { view, focused ->
            view.background = buttonBackground(focused, primary)
            view.animate().cancel()
            view.animate().scaleX(if (focused) 1.022f else 1f).scaleY(if (focused) 1.022f else 1f)
                .translationZ(if (focused) dp(9).toFloat() else dp(2).toFloat()).setDuration(65).start()
        }
        setOnClickListener { action() }
    }

    private fun cardBackground() = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(0xD92B203B.toInt(), 0xE617111F.toInt())
    ).apply {
        cornerRadius = dp(18).toFloat()
        setStroke(dp(1), 0x996B4D88.toInt())
    }

    private fun buttonBackground(focused: Boolean, primary: Boolean) = GradientDrawable(
        GradientDrawable.Orientation.LEFT_RIGHT,
        when {
            primary && focused -> intArrayOf(0xFFA653FF.toInt(), 0xFF7130D2.toInt())
            primary -> intArrayOf(0xFF843FE6.toInt(), 0xFF5720AD.toInt())
            focused -> intArrayOf(0xFF633A8D.toInt(), 0xFF35214C.toInt())
            else -> intArrayOf(0xD92B203B.toInt(), 0xE61A1325.toInt())
        }
    ).apply {
        cornerRadius = dp(15).toFloat()
        setStroke(if (focused) dp(2) else dp(1), if (focused) BlofyTvDesign.PurpleBright else 0x99513C67.toInt())
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_PROVIDER_ID = "provider_id"
        const val EXTRA_CONTENT_KEY = "content_key"
    }
}
