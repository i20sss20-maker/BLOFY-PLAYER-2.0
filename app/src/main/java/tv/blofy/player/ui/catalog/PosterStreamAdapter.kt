package tv.blofy.player.ui.catalog

import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.common.TvUiTuning

import tv.blofy.player.ui.common.ContentPresentation

import android.os.Build
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.local.CategoryEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.core.device.DeviceClass

class PosterStreamAdapter(
    private val onClick: (StreamEntity) -> Unit,
    private val onFocus: (StreamEntity, Int) -> Unit = { _, _ -> }
) : RecyclerView.Adapter<PosterStreamAdapter.Holder>() {
    private val items = ArrayList<StreamEntity>(256)

    private var categoryNames: Map<String, String> = emptyMap()
    private val cachedMovieGenres: MutableMap<String, List<String>> = HashMap()

    /** Source categories are already in the local DB; use them as optional genre evidence. */
    fun updateCategoryNames(categories: List<CategoryEntity>) {
        val next = categories.associate { it.remoteId to it.name }
        if (categoryNames == next) return
        categoryNames = next
        if (items.isNotEmpty()) notifyItemRangeChanged(0, items.size, GENRE_META_PAYLOAD)
    }

    /**
     * Atomic metadata snapshot. A warm page, a category, and the unfiltered
     * grid must resolve identical content keys to identical genres.
     * No incremental per-item changes while a poster row is on-screen.
     */
    fun rememberMovieGenres(
        genres: Map<String, List<String>>,
        reset: Boolean = false,
        notifyExisting: Boolean = false
    ) {
        val merged = if (reset) HashMap(genres) else HashMap(cachedMovieGenres).apply { putAll(genres) }
        if (cachedMovieGenres == merged) return
        cachedMovieGenres.clear()
        cachedMovieGenres.putAll(merged)
        if (notifyExisting && items.isNotEmpty()) {
            notifyItemRangeChanged(0, items.size, GENRE_META_PAYLOAD)
        }
    }

    private companion object {
        const val GENRE_META_PAYLOAD = "movie_genre_line_only"
    }

    init { setHasStableIds(true) }

    fun replace(newItems: List<StreamEntity>) {
        // Identical snapshots do not need to discard artwork or remote focus.
        if (items.size == newItems.size && items.indices.all { items[it] == newItems[it] }) return
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }
    fun append(newItems: List<StreamEntity>) { if (newItems.isEmpty()) return; val start = items.size; items.addAll(newItems); notifyItemRangeInserted(start, newItems.size) }
    fun itemAt(position: Int): StreamEntity? = items.getOrNull(position)
    override fun getItemId(position: Int): Long = items[position].key.hashCode().toLong()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val density = parent.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val root = LinearLayout(parent.context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isFocusable = true
            isFocusableInTouchMode = DeviceClass.detect(context) == DeviceClass.Kind.TV
            isClickable = true
            setPadding(dp(3), dp(3), dp(3), dp(6))
            background = card(false, dp(12).toFloat(), dp(1))
            clipToOutline = true
            elevation = 0f
        }
        root.layoutParams = RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            marginStart = dp(4)
            marginEnd = dp(4)
            bottomMargin = dp(10)
        }
        val frame = object : FrameLayout(parent.context) {
            override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
                val width = View.MeasureSpec.getSize(widthMeasureSpec)
                super.onMeasure(widthMeasureSpec, View.MeasureSpec.makeMeasureSpec(width * 3 / 2, View.MeasureSpec.EXACTLY))
            }
        }
        val image = ImageView(parent.context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setBackgroundColor(Color.rgb(18, 13, 25))
            clipToOutline = true
        }
        frame.addView(image, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        val rating = TextView(parent.context).apply {
            textSize = 9.2f
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(dp(7), dp(2), dp(7), dp(2))
            visibility = View.GONE
            background = GradientDrawable().apply {
                cornerRadius = dp(8).toFloat()
                setColor(0xE6191D25.toInt())
            }
        }
        frame.addView(rating, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply { topMargin = dp(7); marginEnd = dp(7) })
        root.addView(frame, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val title = TextView(parent.context).apply {
            textSize = 11.3f
            typeface = BlofyTvDesign.preferredTypeface(this)
            setTextColor(BlofyTvDesign.TextSecondary)
            gravity = Gravity.START
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(4), dp(6), dp(4), 0)
            includeFontPadding = false
        }
        val titleHeight = maxOf(dp(36), title.lineHeight * 2 + title.paddingTop + title.paddingBottom)
        root.addView(title, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, titleHeight))
        val meta = TextView(parent.context).apply {
            textSize = 9.3f
            typeface = BlofyTvDesign.preferredTypeface(this)
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(4), 0, dp(4), 0)
            includeFontPadding = false
        }
        root.addView(meta, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(18)))
        return Holder(root, image, title, meta, rating, dp(12).toFloat(), dp(1))
    }

    /** Refresh one metadata line without resetting images, scroll, or remote focus. */
    fun rememberMovieGenre(key: String, genres: List<String>) {
        if (genres.isEmpty() || cachedMovieGenres[key] == genres) return
        cachedMovieGenres[key] = genres
        val index = items.indexOfFirst { it.key == key }
        if (index >= 0) notifyItemChanged(index, GENRE_META_PAYLOAD)
    }

    private fun bindGenreLine(holder: Holder, item: StreamEntity, badges: List<String>) {
        val configuration = holder.itemView.resources.configuration
        val language = if (Build.VERSION.SDK_INT >= 24) configuration.locales[0].language
            else @Suppress("DEPRECATION") configuration.locale.language
        holder.meta.text = MovieCardMeta.subtitle(
            item = item,
            badges = badges,
            categoryName = categoryNames[item.categoryId],
            cachedDetailGenres = cachedMovieGenres[item.key].orEmpty(),
            arabic = language == "ar"
        )
    }

    override fun onBindViewHolder(holder: Holder, position: Int, payloads: MutableList<Any>) {
        if (payloads.isNotEmpty() && payloads.all { it == GENRE_META_PAYLOAD }) {
            val item = items[position]
            bindGenreLine(holder, item, ContentPresentation.of(item).badges)
            return
        }
        super.onBindViewHolder(holder, position, payloads)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.itemView.tag = item.key
        val presentation = ContentPresentation.of(item)
        holder.title.text = presentation.title
        holder.itemView.contentDescription = presentation.title
        bindGenreLine(holder, item, presentation.badges)
        holder.rating.text = item.rating?.takeIf(String::isNotBlank)?.let { "★ $it" }.orEmpty()
        holder.rating.visibility = if (holder.rating.text.isNotBlank()) View.VISIBLE else View.GONE
        renderFocus(holder, holder.itemView.hasFocus())
        holder.artworkCandidates = listOf(item.icon, item.backdrop)
        holder.image.scaleType = if (item.kind == "live") ImageView.ScaleType.FIT_CENTER else ImageView.ScaleType.CENTER_CROP
        ArtworkLoader.load(holder.image, holder.artworkCandidates)
        holder.itemView.setOnClickListener { onClick(item) }
        holder.itemView.setOnFocusChangeListener { view, focused ->
            view.animate().cancel()
            renderFocus(holder, focused)
            val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.02f) else 1f
            view.animate()
                .scaleX(targetScale)
                .scaleY(targetScale)
                .translationZ(if (focused) TvUiTuning.focusElevation(view.context, 8f) else 0f)
                .setDuration(TvUiTuning.focusDuration(view.context, focused))
                .start()
            if (focused) {
                val currentPosition = holder.bindingAdapterPosition
                if (currentPosition != RecyclerView.NO_POSITION) onFocus(item, currentPosition)
            }
        }
    }

    private fun renderFocus(holder: Holder, focused: Boolean) {
        holder.itemView.background = card(focused, holder.radius, holder.stroke)
        holder.title.typeface = BlofyTvDesign.preferredTypeface(holder.title, bold = focused)
        holder.title.setTextColor(if (focused) Color.WHITE else BlofyTvDesign.TextSecondary)
        holder.meta.setTextColor(if (focused) BlofyTvDesign.Lavender else CinemaStyle.Muted)
        holder.rating.alpha = if (focused) 1f else .88f
    }

    override fun onViewRecycled(holder: Holder) {
        ArtworkLoader.cancel(holder.image)
        holder.artworkCandidates = emptyList()
        holder.image.setImageDrawable(null)
        holder.itemView.animate().cancel()
        holder.itemView.scaleX = 1f
        holder.itemView.scaleY = 1f
        holder.itemView.translationZ = 0f
        super.onViewRecycled(holder)
    }

    override fun onViewDetachedFromWindow(holder: Holder) {
        ArtworkLoader.cancel(holder.image)
        super.onViewDetachedFromWindow(holder)
    }

    override fun onViewAttachedToWindow(holder: Holder) {
        super.onViewAttachedToWindow(holder)
        // RecyclerView may reattach a cached holder without binding it again.
        if (holder.image.tag == null && holder.artworkCandidates.isNotEmpty()) {
            ArtworkLoader.load(holder.image, holder.artworkCandidates)
        }
    }

    override fun getItemCount(): Int = items.size

    class Holder(
        itemView: View,
        val image: ImageView,
        val title: TextView,
        val meta: TextView,
        val rating: TextView,
        val radius: Float,
        val stroke: Int
    ) : RecyclerView.ViewHolder(itemView) {
        var artworkCandidates: List<String?> = emptyList()
    }

    private fun card(focused: Boolean, radius: Float, stroke: Int) = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        if (focused) {
            intArrayOf(BlofyTvDesign.SurfaceFocused, BlofyTvDesign.SurfaceRaised, CinemaStyle.Surface)
        } else {
            intArrayOf(CinemaStyle.Surface, 0xFF180F23.toInt())
        }
    ).apply {
        cornerRadius = radius
        setStroke(stroke * if (focused) 2 else 1, if (focused) BlofyTvDesign.FocusStroke else 0x45FFFFFF)
    }
}
