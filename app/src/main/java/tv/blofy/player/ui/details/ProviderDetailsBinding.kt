package tv.blofy.player.ui.details

import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.ProviderDetailsRepository
import tv.blofy.player.data.metadata.ProviderMetadata
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle

/** Updates only metadata views, keeping playback controls and their focus in place. */
internal class ProviderDetailsBinding(
    private val activity: AppCompatActivity,
    private val overview: TextView,
    private val crew: TextView,
    private val cast: LinearLayout,
    private val provider: ProviderEntity,
    private val stream: StreamEntity
) {
    private var job: Job? = null
    private val feedback = Button(activity).apply {
        tag = "blofy_details_metadata_status"
        CinemaStyle.styleButton(this)
        setSingleLine(false)
        setOnClickListener { refresh(force = true) }
    }

    fun start(cached: ProviderMetadata.Metadata?) {
        render(cached)
        refresh()
    }

    private fun refresh(force: Boolean = false) {
        if (job?.isActive == true) return
        feedback.setText(R.string.details_metadata_loading)
        feedback.isEnabled = false
        feedback.visibility = View.VISIBLE
        job = activity.lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                ProviderDetailsRepository.refresh(activity.applicationContext, provider, stream, force)
            }
            render(result.metadata)
            feedback.visibility = if (result.failed) View.VISIBLE else View.GONE
            feedback.setText(R.string.details_metadata_retry)
            feedback.isEnabled = result.failed
        }
    }

    private fun render(metadata: ProviderMetadata.Metadata?) {
        overview.tag = "blofy_details_overview"
        overview.text = metadata?.overview?.takeIf(String::isNotBlank) ?: stream.plot?.takeIf(String::isNotBlank)
            ?: activity.getString(if (stream.kind == "series") R.string.details_series_no_description else R.string.details_movie_no_description)
        crew.text = metadata?.crew.orEmpty().joinToString("   •   ") { "${it.job}: ${it.name}" }
        crew.visibility = if (crew.text.isEmpty()) View.GONE else View.VISIBLE
        // A refresh must not remove the focused actor while the user is navigating the strip.
        val people = metadata?.cast.orEmpty()
        if (cast.tag != people) {
            cast.removeAllViews()
            cast.tag = people
            cast.addView(TextView(activity).apply {
                setText(if (people.isEmpty()) R.string.details_cast_unavailable else R.string.details_cast)
                textSize = if (people.isEmpty()) 12f else 16f
                typeface = BlofyTvDesign.HeadingTypeface
                setTextColor(CinemaStyle.Muted)
                gravity = Gravity.START
                setPadding(0, dp(14), 0, dp(6))
            }, LinearLayout.LayoutParams(-1, -2))
            if (people.isNotEmpty()) cast.addView(CastStrip.build(activity, people), LinearLayout.LayoutParams(-1, dp(224)))
            cast.addView(feedback, LinearLayout.LayoutParams(-1, dp(44)).apply { topMargin = dp(8) })
        }
    }
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
}
