package tv.blofy.player.ui.search

import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.common.ContentPresentation

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.identity.PortalPlaylistClient
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.core.provider.LiveFormat
import tv.blofy.player.core.provider.ProviderProfile
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.core.text.ArabicSearchNormalizer
import tv.blofy.player.data.metadata.ProviderMetadataCache
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.player.PlayerActivity

class SearchActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var results: LinearLayout
    private lateinit var hint: TextView
    private lateinit var aiStatus: TextView
    private lateinit var aiButton: Button
    private lateinit var localModeButton: Button
    private lateinit var aiModeButton: Button
    private lateinit var chatTranscript: TextView
    private var aiMode = false
    private var lastAiQuestion: String? = null
    private val chatTurns = mutableListOf<Pair<String, String>>()
    private lateinit var recentStrip: LinearLayout
    private lateinit var recentScroll: HorizontalScrollView
    private lateinit var filterStrip: LinearLayout
    private val filterButtons = linkedMapOf<String, Button>()
    private val searchRunner by lazy { CatalogSearchRunner(lifecycleScope, ::runSearch) }
    private val initialKind by lazy {
        intent.getStringExtra(EXTRA_KIND)?.lowercase()?.takeIf { it in SEARCH_ORDER }
    }
    private var activeKind: String? = null
    private var referenceTitleSearch: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        activeKind = initialKind
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(44), dp(30), dp(44), dp(32))
            background = AppCompatResources.getDrawable(this@SearchActivity, R.drawable.blofy_home_background)
        }
        root.addView(TextView(this).apply {
            text = "BLOFY SEARCH"
            textSize = 11.5f
            letterSpacing = .13f
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            setTextColor(CinemaStyle.Muted)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.search_title)
            textSize = 26f
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(0, dp(3), 0, dp(4))
        })
        hint = TextView(this).apply {
            text = emptyHint()
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            setPadding(0, 0, 0, dp(8))
        }
        root.addView(hint)
        // Cast metadata is searched locally. The separate BLOFY AI button
        // sends ONLY the typed phrase to our authenticated first-party gateway.
        root.addView(TextView(this).apply {
            text = getString(R.string.stream_search_actors_hint)
            textSize = 11.5f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            setPadding(0, 0, 0, dp(8))
        })

        if (BuildConfig.CODE_ONLY_LOGIN) {
            val modeBar = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                layoutDirection = resources.configuration.layoutDirection
            }
            localModeButton = Button(this).apply {
                text = getString(R.string.stream_ai_mode_local)
                isAllCaps = false
                textSize = 14f
                CinemaStyle.styleButton(this, true)
                setOnClickListener { setAiMode(false) }
            }
            aiModeButton = Button(this).apply {
                text = getString(R.string.stream_ai_mode_chat)
                isAllCaps = false
                textSize = 14f
                CinemaStyle.styleButton(this, false)
                setOnClickListener { setAiMode(true) }
            }
            modeBar.addView(localModeButton, LinearLayout.LayoutParams(0, dp(50), 1f).apply {
                marginEnd = dp(8)
            })
            modeBar.addView(aiModeButton, LinearLayout.LayoutParams(0, dp(50), 1f))
            root.addView(modeBar, LinearLayout.LayoutParams(-1, dp(58)).apply {
                bottomMargin = dp(7)
            })
        }
        filterStrip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            clipChildren = false
        }
        listOf(
            FILTER_ALL to getString(R.string.search_filter_all),
            KIND_LIVE to getString(R.string.search_filter_live),
            KIND_MOVIE to getString(R.string.search_filter_movies),
            KIND_SERIES to getString(R.string.search_filter_series)
        ).forEach { (key, label) ->
            val button = Button(this).apply {
                text = label
                isAllCaps = false
                textSize = 12.5f
                minWidth = 0
                minimumWidth = 0
                setOnClickListener { selectFilter(key) }
            }
            filterButtons[key] = button
            filterStrip.addView(button, LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(7) })
        }
        root.addView(filterStrip, LinearLayout.LayoutParams(-1, dp(48)).apply { bottomMargin = dp(6) })
        refreshFilterStyle()

        recentStrip = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            clipChildren = false
        }
        recentScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            isFillViewport = false
            isFocusable = false
            addView(recentStrip, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        }
        root.addView(recentScroll, LinearLayout.LayoutParams(-1, dp(50)).apply { bottomMargin = dp(7) })

        input = EditText(this).apply {
            hint = inputHint()
            textSize = 16f
            setTextColor(Color.WHITE)
            setHintTextColor(BlofyTvDesign.TextMuted)
            background = searchField(false)
            setPadding(dp(22), dp(8), dp(22), dp(8))
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            isFocusable = true
            setOnFocusChangeListener { view, focused ->
                background = searchField(focused)
                view.animate().cancel()
                val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.012f) else 1f
                view.animate()
                    .scaleX(targetScale)
                    .scaleY(targetScale)
                    .translationZ(if (focused) TvUiTuning.focusElevation(view.context, dp(7).toFloat()) else 0f)
                    .setDuration(TvUiTuning.focusDuration(view.context, focused))
                    .start()
            }
            setOnEditorActionListener { _, _, _ ->
                if (aiMode) sendAiQuestion() else {
                    val q = text?.toString().orEmpty()
                    RecentSearchStore.record(this@SearchActivity, q)
                    renderRecentSearches()
                    searchRunner.submit(q, true)
                }
                true
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    val q = s?.toString().orEmpty()
                    if (::aiStatus.isInitialized) showAiStatus("")
                    if (!aiMode) {
                        searchRunner.submit(q, false)
                        if (q.isBlank()) {
                            results.removeAllViews()
                            this@SearchActivity.hint.text = emptyHint()
                            renderRecentSearches()
                            return
                        }
                        recentScroll.visibility = View.GONE
                    }
                }
                override fun afterTextChanged(s: Editable?) = Unit
            })
        }

        results = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            clipChildren = false
            clipToPadding = false
            setPadding(0, 0, dp(4), dp(28))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            clipChildren = false
            clipToPadding = false
            isFocusable = false
            addView(results, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        }
        chatTranscript = TextView(this).apply {
            text = getString(R.string.stream_ai_chat_start)
            textSize = 13f
            maxLines = 7
            setTextColor(BlofyTvDesign.TextSecondary)
            setPadding(dp(17), dp(13), dp(17), dp(13))
            gravity = Gravity.START
            background = BlofyTvDesign.glassSurface(dp(18).toFloat())
            visibility = View.GONE
        }
        if (BuildConfig.CODE_ONLY_LOGIN) {
            root.addView(chatTranscript, LinearLayout.LayoutParams(-1, -2).apply {
                bottomMargin = dp(9)
            })
        }
        val queryRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        queryRow.addView(input, LinearLayout.LayoutParams(0, dp(64), 1f))
        aiButton = Button(this).apply {
            text = getString(R.string.stream_ai_search_button)
            isAllCaps = false
            textSize = 13f
            minWidth = 0
            minimumWidth = 0
            visibility = View.GONE
            setOnClickListener { sendAiQuestion() }
        }
        if (BuildConfig.CODE_ONLY_LOGIN) {
            queryRow.addView(aiButton, LinearLayout.LayoutParams(dp(138), dp(56)).apply {
                marginStart = dp(9)
            })
        }
        aiStatus = TextView(this).apply {
            textSize = 12f
            maxLines = 2
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            visibility = View.GONE
        }
        root.addView(queryRow, LinearLayout.LayoutParams(-1, dp(64)))
        root.addView(aiStatus, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(5) })
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(5) })
        setContentView(root)
        renderRecentSearches()
        val initialQuery=intent.getStringExtra(EXTRA_INITIAL_QUERY)
            ?.trim()?.take(120).orEmpty()
        if(initialQuery.isNotEmpty()) {
            input.setText(initialQuery)
            input.setSelection(input.length())
            searchRunner.submit(initialQuery, true)
        } else input.requestFocus()
    }

    private fun selectFilter(key: String) {
        activeKind = key.takeUnless { it == FILTER_ALL }
        refreshFilterStyle()
        if (aiMode && activeKind == KIND_LIVE) {
            activeKind = null // AI recommendations are for catalog VOD/series, not live TV.
            refreshFilterStyle()
        }
        if (::aiButton.isInitialized) aiButton.isEnabled = activeKind != KIND_LIVE
        if (::aiStatus.isInitialized) showAiStatus("")
        if (::input.isInitialized) {
            input.hint = if (aiMode) getString(R.string.stream_ai_chat_hint) else inputHint()
            val query = input.text?.toString().orEmpty()
            hint.text = if (aiMode) getString(R.string.stream_ai_chat_try) else emptyHint()
            if (!aiMode && query.isNotBlank()) searchRunner.submit(query, false)
        }
    }

    /** Local search never contacts the LLM; the AI assistant runs only on Send. */
    private fun setAiMode(enabled: Boolean) {
        if (!BuildConfig.CODE_ONLY_LOGIN) return
        aiMode = enabled
        searchRunner.cancel()
        CinemaStyle.styleButton(localModeButton, !enabled)
        CinemaStyle.styleButton(aiModeButton, enabled)
        if (enabled && activeKind == KIND_LIVE) {
            activeKind = null
            refreshFilterStyle()
        }
        aiButton.visibility = if (enabled) View.VISIBLE else View.GONE
        aiButton.text = getString(R.string.stream_ai_chat_send)
        chatTranscript.visibility = if (enabled) View.VISIBLE else View.GONE
        recentScroll.visibility = View.GONE
        input.hint = if (enabled) getString(R.string.stream_ai_chat_hint) else inputHint()
        hint.text = if (enabled) getString(R.string.stream_ai_chat_try) else emptyHint()
        showAiStatus("")
        results.removeAllViews()
        if (enabled) {
            if (chatTurns.isEmpty()) chatTranscript.text = getString(R.string.stream_ai_chat_start)
            else renderChatTurns()
        } else {
            renderRecentSearches()
            input.text?.toString()?.takeIf { it.isNotBlank() }?.let { searchRunner.submit(it, false) }
        }
    }

    private fun sendAiQuestion() {
        if (!aiMode) return
        val question = input.text?.toString().orEmpty().trim().take(160)
        if (question.isBlank()) {
            showAiStatus(getString(R.string.stream_ai_enter_query))
            return
        }
        searchRunner.submit(question, true)
    }

    private fun appendChatTurn(question: String, reply: String) {
        chatTurns.add(question.take(140) to reply.take(220))
        if (chatTurns.size > 4) chatTurns.removeAt(0)
        lastAiQuestion = question.take(140)
        renderChatTurns()
    }

    private fun renderChatTurns() {
        chatTranscript.text = chatTurns.takeLast(3).joinToString("\n\n") { (question, reply) ->
            getString(R.string.stream_ai_chat_you) + ": " + question + "\n" +
                getString(R.string.stream_ai_chat_assistant) + ": " + reply
        }
    }

    private fun refreshFilterStyle() {
        val selected = activeKind ?: FILTER_ALL
        filterButtons.forEach { (key, button) ->
            CinemaStyle.styleButton(button, key == selected)
        }
    }

    private fun inputHint() = when (activeKind) {
        KIND_LIVE -> getString(R.string.search_input_channel)
        KIND_SERIES -> getString(R.string.search_input_series)
        KIND_MOVIE -> getString(R.string.search_input_movie)
        else -> getString(R.string.search_input_content)
    }

    private fun renderRecentSearches() {
        if (!::recentStrip.isInitialized) return
        recentStrip.removeAllViews()
        if (aiMode) { recentScroll.visibility = View.GONE; return }
        if (::input.isInitialized && input.text?.isNotBlank() == true) {
            recentScroll.visibility = View.GONE
            return
        }
        val items = RecentSearchStore.recent(this)
        if (items.isEmpty()) {
            recentScroll.visibility = View.GONE
            return
        }
        recentScroll.visibility = View.VISIBLE
        recentStrip.addView(TextView(this).apply {
            text = getString(R.string.search_recent)
            textSize = 12f
            typeface = BlofyTvDesign.preferredTypeface(this)
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(dp(86), dp(42)).apply { marginEnd = dp(6) })
        items.take(6).forEach { query ->
            recentStrip.addView(Button(this).apply {
                text = query
                textSize = 12f
                isAllCaps = false
                maxLines = 1
                minWidth = 0
                minimumWidth = 0
                CinemaStyle.styleButton(this)
                setOnClickListener {
                    input.setText(query)
                    input.setSelection(input.text?.length ?: 0)
                    searchRunner.submit(query, true)
                }
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(42)).apply { marginEnd = dp(7) })
        }
        recentStrip.addView(Button(this).apply {
            text = getString(R.string.search_clear)
            textSize = 11.5f
            isAllCaps = false
            minWidth = 0
            minimumWidth = 0
            CinemaStyle.styleButton(this)
            setOnClickListener {
                RecentSearchStore.clear(this@SearchActivity)
                renderRecentSearches()
            }
        }, LinearLayout.LayoutParams(dp(76), dp(42)))
    }

    private suspend fun runSearch(query: String, moveFocus: Boolean) {
        val q = query.trim()
        val requestedAsAi = aiMode
        if (q.isEmpty()) { results.removeAllViews(); return }
        val dao = BlofyDatabase.get(applicationContext).dao()
        // The code may activate multiple independent Xtream/M3U sources.
        // Search only their locally authorized indexes; never query one
        // provider with another provider’s credential.
        val providers = withContext(Dispatchers.IO) { dao.providers().first().take(4) }
        val provider = providers.firstOrNull()
        if (provider == null) { showMessage(getString(R.string.login_add_playlist_first)); return }
        val repository = ContentRepository(dao)
        val selectedKind = activeKind

        val (sections, castCount) = withContext(Dispatchers.IO) {
            val wantedKinds = selectedKind?.let(::listOf) ?: SEARCH_ORDER
            // Fast indexed catalog search always gets priority over slow
            // JSON credit lookup (which is naturally a cold-cache fallback).
            val indexed = coroutineScope {
                wantedKinds.map { kind ->
                    kind to async {
                        providers.flatMap { source ->
                            repository.searchKind(source.id, kind, q,
                                (SECTION_LIMIT / providers.size).coerceAtLeast(20))
                        }
                    }
                }.map { (kind, deferred) -> kind to deferred.await()
                    .distinctBy { it.key }.take(SECTION_LIMIT) }
            }
            val matchedTitles = indexed.sumOf { it.second.size }
            val scanCredits = moveFocus ||
                (q.length >= 8 && q.contains(' ') && matchedTitles < 8)
            val castMatches = if (selectedKind != KIND_LIVE && scanCredits &&
                CastSearchPolicy.searchable(q)) {
                val resolved = ArrayList<StreamEntity>(24)
                providers.forEach { source ->
                    ProviderMetadataCache.searchPeopleCandidates(
                        applicationContext, source.id, CastSearchPolicy.candidateToken(q), 40
                    ).asSequence()
                        .filter { (_, metadata) -> CastSearchPolicy.matches(metadata, q) }
                        .map { (key, _) -> key }.take(12)
                        .forEach { key ->
                            val stream = dao.stream(key)
                            if (stream != null && stream.providerId == source.id &&
                                stream.kind in setOf(KIND_MOVIE, KIND_SERIES) && !stream.locked) {
                                resolved.add(stream)
                            }
                        }
                }
                resolved.distinctBy { it.key }.take(24)
            } else emptyList()
            val merged = indexed.map { (kind, found) ->
                kind to (castMatches.asSequence().filter { it.kind == kind } + found.asSequence())
                    .distinctBy { it.key }.take(SECTION_LIMIT).toList()
            }
            merged to castMatches.size
        }

        if (input.text?.toString()?.trim() != q || activeKind != selectedKind ||
            aiMode != requestedAsAi) return
        if (!requestedAsAi) {
            renderSections(sections, selectedKind, provider.id, provider.liveFormat,
                castCount, moveFocus)
            return
        }
        if (!BuildConfig.CODE_ONLY_LOGIN || selectedKind == KIND_LIVE) {
            showAiStatus(getString(R.string.stream_ai_chat_error))
            return
        }
        showMessage(getString(R.string.stream_ai_searching))
        val locale = if (resources.configuration.locales[0].language == "ar") "ar" else "en"
        showAiStatus(getString(R.string.stream_ai_searching))
        val prompt = AiConversationPolicy.prompt(lastAiQuestion, q)
        val aiResponse = StreamAiSearchClient.lookup(applicationContext, prompt, locale)
        if (input.text?.toString()?.trim() != q || activeKind != selectedKind || !aiMode) return
        val ai = when (aiResponse) {
            is StreamAiSearchClient.Outcome.Ready -> aiResponse.intent
            is StreamAiSearchClient.Outcome.Unavailable -> {
                appendChatTurn(q, getString(R.string.stream_ai_chat_error))
                showAiStatus(when (aiResponse.reason) {
                    StreamAiSearchClient.Problem.NOT_ACTIVATED,
                    StreamAiSearchClient.Problem.EXPIRED_SESSION ->
                        getString(R.string.stream_ai_session_error)
                    StreamAiSearchClient.Problem.RATE_LIMIT ->
                        getString(R.string.stream_ai_rate_error)
                    else -> getString(R.string.stream_ai_connection_error)
                })
                return
            }
        }
        val expanded = withContext(Dispatchers.IO) {
            providers.flatMap { source ->
                resolveAiSuggestions(ai, repository, dao, source.id, selectedKind, q)
            }.distinctBy { it.key }
                .let { items ->
                    if (AiConversationPolicy.wantsRecent(q))
                        items.sortedByDescending { it.year?.toIntOrNull() ?: 0 }
                    else items
                }.take(48)
        }
        if (input.text?.toString()?.trim() != q || activeKind != selectedKind || !aiMode) return
        if (expanded.isEmpty()) {
            // Never display model-invented media as if it were on the server.
            appendChatTurn(q, getString(R.string.stream_ai_chat_none))
            showAiStatus("")
            showMessage(getString(R.string.stream_ai_chat_none))
            return
        }
        val merged = listOf(KIND_MOVIE, KIND_SERIES)
            .filter { selectedKind == null || selectedKind == it }
            .map { kind ->
                val local = sections.firstOrNull { it.first == kind }?.second.orEmpty()
                kind to (expanded.asSequence().filter { it.kind == kind } + local.asSequence())
                    .filter { !it.locked }.distinctBy { it.key }.take(SECTION_LIMIT).toList()
            }
        val total = merged.sumOf { it.second.size }
        renderSections(merged, selectedKind, provider.id, provider.liveFormat,
            castCount = castCount, moveFocus = false, aiCount = total)
        val examples = merged.flatMap { it.second }.take(3).joinToString(" • ") {
            it.name.take(55) + (it.year?.takeIf(String::isNotBlank)?.let { year ->
                " (" + year + ")"
            } ?: "")
        }
        appendChatTurn(q, getString(R.string.stream_ai_chat_matches, total) +
            if (examples.isNotBlank()) "\n" + examples else "")
        showAiStatus(getString(R.string.stream_ai_found, total))
    }

    /** Bound LLM suggestions to ACTUAL Xtream catalog items. No generated titles
     * or actor attributions are presented unless a catalog entry exists. */
    private suspend fun resolveAiSuggestions(
        intent: StreamAiSearchClient.Intent,
        repository: ContentRepository,
        dao: tv.blofy.player.data.local.BlofyDao,
        providerId: String,
        selectedKind: String?,
        userQuery: String
    ): List<StreamEntity> {
        // AI is a recall assistant, not the authority for strict filters.
        // Only a year the subscriber typed is allowed to filter results.
        val requestedYear = AiCatalogQueryPolicy.explicitYear(userQuery)
        val kinds = listOf(KIND_MOVIE, KIND_SERIES).filter { selectedKind == null || it == selectedKind }
        val collected = ArrayList<StreamEntity>(30)
        // At most sixteen Arabic/Latin filmography variants. Indexed FTS only.
        // Try the exact phrase first,
        // then an indexed two-word prefix when the provider has suffixes,
        // translated metadata or multiple edition labels. Never scan all rows.
        for (title in intent.suggestedTitles.take(16)) {
            val phrase = ArabicSearchNormalizer.normalize(title).take(100)
            val exact = ArabicSearchNormalizer.ftsQuery(phrase)
            if (exact.isBlank()) continue
            val firstTwo = phrase.split(" ").take(2).joinToString(" ")
            val prefix = ArabicSearchNormalizer.ftsQuery(firstTwo)
            for (kind in kinds) {
                val exactResults = runCatching {
                    dao.searchStreamsFtsByKind(providerId, kind, exact, 25)
                }.getOrDefault(emptyList())
                val exactMatches = AiCatalogMatchPolicy.filterVerified(listOf(title), exactResults, 6)
                if (exactMatches.isNotEmpty()) {
                    collected.addAll(exactMatches)
                    continue
                }
                if (prefix != exact && prefix.isNotBlank()) {
                    val prefixResults = runCatching {
                        dao.searchStreamsFtsByKind(providerId, kind, prefix, 35)
                    }.getOrDefault(emptyList())
                    collected.addAll(AiCatalogMatchPolicy.filterVerified(listOf(title), prefixResults, 6))
                }
            }
        }
        // Search verified cached cast credit metadata for actor/director prompts,
        // not just model-suggested film titles. No extra source scrape is made.
        if (intent.person.isNotBlank() && CastSearchPolicy.searchable(intent.person)) {
            val candidates = ProviderMetadataCache.searchPeopleCandidates(
                applicationContext, providerId,
                CastSearchPolicy.candidateToken(intent.person), 64
            )
            candidates.asSequence()
                .filter { (_, metadata) -> CastSearchPolicy.matches(metadata, intent.person) }
                .take(24).forEach { (key, _) ->
                    val stream = dao.stream(key)
                    if (stream != null && stream.providerId == providerId &&
                        stream.kind in kinds && !stream.locked) collected.add(stream)
                }
        }
        // Genre/year requests work even when Arabic natural phrasing did not
        // match Xtream's English genre fields. Still only source catalog rows.
        if (intent.genre.isNotBlank() && collected.size < 12) {
            for (kind in kinds) {
                val matches = repository.searchKind(providerId, kind, intent.genre, 40)
                collected.addAll(matches.filter { !it.locked })
            }
        }
        if (requestedYear != null && collected.size < 12 && intent.person.isBlank()) {
            // "أفلام ٢٠٢٦" on Arabic TV keyboards should find actual 2026
            // catalog rows, even when there is no title or genre filter.
            for (kind in kinds) {
                val yearText = requestedYear.toString()
                val exact = repository.searchKind(providerId, kind, yearText, 90)
                val found = exact.filter {
                    !it.locked && AiCatalogQueryPolicy.matchesYear(it.year, it.name, requestedYear)
                }
                collected.addAll(found)
                // A provider may omit the year from its FTS index during a
                // catalog migration; permit one bounded SQL fallback on an
                // explicit AI action, never on every keyboard keystroke.
                if (found.isEmpty()) {
                    collected.addAll(dao.searchCatalog(providerId, kind, yearText, 40)
                        .filter {
                            !it.locked && AiCatalogQueryPolicy.matchesYear(it.year, it.name, requestedYear)
                        })
                }
            }
        }
        if (intent.title.isNotBlank() && intent.person.isBlank() && collected.isEmpty()) {
            for (kind in kinds) {
                collected.addAll(repository.searchKind(providerId, kind, intent.title, 24).filter { !it.locked })
            }
        }
        val matched = collected.asSequence()
            .filter { it.providerId == providerId && !it.locked }
            .filter { AiCatalogQueryPolicy.matchesYear(it.year, it.name, requestedYear) }
            .distinctBy { it.key }.toList()
        return (if (AiConversationPolicy.wantsRecent(userQuery))
            matched.sortedByDescending { it.year?.toIntOrNull() ?: 0 }
        else matched).take(24)
    }

    /**
     * Model titles do NOT establish provider availability. Clearly separate
     * them from verified playable titles and let D-pad users look up an
     * individual name without opening a fake/nonexistent video.
     */
    private fun showAiReferenceSuggestions(
        interpretation: StreamAiSearchClient.Intent,
        matched: List<String> = emptyList()
    ) {
        if (interpretation.suggestedTitles.isEmpty()) return
        val alreadyPlayable = matched.map(ArabicSearchNormalizer::normalize).toSet()
        val suggestions = interpretation.suggestedTitles.asSequence()
            .filter { name ->
                name.length >= 3 && ArabicSearchNormalizer.normalize(name) !in alreadyPlayable
            }
            .distinctBy(ArabicSearchNormalizer::normalize).take(10).toList()
        if (suggestions.isEmpty()) return
        val section = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            background = BlofyTvDesign.glassSurface(dp(18).toFloat())
        }
        section.addView(TextView(this).apply {
            text = getString(R.string.stream_ai_reference_suggestions)
            textSize = 17f
            setTextColor(Color.WHITE)
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            setPadding(dp(6), dp(4), dp(6), dp(10))
        })
        suggestions.forEach { name ->
            section.addView(Button(this).apply {
                text = name
                textSize = 13f
                isAllCaps = false
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                setOnClickListener {
                    // Searching a model-suggested title is a LOCAL lookup,
                    // not a second Groq request loop on every button press.
                    referenceTitleSearch = name
                    if (aiMode) setAiMode(false)
                    input.setText(name)
                    input.setSelection(input.length())
                    searchRunner.submit(name, false)
                }
            }, LinearLayout.LayoutParams(-1, dp(48)).apply { bottomMargin = dp(5) })
        }
        results.addView(section, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(10)
        })
    }

    private fun renderSections(
        sections: List<Pair<String, List<StreamEntity>>>,
        selectedKind: String?,
        providerId: String,
        liveFormat: String,
        castCount: Int,
        moveFocus: Boolean,
        aiCount: Int = 0
    ) {
        results.removeAllViews()
        val total = sections.sumOf { it.second.size }
        hint.text = when {
            aiCount > 0 -> getString(R.string.stream_search_ai_suggestions, aiCount)
            castCount > 0 -> getString(R.string.stream_search_cast_results, castCount)
            selectedKind == null -> getString(R.string.search_results_all, total)
            else -> getString(R.string.search_results_kind, total, sectionTitle(selectedKind))
        }
        if (total == 0) {
            showMessage(getString(R.string.search_no_matches))
            return
        }
        var firstFocusable: View? = null
        sections.forEach { (kind, items) ->
            val section = resultSection(kind, items, providerId, liveFormat) { view ->
                if (firstFocusable == null) firstFocusable = view
            }
            results.addView(section, LinearLayout.LayoutParams(-1, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dp(14)
            })
        }
        if (moveFocus) firstFocusable?.requestFocus()
    }

    private fun resultSection(
        kind: String,
        items: List<StreamEntity>,
        providerId: String,
        liveFormat: String,
        onFirstFocusable: (View) -> Unit
    ): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        layoutDirection = resources.configuration.layoutDirection
        setPadding(dp(14), dp(12), dp(14), dp(10))
        background = BlofyTvDesign.glassSurface(dp(18).toFloat())

        addView(TextView(this@SearchActivity).apply {
            val suffix = if (items.size >= SECTION_LIMIT) "+" else ""
            text = getString(R.string.search_section_header, sectionTitle(kind), "${items.size}$suffix")
            textSize = 19f
            typeface = BlofyTvDesign.preferredTypeface(this, bold = true)
            setTextColor(BlofyTvDesign.TextPrimary)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(dp(4), 0, dp(4), dp(8))
        }, LinearLayout.LayoutParams(-1, dp(42)))

        if (items.isEmpty()) {
            addView(TextView(this@SearchActivity).apply {
                text = getString(R.string.search_no_results)
                textSize = 13f
                setTextColor(BlofyTvDesign.TextMuted)
                gravity = Gravity.START
                setPadding(dp(8), dp(6), dp(8), dp(10))
            })
        } else {
            items.forEachIndexed { index, stream ->
                val card = resultCard(stream) { guardedOpen(stream.providerId, liveFormat, stream) }
                if (index == 0) onFirstFocusable(card)
                addView(card, LinearLayout.LayoutParams(-1, dp(84)).apply { bottomMargin = dp(7) })
            }
        }
    }

    private fun resultCard(stream: StreamEntity, open: () -> Unit): LinearLayout {
        val metadata = mutableListOf<String>()
        metadata += kindLabel(stream.kind)
        stream.year?.takeIf { it.isNotBlank() }?.let { metadata += it }
        stream.genre?.takeIf { it.isNotBlank() }?.substringBefore(',')?.let { metadata += it }
        stream.rating?.takeIf { it.isNotBlank() }?.let { metadata += "★ $it" }

        return LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(7), dp(16), dp(7))
            isFocusable = true
            isClickable = true
            background = rowBackground(false)
            elevation = dp(1).toFloat()

            val art = ImageView(this@SearchActivity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(0xFF17111F.toInt()) }
            }
            addView(art, LinearLayout.LayoutParams(dp(58), dp(68)).apply { marginStart = dp(14) })
            ArtworkLoader.load(art, listOf(stream.icon, stream.backdrop))

            val copy = LinearLayout(this@SearchActivity).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL or Gravity.START }
            copy.addView(TextView(this@SearchActivity).apply {
                text = if (stream.locked) getString(R.string.search_locked_title, ContentPresentation.of(stream).title) else ContentPresentation.of(stream).title
                textSize = 14f; typeface = BlofyTvDesign.preferredTypeface(this, bold = true); setTextColor(Color.WHITE); maxLines = 1; gravity = Gravity.START
                ellipsize = android.text.TextUtils.TruncateAt.END
            })
            copy.addView(TextView(this@SearchActivity).apply {
                text = metadata.joinToString("   •   "); textSize = 11.5f; setTextColor(BlofyTvDesign.TextMuted); maxLines = 1; gravity = Gravity.START
            })
            addView(copy, LinearLayout.LayoutParams(0, -1, 1f))

            val badge = TextView(this@SearchActivity).apply {
                text = kindLabel(stream.kind); textSize = 10.5f; typeface = BlofyTvDesign.preferredTypeface(this, bold = true); setTextColor(CinemaStyle.Muted); gravity = Gravity.CENTER
                background = CinemaStyle.surface(this@SearchActivity, radiusDp = 6)
            }
            addView(badge, LinearLayout.LayoutParams(dp(74), dp(34)).apply { marginStart = dp(6) })

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
            setOnClickListener { open() }
        }
    }

    private fun guardedOpen(providerId: String, format: String, stream: StreamEntity) {
        RecentSearchStore.record(this, input.text?.toString().orEmpty())
        openStream(providerId, format, stream)
    }

    private fun openStream(providerId: String, format: String, stream: StreamEntity) {
        when (stream.kind) {
            KIND_MOVIE -> startActivity(Intent(this, MovieDetailsActivity::class.java).apply {
                putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            KIND_SERIES -> startActivity(Intent(this, SeriesDetailsActivity::class.java).apply {
                putExtra(SeriesDetailsActivity.EXTRA_PROVIDER_ID, providerId); putExtra(SeriesDetailsActivity.EXTRA_CONTENT_KEY, stream.key)
            })
            KIND_LIVE -> lifecycleScope.launch {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = try {
                    PortalPlaylistClient.ensureSubscriberConnection(
                        applicationContext,
                        BuildConfig.ACTIVATION_BASE_URL,
                        dao,
                        providerId
                    )
                } catch (_: Throwable) {
                    Toast.makeText(this@SearchActivity, "تعذر تحديث اتصال مشترك BLOFY. أعد فتح القائمة.", Toast.LENGTH_LONG).show()
                    return@launch
                } ?: return@launch
                val profile = ProviderProfile(providerKey = provider.id, liveFormat = if (provider.liveFormat.equals("m3u8", true)) LiveFormat.HLS else LiveFormat.TS)
                startActivity(Intent(this@SearchActivity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_URL, ContentUrlResolver.live(provider, profile, stream)); putExtra(PlayerActivity.EXTRA_CONTENT_KEY, stream.key)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_ID, provider.id); putExtra(PlayerActivity.EXTRA_KIND, KIND_LIVE); putExtra(PlayerActivity.EXTRA_LIVE_FORMAT, provider.liveFormat)
                    putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE, provider.providerType); putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT, provider.preferredTransport)
                    putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE, provider.preferredEngine); putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS, provider.allowCrossProtocolRedirects)
                    putExtra(PlayerActivity.EXTRA_FALLBACK_URL, ContentUrlResolver.directFallback(stream)); putStringArrayListExtra(PlayerActivity.EXTRA_FALLBACK_URLS, ArrayList(ContentUrlResolver.recoveryUrls(stream))); putExtra(PlayerActivity.EXTRA_STREAM_ID, stream.remoteId); putExtra(PlayerActivity.EXTRA_TITLE, stream.name)
                })
            }
        }
    }

    private fun emptyHint() = when (activeKind) {
        KIND_LIVE -> getString(R.string.search_hint_live)
        KIND_SERIES -> getString(R.string.search_hint_series)
        KIND_MOVIE -> getString(R.string.search_hint_movies)
        else -> getString(R.string.search_hint_all)
    }

    private fun sectionTitle(kind: String) = when (kind) {
        KIND_LIVE -> getString(R.string.search_section_live)
        KIND_SERIES -> getString(R.string.search_section_series)
        KIND_MOVIE -> getString(R.string.search_section_movies)
        else -> kind
    }

    private fun kindLabel(kind: String) = when (kind) { KIND_LIVE -> "LIVE"; KIND_MOVIE -> "MOVIE"; KIND_SERIES -> "SERIES"; else -> kind.uppercase() }

    private fun searchField(focused: Boolean) = CinemaStyle.surface(this, focused)
    private fun rowBackground(focused: Boolean) = CinemaStyle.surface(this, focused)

    private fun showAiStatus(message: String) {
        if (!::aiStatus.isInitialized) return
        aiStatus.text = message
        aiStatus.visibility = if (message.isBlank()) View.GONE else View.VISIBLE
    }

    private fun showMessage(message: String) {
        results.removeAllViews()
        results.addView(TextView(this).apply { text = message; textSize = 17f; setTextColor(BlofyTvDesign.TextSecondary); gravity = Gravity.CENTER; setPadding(0, dp(30), 0, 0) })
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onDestroy() { searchRunner.cancel(); super.onDestroy() }

    companion object {
        const val EXTRA_KIND = "kind"
        const val EXTRA_INITIAL_QUERY = "initial_query"
        const val KIND_LIVE = "live"
        const val KIND_SERIES = "series"
        const val KIND_MOVIE = "movie"
        private const val FILTER_ALL = "all"
        private val SEARCH_ORDER = listOf(KIND_LIVE, KIND_SERIES, KIND_MOVIE)
        private const val SECTION_LIMIT = 120
    }
}
