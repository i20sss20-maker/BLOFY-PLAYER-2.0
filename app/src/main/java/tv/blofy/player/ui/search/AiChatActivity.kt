package tv.blofy.player.ui.search

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity

/**
 * STREAM-only full-screen conversation. Local title search is its OWN screen:
 * chat uses the authenticated AI gateway only when the subscriber presses Send.
 * Suggestions may be clicked to open the regular local search, never an
 * unverified model-generated playback URL.
 */
class AiChatActivity : AppCompatActivity() {
    private lateinit var transcript: LinearLayout
    private lateinit var conversationScroll: ScrollView
    private lateinit var compose: EditText
    private lateinit var send: Button
    private var busy = false
    private var lastQuestion: String? = null
    private val history = ArrayList<Pair<String, String>>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.CODE_ONLY_LOGIN) { finish(); return }
        val pad = if (resources.configuration.screenWidthDp < 650) 16 else 42
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(pad), dp(19), dp(pad), dp(16))
            background = AppCompatResources.getDrawable(this@AiChatActivity,
                R.drawable.blofy_home_background)
        }

        root.addView(TextView(this).apply {
            text = getString(R.string.stream_chat_heading)
            textSize = 24f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.stream_chat_subheading)
            textSize = 12.5f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            setPadding(0, dp(3), 0, dp(11))
        })

        transcript = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            setPadding(dp(6), dp(6), dp(6), dp(22))
        }
        conversationScroll = ScrollView(this).apply {
            isFillViewport = true
            isVerticalScrollBarEnabled = false
            isFocusable = false
            clipToPadding = false
            addView(transcript, FrameLayout.LayoutParams(-1, -2))
        }
        root.addView(conversationScroll, LinearLayout.LayoutParams(-1, 0, 1f))

        val promptLanguage = ConfigurationCompat.getLocales(resources.configuration)[0]
            ?.language.let { if (it == "en") "en" else "ar" }
        root.addView(TextView(this).apply {
            text = if (promptLanguage == "en") "Ideas to ask BLOFY AI"
                else "وش ودك تشوف؟ جرّب أحد هذه الطلبات"
            textSize = 12.5f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            setPadding(dp(5), dp(2), 0, dp(4))
        })
        val promptCategories = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
        }
        val promptOptions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
        }
        fun showCategory(group: AiPromptCatalog.Group) {
            promptOptions.removeAllViews()
            group.prompts.forEach { prompt ->
                val phrase = prompt.text(promptLanguage)
                promptOptions.addView(Button(this).apply {
                    text = phrase
                    isAllCaps = false
                    maxLines = 2
                    CinemaStyle.styleButton(this)
                    contentDescription = phrase
                    setOnClickListener { ask(phrase) }
                }, LinearLayout.LayoutParams(dp(if (promptLanguage == "en") 240 else 222),
                    dp(56)).apply { marginEnd = dp(7) })
            }
        }
        AiPromptCatalog.groups.forEach { group ->
            promptCategories.addView(Button(this).apply {
                text = group.label(promptLanguage)
                isAllCaps = false
                CinemaStyle.styleButton(this)
                setOnClickListener { showCategory(group) }
            }, LinearLayout.LayoutParams(dp(160), dp(43)).apply { marginEnd = dp(7) })
        }
        root.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            isFocusable = false
            addView(promptCategories)
        }, LinearLayout.LayoutParams(-1, dp(47)))
        root.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            isFocusable = false
            addView(promptOptions)
        }, LinearLayout.LayoutParams(-1, dp(62)).apply { bottomMargin = dp(7) })
        showCategory(AiPromptCatalog.groups.first())

        val composer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        compose = EditText(this).apply {
            hint = getString(R.string.stream_ai_chat_hint)
            textSize = 16f
            setTextColor(Color.WHITE)
            setHintTextColor(BlofyTvDesign.TextMuted)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_SEND
            background = CinemaStyle.surface(this@AiChatActivity)
            setPadding(dp(15), dp(9), dp(15), dp(9))
            setOnEditorActionListener { _, _, _ ->
                ask(text.toString())
                true
            }
        }
        composer.addView(compose, LinearLayout.LayoutParams(0, dp(58), 1f))
        send = Button(this).apply {
            text = getString(R.string.stream_ai_chat_send)
            CinemaStyle.styleButton(this, primary = true)
            setOnClickListener { ask(compose.text.toString()) }
        }
        composer.addView(send, LinearLayout.LayoutParams(dp(115), dp(55)).apply {
            marginStart = dp(9)
        })
        root.addView(composer)
        setContentView(root)

        addBubble(getString(R.string.stream_chat_welcome), fromUser = false)
        // Keep existing conversation across a configuration change, without
        // sending it to external storage or changing server activation data.
        val userLines = savedInstanceState?.getStringArrayList("user_lines").orEmpty()
        val botLines = savedInstanceState?.getStringArrayList("bot_lines").orEmpty()
        userLines.zip(botLines).takeLast(8).forEach { (user, bot) ->
            history.add(user to bot)
            addBubble(user, true)
            addBubble(bot, false)
        }
        lastQuestion = savedInstanceState?.getString("last_question")
    }

    private fun ask(raw: String) {
        val question = raw.trim().take(160)
        if (busy || question.length < 3) return
        busy = true
        send.isEnabled = false
        compose.text?.clear()
        // The TV soft keyboard must not cover the conversation and its
        // clickable catalog results after Send.
        (getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)
            ?.hideSoftInputFromWindow(compose.windowToken, 0)
        compose.clearFocus()
        addBubble(question, fromUser = true)
        val pending = addBubble(getString(R.string.stream_ai_searching), fromUser = false)
        val contextual = AiConversationPolicy.prompt(lastQuestion, question)
        lastQuestion = question
        val locale = ConfigurationCompat.getLocales(resources.configuration)[0]?.language
            .let { if (it == "en") "en" else "ar" }

        lifecycleScope.launch {
            try {
                val response = StreamAiSearchClient.lookup(applicationContext, contextual, locale)
                if (isFinishing || isDestroyed) return@launch
                when (response) {
                    is StreamAiSearchClient.Outcome.Ready -> {
                        val parsed = response.intent
                        val matches = findMatches(parsed, question)
                        if (isFinishing || isDestroyed) return@launch
                        val friendly = AiReplyPolicy.safe(parsed.reply)
                        val context = when {
                            matches.titles.isEmpty() -> getString(R.string.stream_ai_chat_none)
                            matches.alternatives ->
                                getString(R.string.stream_ai_verified_alternatives)
                            else -> getString(R.string.stream_chat_verified_count,
                                matches.titles.size)
                        }
                        val reply = listOf(friendly.takeIf(String::isNotBlank), context)
                            .filterNotNull().joinToString("\n\n")
                        pending.text = reply
                        record(question, reply)
                        if (matches.titles.isNotEmpty()) addTitleButtons(matches.titles)
                    }
                    is StreamAiSearchClient.Outcome.Unavailable -> {
                        // A temporarily unreachable AI does not make the
                        // user's downloaded catalog unusable. Local fallback
                        // never runs for revoked sessions or rate-limit errors.
                        val canUseLocal = response.reason in setOf(
                            StreamAiSearchClient.Problem.CONNECTION,
                            StreamAiSearchClient.Problem.SERVICE,
                            StreamAiSearchClient.Problem.BAD_RESPONSE
                        )
                        val local = if (canUseLocal) {
                            findMatches(AiOfflineIntentPolicy.parse(question), question)
                        } else null
                        if (local != null && local.titles.isNotEmpty()) {
                            val answer = getString(R.string.stream_ai_local_fallback,
                                local.titles.size) +
                                if (local.alternatives)
                                    "\n\n" + getString(R.string.stream_ai_verified_alternatives)
                                else ""
                            pending.text = answer
                            record(question, answer)
                            addTitleButtons(local.titles)
                        } else {
                            val answer = when (response.reason) {
                                StreamAiSearchClient.Problem.NOT_ACTIVATED,
                                StreamAiSearchClient.Problem.EXPIRED_SESSION ->
                                    getString(R.string.stream_ai_session_error)
                                StreamAiSearchClient.Problem.RATE_LIMIT ->
                                    getString(R.string.stream_ai_rate_error)
                                StreamAiSearchClient.Problem.SERVICE ->
                                    getString(R.string.stream_ai_chat_error)
                                else -> getString(R.string.stream_ai_connection_error)
                            }
                            pending.text = answer
                            record(question, answer)
                        }
                    }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                val error = getString(R.string.stream_ai_chat_error)
                pending.text = error
                record(question, error)
            } finally {
                if (!isDestroyed) {
                    busy = false
                    send.isEnabled = true
                    scrollBottom()
                }
            }
        }
    }

    private suspend fun findMatches(
        parsed: StreamAiSearchClient.Intent, question: String
    ): AiChatCatalogResolver.Results = withContext(Dispatchers.IO) {
        val dao = BlofyDatabase.get(applicationContext).dao()
        val providers = dao.providersStored().first()
            .filter { it.enabled }.take(4)
        AiChatCatalogResolver.find(dao, providers.map { it.id }, parsed,
            question, applicationContext)
    }

    private fun record(question: String, reply: String) {
        history.add(question.take(160) to reply.take(400))
        while (history.size > 8) history.removeAt(0)
    }

    private fun addBubble(message: String, fromUser: Boolean): TextView {
        val outer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (fromUser) Gravity.END else Gravity.START
            setPadding(0, dp(3), 0, dp(8))
        }
        val body = TextView(this).apply {
            text = message
            textSize = 15f
            maxLines = 8
            setTextColor(if (fromUser) CinemaStyle.Background else CinemaStyle.White)
            setPadding(dp(18), dp(13), dp(18), dp(13))
            background = if (fromUser) CinemaStyle.buttonBackground(this@AiChatActivity, true, false)
                else CinemaStyle.surface(this@AiChatActivity)
            gravity = Gravity.START
        }
        outer.addView(body, LinearLayout.LayoutParams(-2, -2).apply {
            width = if (resources.configuration.screenWidthDp < 650) dp(270) else dp(610)
        })
        transcript.addView(outer, LinearLayout.LayoutParams(-1, -2))
        scrollBottom()
        return body
    }

    private fun addTitleButtons(titles: List<StreamEntity>) {
        val group = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START
            setPadding(dp(6), 0, dp(6), dp(12))
        }
        val english = ConfigurationCompat.getLocales(resources.configuration)[0]?.language == "en"
        group.addView(TextView(this).apply {
            text = if (english) "Open the title's details, or search by its name"
                else "اضغط على العنوان لفتح تفاصيله مباشرة، أو اختر بحث بالاسم"
            textSize = 12.5f
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(dp(8), dp(3), 0, dp(8))
        })
        var firstResult: Button? = null
        titles.take(10).forEach { item ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutDirection = resources.configuration.layoutDirection
                gravity = Gravity.CENTER_VERTICAL
            }
            val resultButton = Button(this).apply {
                text = "▶  " + item.name.take(70) +
                    item.year?.takeIf(String::isNotBlank)?.let { "  (" + it + ")" }.orEmpty()
                contentDescription = if (english) "Open details for " + item.name
                    else "فتح تفاصيل " + item.name
                CinemaStyle.styleButton(this, primary = true)
                isAllCaps = false
                isSingleLine = false
                maxLines = 2
                minHeight = dp(50)
                setOnClickListener { openVerifiedTitle(item) }
            }
            val searchButton = Button(this).apply {
                text = if (english) "Search" else "بحث"
                contentDescription = if (english) "Search for " + item.name
                    else "بحث عن " + item.name
                isAllCaps = false
                CinemaStyle.styleButton(this)
                setOnClickListener { searchForTitle(item.name) }
            }
            row.addView(resultButton, LinearLayout.LayoutParams(0, dp(55), 1f))
            row.addView(searchButton, LinearLayout.LayoutParams(dp(if (english) 103 else 83), dp(55)).apply {
                marginStart = dp(7)
            })
            if (firstResult == null) firstResult = resultButton
            group.addView(row, LinearLayout.LayoutParams(-1, dp(59)).apply {
                bottomMargin = dp(5)
            })
        }
        transcript.addView(group, LinearLayout.LayoutParams(-1, -2))
        scrollBottom()
        if (DeviceClass.detect(this) == DeviceClass.Kind.TV) {
            val target = firstResult
            transcript.post { if (!isFinishing && !isDestroyed) target?.requestFocus() }
        }
    }

    /** Details are opened only for items verified in the subscriber's local catalog. */
    private fun openVerifiedTitle(item: StreamEntity) {
        if (item.providerId.isBlank() || item.key.isBlank() || item.locked) return
        val destination = when (item.kind) {
            "movie" -> MovieDetailsActivity::class.java
            "series" -> SeriesDetailsActivity::class.java
            else -> { searchForTitle(item.name); return }
        }
        startActivity(Intent(this, destination).apply {
            putExtra(MovieDetailsActivity.EXTRA_PROVIDER_ID, item.providerId)
            putExtra(MovieDetailsActivity.EXTRA_CONTENT_KEY, item.key)
        })
    }

    private fun searchForTitle(title: String) {
        if (title.isBlank()) return
        // Search ALL local indexes when a verified result belongs to a
        // different provider than the currently active search section.
        startActivity(Intent(this, SearchActivity::class.java).apply {
            putExtra(SearchActivity.EXTRA_INITIAL_QUERY, title.trim().take(120))
        })
    }

    private fun scrollBottom() {
        if (!::conversationScroll.isInitialized) return
        conversationScroll.post {
            if (!isDestroyed) conversationScroll.smoothScrollTo(0, transcript.bottom)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putStringArrayList("user_lines",
            ArrayList(history.map { it.first }))
        outState.putStringArrayList("bot_lines",
            ArrayList(history.map { it.second }))
        outState.putString("last_question", lastQuestion)
        super.onSaveInstanceState(outState)
    }

    private fun dp(value: Int) =
        (value * resources.displayMetrics.density).toInt()
}
