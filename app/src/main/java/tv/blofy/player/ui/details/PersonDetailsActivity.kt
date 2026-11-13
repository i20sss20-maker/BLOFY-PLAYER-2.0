package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.widget.Button
import android.widget.ScrollView
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.ui.search.CastSearchPolicy
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.common.ContentPresentation
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import tv.blofy.player.R
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

class PersonDetailsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val personName = intent.getStringExtra(EXTRA_NAME).orEmpty()
        val suppliedProfile = intent.getStringExtra(EXTRA_PROFILE)
        if (personName.isBlank()) { finish(); return }
        val uiDirection = resources.configuration.layoutDirection

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = uiDirection
            gravity = Gravity.TOP
            setPadding(dp(48), dp(36), dp(48), dp(32))
            background = AppCompatResources.getDrawable(this@PersonDetailsActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY  •  CAST"
            textSize = 11.5f
            letterSpacing = .12f
            typeface = BlofyTvDesign.LabelTypeface
            setTextColor(BlofyTvDesign.PurpleBright)
            gravity = Gravity.END
        }, LinearLayout.LayoutParams(-1, dp(30)))

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = uiDirection
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(22), dp(22), dp(26), dp(22))
            background = BlofyTvDesign.glassSurface(dp(24).toFloat(), false)
            elevation = dp(5).toFloat()
        }
        val portraitFrame = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            setPadding(dp(5), dp(5), dp(5), dp(5))
            background = BlofyTvDesign.surface(dp(20).toFloat(), false)
        }
        val portrait = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply {
                cornerRadius = dp(17).toFloat()
                setColor(BlofyTvDesign.Surface)
                setStroke(dp(1), BlofyTvDesign.Divider)
            }
            clipToOutline = true
            setImageResource(R.drawable.blofy_logo)
        }
        portraitFrame.addView(portrait, LinearLayout.LayoutParams(dp(154), dp(194)))
        panel.addView(portraitFrame, LinearLayout.LayoutParams(dp(166), dp(206)).apply { marginEnd = dp(28) })

        panel.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
            layoutDirection = uiDirection
            addView(TextView(this@PersonDetailsActivity).apply {
                text = getString(R.string.person_server_identity)
                textSize = 12.5f
                typeface = BlofyTvDesign.MediumTypeface
                setTextColor(BlofyTvDesign.PurpleSoft)
                gravity = Gravity.END
                includeFontPadding = false
            })
            addView(TextView(this@PersonDetailsActivity).apply {
                text = personName
                textSize = 36f
                typeface = BlofyTvDesign.DisplayTypeface
                setTextColor(Color.WHITE)
                gravity = Gravity.END
                includeFontPadding = false
                setPadding(0, dp(4), 0, dp(10))
            })
            addView(TextView(this@PersonDetailsActivity).apply {
                text = getString(R.string.person_server_only_note)
                textSize = 14f
                typeface = BlofyTvDesign.BodyTypeface
                setTextColor(BlofyTvDesign.TextSecondary)
                gravity = Gravity.END
                setLineSpacing(0f, 1.18f)
                maxLines = 4
            })
        }, LinearLayout.LayoutParams(0, dp(206), 1f))

        root.addView(panel, LinearLayout.LayoutParams(-1, dp(250)).apply { topMargin = dp(8) })
        val filmography = LinearLayout(this).apply {
            orientation=LinearLayout.VERTICAL
            setPadding(0,dp(12),0,dp(14))
        }
        filmography.addView(TextView(this).apply {
            text=getString(R.string.stream_cast_available)
            textSize=20f
            typeface=BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            setPadding(0,dp(8),0,dp(14))
        })
        val castStatus = TextView(this).apply {
            text=getString(R.string.search_loading)
            textSize=13f
            setTextColor(BlofyTvDesign.TextMuted)
        }
        filmography.addView(castStatus)
        root.addView(filmography)
        root.addView(Button(this).apply {
            text=getString(R.string.stream_cast_search)
            isAllCaps=false
            textSize=15f
            setOnClickListener {
                startActivity(Intent(this@PersonDetailsActivity, SearchActivity::class.java)
                    .putExtra(SearchActivity.EXTRA_INITIAL_QUERY,"أفلام $personName"))
            }
        },LinearLayout.LayoutParams(-1,dp(56)).apply {bottomMargin=dp(10)})
        lifecycleScope.launch {
            val matches=withContext(Dispatchers.IO) {
                val dao=BlofyDatabase.get(applicationContext).dao()
                val providerId=dao.activeProviderId() ?: return@withContext emptyList<tv.blofy.player.data.local.StreamEntity>()
                val candidates=ProviderMetadataCache.searchPeopleCandidates(
                    applicationContext, providerId,
                    CastSearchPolicy.candidateToken(personName),128
                )
                val found=ArrayList<tv.blofy.player.data.local.StreamEntity>()
                for((key,credits) in candidates) {
                    if (!CastSearchPolicy.matches(credits,personName)) continue
                    val stream=dao.stream(key) ?: continue
                    if(stream.providerId==providerId && !stream.locked &&
                        stream.kind in setOf("movie","series")) found.add(stream)
                    if(found.size>=36) break
                }
                found.distinctBy { it.key }
            }
            filmography.removeView(castStatus)
            if(matches.isEmpty()) {
                filmography.addView(TextView(this@PersonDetailsActivity).apply {
                    text=getString(R.string.stream_cast_none)
                    textSize=13.5f
                    setTextColor(BlofyTvDesign.TextMuted)
                    setPadding(dp(6),dp(6),dp(6),dp(14))
                })
            } else matches.forEach { item ->
                filmography.addView(Button(this@PersonDetailsActivity).apply {
                    text=ContentPresentation.title(item.name,item.kind) +
                        item.year?.takeIf(String::isNotBlank)?.let { "  •  $it" }.orEmpty()
                    textSize=14f
                    isAllCaps=false
                    gravity=Gravity.CENTER_VERTICAL or Gravity.START
                    setOnClickListener {
                        val destination=if(item.kind=="series")
                            SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java
                        startActivity(Intent(this@PersonDetailsActivity,destination)
                            .putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID,item.providerId)
                            .putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY,item.key))
                    }
                },LinearLayout.LayoutParams(-1,dp(60)).apply {bottomMargin=dp(8)})
            }
        }
        root.addView(TextView(this).apply {
            text = "BLOFY PLAYER"
            textSize = 11f
            letterSpacing = .08f
            typeface = BlofyTvDesign.MediumTypeface
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(12) })

        setContentView(ScrollView(this).apply {
            isFillViewport=true
            addView(root)
        })
        suppliedProfile?.takeIf(String::isNotBlank)?.let { ArtworkLoader.load(portrait, it) }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_NAME = "person_name"
        const val EXTRA_PROFILE = "person_profile"
    }
}
