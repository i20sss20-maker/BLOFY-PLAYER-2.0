package tv.blofy.player.ui.search

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
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
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.CinemaStyle

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
            fillViewport = true
            isVerticalScrollBarEnabled = false
            isFocusable = false
            clipToPadding = false
            addView(transcript, ScrollView.LayoutParams(-1, -2))
        }
        root.addView(conversationScroll, LinearLayout.LayoutParams(-1, 0, 1f))

        val suggestions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutDirection = resources.configuration.layoutDirection
        }
        listOf(
            R.string.stream_ai_quick_action to R.string.stream_chat_action_prompt,
            R.string.stream_ai_quick_comedy to R.string.stream_chat_comedy_prompt,
            R.string.stream_ai_quick_series to R.string.stream_chat_series_prompt
        ).forEach { (label, prompt) ->
            suggestions.addView(Button(this).apply {
                text = getString(label)
                CinemaStyle.styleButton(this)
                setOnClickListener { ask(getString(prompt)) }
            }, LinearLayout.LayoutParams(dp(154), dp(43)).apply { marginEnd = dp(8) })
        }
        root.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            isFocusable = false
            addView(suggestions)
        }, LinearLayout.LayoutParams(-1, dp(51)).apply { bottomMargin = dp(8) })

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
                        val matches = withContext(Dispatchers.IO) {
                            val dao = BlofyDatabase.get(applicationContext).dao()
                            val providers = dao.providersStored().first()
                                .filter { it.enabled }.take(4)
                            AiChatCatalogResolver.find(dao, providers.map { it.id }, parsed,
                                question, applicationContext)
                        }
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
        group.addView(TextView(this).apply {
            text = getString(R.string.stream_chat_tap_to_search)
            textSize = 12.5f
            setTextColor(BlofyTvDesign.TextMuted)
            setPadding(dp(8), dp(3), 0, dp(8))
        })
        titles.take(10).forEach { movie ->
            group.addView(Button(this).apply {
                text = "⌕  " + movie.name.take(70) +
                    movie.year?.takeIf(String::isNotBlank)?.let { "  ($it)" }.orEmpty()
                contentDescription = getString(R.string.stream_chat_search_title, movie.name)
                CinemaStyle.styleButton(this)
                isSingleLine = false
                maxLines = 2
                minHeight = dp(49)
                setOnClickListener {
                    startActivity(Intent(this@AiChatActivity, SearchActivity::class.java).apply {
                        putExtra(SearchActivity.EXTRA_KIND, movie.kind)
                        putExtra(SearchActivity.EXTRA_INITIAL_QUERY, movie.name)
                    })
                }
            }, LinearLayout.LayoutParams(-1, dp(51)).apply {
                bottomMargin = dp(6)
            })
        }
        transcript.addView(group, LinearLayout.LayoutParams(-1, -2))
        scrollBottom()
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
