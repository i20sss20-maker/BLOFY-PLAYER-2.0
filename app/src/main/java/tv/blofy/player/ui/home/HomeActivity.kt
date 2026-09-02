package tv.blofy.player.ui.home

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tv.blofy.player.R
import tv.blofy.player.core.device.DeviceClass
import tv.blofy.player.core.remote.FocusMemory
import tv.blofy.player.core.theme.ThemeManager
import tv.blofy.player.core.theme.ThemeProfile
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.catalog.PosterCatalogActivity
import tv.blofy.player.ui.details.MovieDetailsActivity
import tv.blofy.player.ui.details.SeriesDetailsActivity
import tv.blofy.player.ui.library.LibraryActivity
import tv.blofy.player.ui.library.RecentChannelsActivity
import tv.blofy.player.ui.mobile.MobileContentActivity
import tv.blofy.player.ui.search.SearchActivity
import tv.blofy.player.ui.settings.SettingsActivity

class HomeActivity : AppCompatActivity() {
    private lateinit var theme: ThemeProfile
    private lateinit var deviceKind: DeviceClass.Kind
    private var firstAction: View? = null
    private val actionViews = linkedMapOf<String, View>()
    private var heroImage: ImageView? = null
    private var heroEyebrow: TextView? = null
    private var heroTitle: TextView? = null
    private var heroMeta: TextView? = null
    private var heroDescription: TextView? = null
    private var heroPrimary: Button? = null
    private var heroContent: StreamEntity? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        theme = ThemeManager.current(this)
        deviceKind = DeviceClass.detect(this)
        setContentView(if (deviceKind == DeviceClass.Kind.TV) buildTvHome() else buildCompactHome())
        restoreFocus()
        loadDynamicHeroAndWarmArtwork()
    }

    private fun loadDynamicHeroAndWarmArtwork() {
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                val dao = BlofyDatabase.get(applicationContext).dao()
                val provider = dao.providers().first().firstOrNull() ?: return@withContext null
                val latest = dao.latestHomeStreams(provider.id, 28)
                provider.id to latest
            } ?: return@launch
            val items = result.second
            ArtworkLoader.warmPrefetch(this@HomeActivity, items.map { it.backdrop ?: it.icon })
            if (deviceKind == DeviceClass.Kind.TV) bindHero(items.firstOrNull())
        }
    }

    private fun bindHero(item: StreamEntity?) {
        if (item == null) return
        heroContent = item
        heroEyebrow?.text = if (item.kind == "series") "BLOFY  •  مسلسل مميز" else "BLOFY  •  فيلم مميز"
        heroTitle?.text = item.name
        heroMeta?.text = listOfNotNull(item.year?.takeIf { it.isNotBlank() }, item.rating?.takeIf { it.isNotBlank() }?.let { "★ $it" }, item.genre?.takeIf { it.isNotBlank() }?.substringBefore(',')).joinToString("   •   ")
        heroDescription?.text = item.plot?.takeIf { it.isNotBlank() } ?: "اكتشف أحدث المحتوى المحفوظ في قائمتك واستمتع بتجربة BLOFY السينمائية."
        ArtworkLoader.loadPriority(heroImage ?: return, listOf(item.backdrop, item.icon))
        heroPrimary?.text = if (item.kind == "series") "عرض المسلسل" else "شاهد الآن"
        heroPrimary?.setOnClickListener { openHero(item) }
    }

    private fun openHero(item: StreamEntity) {
        startActivity(Intent(this, if (item.kind == "series") SeriesDetailsActivity::class.java else MovieDetailsActivity::class.java).apply {
            putExtra("provider_id", item.providerId)
            putExtra("content_key", item.key)
        })
    }

    private fun buildTvHome(): FrameLayout {
        val root = FrameLayout(this).apply { background = AppCompatResources.getDrawable(this@HomeActivity, R.drawable.blofy_home_background); clipChildren = false }
        val shell = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_LTR; setPadding(dp(20), dp(16), dp(20), dp(18)); clipChildren = false }
        root.addView(shell, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        shell.addView(buildSidebar(), LinearLayout.LayoutParams(dp(190), LinearLayout.LayoutParams.MATCH_PARENT).apply { marginEnd = dp(20) })
        val main = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; clipChildren = false }
        shell.addView(main, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
        main.addView(TextView(this).apply { text = "BLOFY PLAYER"; textSize = 11.5f; letterSpacing = .14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(-1, dp(27)))
        main.addView(TextView(this).apply { text = "وش بتشاهد اليوم؟"; textSize = 25f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT or Gravity.CENTER_VERTICAL }, LinearLayout.LayoutParams(-1, dp(43)))
        main.addView(buildHero(), LinearLayout.LayoutParams(-1, 0, 1.7f))
        val quick = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; layoutDirection = View.LAYOUT_DIRECTION_RTL; setPadding(0, dp(12), 0, dp(12)); clipChildren = false }
        quick.addView(infoCard("تابع المشاهدة", "أكمل من آخر نقطة", "continue", Intent(this, LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE, LibraryActivity.MODE_CONTINUE)), LinearLayout.LayoutParams(0, -1, 1f).apply { marginStart = dp(10) })
        quick.addView(infoCard("آخر القنوات", "ارجع للبث فورًا", "recent", Intent(this, RecentChannelsActivity::class.java)), LinearLayout.LayoutParams(0, -1, 1f))
        main.addView(quick, LinearLayout.LayoutParams(-1, 0, .64f))
        main.addView(TextView(this).apply { text = "استكشف BLOFY"; textSize = 17.5f; typeface = Typeface.DEFAULT_BOLD; setTextColor(TEXT_PRIMARY); gravity = Gravity.RIGHT }, LinearLayout.LayoutParams(-1, dp(34)))
        val cards = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = View.LAYOUT_DIRECTION_RTL; gravity = Gravity.CENTER; clipChildren = false }
        addStory(cards,"live_story","البث المباشر","قنواتك الآن",contentIntent("live")); addStory(cards,"movie_story","الأفلام","سينما",contentIntent("movie")); addStory(cards,"series_story","المسلسلات","مواسم وحلقات",contentIntent("series")); addStory(cards,"favorite_story","المفضلة","اختياراتك",Intent(this,LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE,LibraryActivity.MODE_FAVORITES)); addStory(cards,"search_story","البحث","ابحث فورًا",Intent(this,SearchActivity::class.java))
        main.addView(cards, LinearLayout.LayoutParams(-1,0,.57f)); return root
    }

    private fun buildHero(): FrameLayout {
        val frame = FrameLayout(this).apply { background = heroSurface(); clipToOutline = true; elevation = dp(5).toFloat() }
        heroImage = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; alpha = .52f }
        frame.addView(heroImage, FrameLayout.LayoutParams(-1,-1))
        val shade = View(this).apply { background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(0xF20D0915.toInt(),0xB8171024.toInt(),0x30171024)) }
        frame.addView(shade, FrameLayout.LayoutParams(-1,-1))
        val copy = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; gravity=Gravity.CENTER_VERTICAL or Gravity.RIGHT; layoutDirection=View.LAYOUT_DIRECTION_RTL; setPadding(dp(36),dp(20),dp(36),dp(20)) }
        heroEyebrow = TextView(this).apply { text="BLOFY PREMIUM"; textSize=12.5f; typeface=Typeface.DEFAULT_BOLD; setTextColor(PURPLE_BRIGHT); gravity=Gravity.RIGHT }
        heroTitle = TextView(this).apply { text="كل محتواك في مكان واحد"; textSize=36f; typeface=Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE); gravity=Gravity.RIGHT; maxLines=2; setPadding(0,dp(5),0,0) }
        heroMeta = TextView(this).apply { text="أفلام  •  مسلسلات  •  بث مباشر"; textSize=13f; typeface=Typeface.DEFAULT_BOLD; setTextColor(0xFFE8D8FA.toInt()); gravity=Gravity.RIGHT; setPadding(0,dp(6),0,0) }
        heroDescription = TextView(this).apply { text="تجربة مشاهدة سريعة ومصممة للتلفزيون."; textSize=15f; setTextColor(TEXT_SECONDARY); gravity=Gravity.RIGHT; maxLines=2; setPadding(0,dp(7),0,dp(14)) }
        copy.addView(heroEyebrow); copy.addView(heroTitle); copy.addView(heroMeta); copy.addView(heroDescription)
        val row=LinearLayout(this).apply { orientation=LinearLayout.HORIZONTAL; layoutDirection=View.LAYOUT_DIRECTION_RTL; gravity=Gravity.RIGHT }
        heroPrimary=heroButton("شاهد الآن","hero_watch",contentIntent("live"),true); row.addView(heroPrimary,LinearLayout.LayoutParams(dp(170),dp(56)).apply{marginStart=dp(9)})
        row.addView(heroButton("استكشف الأفلام","hero_movies",contentIntent("movie"),false),LinearLayout.LayoutParams(dp(180),dp(56))); copy.addView(row)
        frame.addView(copy,FrameLayout.LayoutParams(-1,-1)); return frame
    }

    private fun buildSidebar()=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.TOP or Gravity.CENTER_HORIZONTAL;layoutDirection=View.LAYOUT_DIRECTION_RTL;setPadding(dp(12),dp(12),dp(12),dp(12));background=surface(false);elevation=dp(5).toFloat();addView(ImageView(this@HomeActivity).apply{setImageResource(R.drawable.blofy_logo);scaleType=ImageView.ScaleType.CENTER_INSIDE},LinearLayout.LayoutParams(dp(112),dp(80)).apply{bottomMargin=dp(8)});addView(sideSelected("⌂","الرئيسية"));addView(sideAction("side_live","◉","بث مباشر",contentIntent("live")));addView(sideAction("side_movies","▣","الأفلام",contentIntent("movie")));addView(sideAction("side_series","▤","المسلسلات",contentIntent("series")));addView(sideAction("side_favorites","♡","المفضلة",Intent(this@HomeActivity,LibraryActivity::class.java).putExtra(LibraryActivity.EXTRA_MODE,LibraryActivity.MODE_FAVORITES)));addView(sideAction("side_search","⌕","بحث",Intent(this@HomeActivity,SearchActivity::class.java)));addView(sideAction("side_settings","⚙","الإعدادات",Intent(this@HomeActivity,SettingsActivity::class.java)))}
    private fun sideBase(icon:String,label:String)=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL;layoutDirection=View.LAYOUT_DIRECTION_RTL;setPadding(dp(12),0,dp(12),0);addView(TextView(this@HomeActivity).apply{text=label;textSize=15f;typeface=Typeface.DEFAULT_BOLD;setTextColor(TEXT_PRIMARY);gravity=Gravity.RIGHT or Gravity.CENTER_VERTICAL},LinearLayout.LayoutParams(0,-1,1f));addView(TextView(this@HomeActivity).apply{text=icon;textSize=20f;setTextColor(PURPLE_BRIGHT);gravity=Gravity.CENTER},LinearLayout.LayoutParams(dp(36),-1))}.also{it.layoutParams=LinearLayout.LayoutParams(-1,dp(54)).apply{bottomMargin=dp(4)}}
    private fun sideSelected(icon:String,label:String)=sideBase(icon,label).apply{background=selectedSurface()}
    private fun sideAction(key:String,icon:String,label:String,intent:Intent)=sideBase(icon,label).apply{isFocusable=true;isFocusableInTouchMode=true;isClickable=true;background=transparentSurface(false);setOnFocusChangeListener{v,f->v.background=transparentSurface(f);childrenTextColor(this,f);if(f)FocusMemory.save(this@HomeActivity,SCREEN_KEY,key);v.animate().scaleX(if(f)1.025f else 1f).scaleY(if(f)1.025f else 1f).translationZ(if(f)dp(8).toFloat() else 1f).setDuration(85).start()};setOnClickListener{startActivity(intent)};registerAction(key,this)}
    private fun heroButton(label:String,key:String,intent:Intent,primary:Boolean)=Button(this).apply{text=label;isAllCaps=false;textSize=15f;typeface=Typeface.DEFAULT_BOLD;isFocusable=true;isFocusableInTouchMode=true;setTextColor(Color.WHITE);background=buttonSurface(primary,false);setOnFocusChangeListener{v,f->v.background=buttonSurface(primary,f);if(f)FocusMemory.save(this@HomeActivity,SCREEN_KEY,key);v.animate().scaleX(if(f)1.035f else 1f).scaleY(if(f)1.035f else 1f).translationZ(if(f)10f else 1f).setDuration(90).start()};setOnClickListener{startActivity(intent)};registerAction(key,this)}
    private fun infoCard(title:String,subtitle:String,key:String,intent:Intent)=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER_VERTICAL or Gravity.RIGHT;layoutDirection=View.LAYOUT_DIRECTION_RTL;setPadding(dp(22),dp(13),dp(22),dp(13));background=surface(false);isFocusable=true;isFocusableInTouchMode=true;isClickable=true;addView(TextView(this@HomeActivity).apply{text=title;textSize=18f;typeface=Typeface.DEFAULT_BOLD;setTextColor(TEXT_PRIMARY);gravity=Gravity.RIGHT});addView(TextView(this@HomeActivity).apply{text=subtitle;textSize=12.5f;setTextColor(TEXT_MUTED);gravity=Gravity.RIGHT;setPadding(0,dp(4),0,dp(7))});addView(TextView(this@HomeActivity).apply{text="استمرار  ←";textSize=13f;typeface=Typeface.DEFAULT_BOLD;setTextColor(PURPLE_BRIGHT);gravity=Gravity.RIGHT});setOnFocusChangeListener{v,f->v.background=surface(f);if(f)FocusMemory.save(this@HomeActivity,SCREEN_KEY,key);v.animate().scaleX(if(f)1.02f else 1f).scaleY(if(f)1.02f else 1f).translationZ(if(f)8f else 1f).setDuration(85).start()};setOnClickListener{startActivity(intent)};registerAction(key,this)}
    private fun addStory(row:LinearLayout,key:String,title:String,subtitle:String,intent:Intent){val card=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.BOTTOM or Gravity.RIGHT;layoutDirection=View.LAYOUT_DIRECTION_RTL;setPadding(dp(14),dp(11),dp(14),dp(11));background=storySurface(false);isFocusable=true;isFocusableInTouchMode=true;isClickable=true;addView(TextView(this@HomeActivity).apply{text=title;textSize=14.5f;typeface=Typeface.DEFAULT_BOLD;setTextColor(TEXT_PRIMARY);gravity=Gravity.RIGHT});addView(TextView(this@HomeActivity).apply{text=subtitle;textSize=10.5f;setTextColor(TEXT_MUTED);gravity=Gravity.RIGHT});setOnFocusChangeListener{v,f->v.background=storySurface(f);childrenTextColor(this,f);if(f)FocusMemory.save(this@HomeActivity,SCREEN_KEY,key);v.animate().scaleX(if(f)1.045f else 1f).scaleY(if(f)1.045f else 1f).translationZ(if(f)dp(10).toFloat() else 1f).setDuration(90).