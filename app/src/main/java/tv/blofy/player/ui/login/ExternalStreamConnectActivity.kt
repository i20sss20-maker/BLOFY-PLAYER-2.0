package tv.blofy.player.ui.login

import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.BuildConfig
import tv.blofy.player.core.identity.ExternalStreamConnectCatalog
import tv.blofy.player.core.identity.ExternalStreamConnectClient
import tv.blofy.player.core.identity.ExternalStreamConnectOnboarding
import tv.blofy.player.core.identity.ExternalStreamConnectStore
import tv.blofy.player.core.identity.ExternalStreamConnectVerifier
import tv.blofy.player.ui.common.BlofyTvDesign

/** Private QA entry point. Separate from the production BLOFY library and session. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class ExternalStreamConnectActivity : AppCompatActivity() {
    private lateinit var panel: LinearLayout
    private lateinit var status: TextView
    private lateinit var code: EditText
    private lateinit var pairButton: Button
    private lateinit var clearButton: Button
    private lateinit var library: LinearLayout
    private lateinit var list: ListView
    private lateinit var search: EditText
    private lateinit var playerView: PlayerView
    private var player: ExoPlayer? = null
    private var job: Job? = null
    private var credentials: ExternalStreamConnectClient.Credentials? = null
    private var items = emptyList<ExternalStreamConnectCatalog.Item>()
    private var displayed = emptyList<ExternalStreamConnectCatalog.Item>()
    private var currentKind = ExternalStreamConnectCatalog.Kind.LIVE

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; isFocusable = true
        setOnClickListener { action() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!BuildConfig.CODE_ONLY_LOGIN) { finish(); return }
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16),dp(12),dp(16),dp(12))
            setBackgroundColor(0xff0f1420.toInt())
        }
        setContentView(panel)
        panel.addView(TextView(this).apply {
            text = "BLOFY STREAM CONNECT"
            textSize = 23f; setTextColor(BlofyTvDesign.TextPrimary)
        })
        status = TextView(this).apply {
            text = "أدخل كود CONNECT"
            setTextColor(BlofyTvDesign.TextPrimary); textSize = 15f
        }
        panel.addView(status)
        code = EditText(this).apply {
            hint = "أدخل 12 رقمًا"
            inputType = InputType.TYPE_CLASS_NUMBER
            isSingleLine = true
            isSaveEnabled = false
            filters = arrayOf(android.text.InputFilter.LengthFilter(12))
        }
        panel.addView(code)
        panel.addView(button("تبديل إلى الكود القديم / الرقمي") {
            val numeric = code.inputType == InputType.TYPE_CLASS_NUMBER
            code.text?.clear()
            code.inputType = if (numeric) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS else InputType.TYPE_CLASS_NUMBER
            code.filters = arrayOf(android.text.InputFilter.LengthFilter(if (numeric) 27 else 12))
            code.hint = if (numeric) "BC-..." else "أدخل 12 رقمًا"
        })
        pairButton = button("ربط الاشتراك الخارجي") { pair() }
        panel.addView(pairButton)
        clearButton = button("حذف الاشتراك الخارجي من الجهاز") {
            stopPlayer(); job?.cancel(); credentials = null; items = emptyList()
            library.visibility = View.GONE; code.visibility = View.VISIBLE
            pairButton.visibility = View.VISIBLE; pairButton.isEnabled = false; clearButton.isEnabled = false
            lifecycleScope.launch {
                val ok = withContext(Dispatchers.IO) {
                    runCatching { ExternalStreamConnectStore.clear(applicationContext) }.isSuccess
                }
                status.text = if(ok) "تم حذف ملف CONNECT المحلي" else "تعذر حذف الملف المحلي"
                pairButton.isEnabled = true; clearButton.isEnabled = true
            }
        }
        panel.addView(clearButton)
        library = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; visibility = View.GONE }
        panel.addView(library,LinearLayout.LayoutParams(-1,0,1f))
        val tabs = LinearLayout(this)
        for ((kind,label) in listOf(
            ExternalStreamConnectCatalog.Kind.LIVE to "مباشر",
            ExternalStreamConnectCatalog.Kind.MOVIE to "أفلام",
            ExternalStreamConnectCatalog.Kind.SERIES to "مسلسلات")) {
            tabs.addView(button(label) { load(kind) },LinearLayout.LayoutParams(0,-2,1f))
        }
        library.addView(tabs)
        search = EditText(this).apply { hint = "بحث في القسم"; isSingleLine = true }
        library.addView(search)
        search.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?,start: Int,count: Int,after: Int) {}
            override fun onTextChanged(s: CharSequence?,start: Int,before: Int,count: Int) { renderItems() }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })
        playerView = PlayerView(this).apply { visibility = View.GONE; useController = true }
        library.addView(playerView,LinearLayout.LayoutParams(-1,dp(220)))
        library.addView(button("إيقاف المشاهدة") { stopPlayer() })
        list = ListView(this).apply {
            setOnItemClickListener { _,_,position,_ ->
                val item = displayed.getOrNull(position) ?: return@setOnItemClickListener
                if(item.kind==ExternalStreamConnectCatalog.Kind.SERIES)
                    load(ExternalStreamConnectCatalog.Kind.EPISODE,item.id)
                else play(item)
            }
        }
        library.addView(list,LinearLayout.LayoutParams(-1,0,1f))
        restore()
    }

    private fun restore() {
        pairButton.isEnabled = false; clearButton.isEnabled = false
        job = lifecycleScope.launch {
            try {
            val saved = withContext(Dispatchers.IO) { ExternalStreamConnectStore.load(applicationContext) }
                ?: return@launch
            pairButton.isEnabled = false
            status.text = "جارٍ التحقق من الاشتراك المحفوظ..."
            val state = ExternalStreamConnectVerifier.verify(saved)
            pairButton.isEnabled = true
            if(state.status==ExternalStreamConnectVerifier.Status.ACTIVE) openLibrary(saved)
            else status.text = "تعذر التحقق من الاشتراك المحفوظ. حاول ربطه مجددًا"
            } finally { pairButton.isEnabled = true; clearButton.isEnabled = true }
        }
    }
    private fun pair() {
        val value = ExternalStreamConnectClient.normalizeCode(code.text.toString())
        if(value==null){status.text="أدخل كود CONNECT صحيحًا";return}
        job?.cancel(); stopPlayer(); pairButton.isEnabled=false; clearButton.isEnabled=false; code.text?.clear()
        status.text="جارٍ الربط والتحقق لدى المزود..."
        job=lifecycleScope.launch {
            try {
                val state=ExternalStreamConnectOnboarding.pair(applicationContext,value)
                if(state.status!=ExternalStreamConnectVerifier.Status.ACTIVE){
                    status.text="لم يؤكد المزود صلاحية الاشتراك. أنشئ كود ربط جديدًا عند المحاولة"
                    return@launch
                }
                val saved=withContext(Dispatchers.IO){ExternalStreamConnectStore.load(applicationContext)}
                    ?: error("profile unavailable")
                openLibrary(saved)
            } catch(cancelled: CancellationException){throw cancelled}
            catch(_: Exception){status.text="تعذر الربط. تحقق من الكود واتصال الإنترنت"}
            finally{pairButton.isEnabled=true; clearButton.isEnabled=true}
        }
    }
    private fun openLibrary(saved: ExternalStreamConnectClient.Credentials) {
        credentials=saved;code.visibility=View.GONE;pairButton.visibility=View.GONE
        library.visibility=View.VISIBLE;load(ExternalStreamConnectCatalog.Kind.LIVE)
    }
    private fun load(kind: ExternalStreamConnectCatalog.Kind,seriesId: String?=null) {
        val profile=credentials ?: return
        job?.cancel();stopPlayer();currentKind=kind;items=emptyList();search.text?.clear();renderItems()
        status.text="جارٍ تحميل القائمة مباشرة من مزودك..."
        job=lifecycleScope.launch {
            try {
                items=ExternalStreamConnectCatalog.list(profile,kind,seriesId)
                renderItems()
                status.text="تم تحميل "+items.size+" عنصر • CONNECT"
            }catch(cancelled: CancellationException){throw cancelled}
            catch(_: Exception){status.text="تعذر تحميل هذا القسم أو تجاوز حد النسخة التجريبية"}
        }
    }
    private fun renderItems() {
        if(!::list.isInitialized)return
        val q=search.text.toString().trim()
        displayed=items.filter{q.isBlank()||it.title.contains(q,ignoreCase=true)}.take(2000)
        list.adapter=ArrayAdapter(this,android.R.layout.simple_list_item_1,displayed.map{it.title})
    }
    private fun play(item: ExternalStreamConnectCatalog.Item) {
        val profile=credentials ?: return
        stopPlayer()
        try{
            val target=ExternalStreamConnectCatalog.playback(profile,item)
            val media=ProgressiveMediaSource.Factory(OkHttpDataSource.Factory(target.client))
                .createMediaSource(MediaItem.fromUri(target.uri))
            val next=ExoPlayer.Builder(this).build()
            player=next;playerView.player=next;playerView.visibility=View.VISIBLE
            next.addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    status.text="تعذر تشغيل هذا العنصر مباشرة من المزود"
                }
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if(playbackState==Player.STATE_READY)status.text="جاهز للمشاهدة • CONNECT"
                }
            })
            next.setMediaSource(media);next.prepare();next.playWhenReady=true
        }catch(_: Exception){stopPlayer();status.text="صيغة التشغيل غير متوافقة مع النسخة التجريبية"}
    }
    private fun stopPlayer(){playerView.player=null;player?.release();player=null;playerView.visibility=View.GONE}
    override fun onStop(){if(::playerView.isInitialized)stopPlayer();super.onStop()}
    override fun onDestroy(){job?.cancel();if(::playerView.isInitialized)stopPlayer();credentials=null;super.onDestroy()}
}
