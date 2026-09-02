package tv.blofy.player.ui.details

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.player.PlayerActivity
import tv.blofy.player.ui.series.EpisodesActivity

class SeriesDetailsActivity : AppCompatActivity() {
    private lateinit var favoriteButton: Button
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId=intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty();val contentKey=intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty();if(providerId.isBlank()||contentKey.isBlank()){finish();return}
        val root=FrameLayout(this).apply{setBackgroundColor(0xFF090711.toInt())}
        val backdrop=ImageView(this).apply{scaleType=ImageView.ScaleType.CENTER_CROP;alpha=.55f};root.addView(backdrop,FrameLayout.LayoutParams(-1,-1))
        root.addView(View(this).apply{background=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,intArrayOf(0xFA090711.toInt(),0xE30D0915.toInt(),0x75171024,0x22090711))},FrameLayout.LayoutParams(-1,-1))
        val body=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;layoutDirection=View.LAYOUT_DIRECTION_LTR;gravity=Gravity.CENTER_VERTICAL;setPadding(dp(56),dp(36),dp(56),dp(36))};root.addView(body,FrameLayout.LayoutParams(-1,-1));setContentView(root)
        val posterCard=LinearLayout(this).apply{gravity=Gravity.CENTER;setPadding(dp(7),dp(7),dp(7),dp(7));background=cardBackground();elevation=dp(10).toFloat()};val poster=ImageView(this).apply{scaleType=ImageView.ScaleType.CENTER_CROP;setBackgroundColor(0xFF16101F.toInt())};posterCard.addView(poster,LinearLayout.LayoutParams(dp(290),dp(435)));body.addView(posterCard,LinearLayout.LayoutParams(dp(304),dp(449)).apply{marginEnd=dp(42)})
        val panel=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER_VERTICAL or Gravity.END;layoutDirection=View.LAYOUT_DIRECTION_RTL};body.addView(panel,LinearLayout.LayoutParams(0,-1,1f))
        lifecycleScope.launch{
            val dao=BlofyDatabase.get(applicationContext).dao();val provider=dao.provider(providerId)?:run{finish();return@launch};val stream=dao.stream(contentKey)?:run{finish();return@launch};ArtworkLoader.loadPriority(backdrop,listOf(stream.backdrop,stream.icon));ArtworkLoader.loadPriority(poster,listOf(stream.icon,stream.backdrop))
            val allEpisodes=dao.episodes(providerId,stream.remoteId).first();val resume=allEpisodes.mapNotNull{e->val w=dao.watchState(e.key)?:return@mapNotNull null;if(w.completed||w.positionMs<=15000L)null else Resume(e,w.positionMs,w.durationMs,w.updatedAt)}.maxByOrNull{it.updatedAt};val seasons=allEpisodes.map{it.season}.distinct().size
            panel.addView(TextView(this@SeriesDetailsActivity).apply{text="BLOFY SERIES";textSize=12f;letterSpacing=.12f;typeface=BlofyTvDesign.HeadingTypeface;setTextColor(BlofyTvDesign.PurpleBright);gravity=Gravity.RIGHT})
            panel.addView(TextView(this@SeriesDetailsActivity).apply{text=stream.name;textSize=42f;typeface=BlofyTvDesign.HeadingTypeface;setTextColor(Color.WHITE);gravity=Gravity.RIGHT;maxLines=2;includeFontPadding=false})
            panel.addView(TextView(this@SeriesDetailsActivity).apply{text=buildList{add("مسلسل");stream.year?.takeIf(String::isNotBlank)?.let(::add);if(seasons>0)add("$seasons موسم");if(allEpisodes.isNotEmpty())add("${allEpisodes.size} حلقة");stream.rating?.takeIf(String::isNotBlank)?.let{add("★ $it")};stream.genre?.takeIf(String::isNotBlank)?.substringBefore(',')?.let(::add)}.joinToString("   •   ");textSize=14.5f;typeface=BlofyTvDesign.BodyTypeface;setTextColor(0xFFE8D8FA.toInt());gravity=Gravity.RIGHT;setPadding(0,dp(9),0,dp(15))})
            panel.addView(TextView(this@SeriesDetailsActivity).apply{text=stream.plot?.takeIf(String::isNotBlank)?:"اختر الموسم والحلقة لبدء المشاهدة.";textSize=16.5f;typeface=BlofyTvDesign.BodyTypeface;maxLines=5;setTextColor(BlofyTvDesign.TextSecondary);gravity=Gravity.RIGHT;setLineSpacing(0f,1.18f);setPadding(0,0,0,dp(18))})
            resume?.let{r->val pct=if(r.durationMs>0)((r.positionMs*100)/r.durationMs).toInt().coerceIn(1,99) else 0;panel.addView(TextView(this@SeriesDetailsActivity).apply{text="متابعة الموسم ${r.episode.season}   •   الحلقة ${r.episode.episode}${if(pct>0)"   •   $pct%" else ""}";textSize=13.5f;typeface=BlofyTvDesign.HeadingTypeface;setTextColor(BlofyTvDesign.Mint);gravity=Gravity.RIGHT});if(r.durationMs>0)panel.addView(ProgressBar(this@SeriesDetailsActivity,null,android.R.attr.progressBarStyleHorizontal).apply{max=100;progress=pct;progressTintList=android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright)},LinearLayout.LayoutParams(-1,dp(6)).apply{topMargin=dp(7);bottomMargin=dp(16)})}
            val row=LinearLayout(this@SeriesDetailsActivity).apply{orientation=LinearLayout.HORIZONTAL;layoutDirection=View.LAYOUT_DIRECTION_RTL;gravity=Gravity.RIGHT};var primary:Button?=null
            resume?.let{r->val b=actionButton("▶  استئناف الحلقة",true){launchEpisode(provider,r.episode,r.positionMs)};primary=b;row.addView(b,LinearLayout.LayoutParams(dp(220),dp(64)).apply{marginStart=dp(9)});row.addView(actionButton("↺  من البداية"){launchEpisode(provider,r.episode,0L)},LinearLayout.LayoutParams(dp(160),dp(64)).apply{marginStart=dp(9)})}
            val episodes=actionButton("▤  المواسم والحلقات",primary==null){startActivity(Intent(this@SeriesDetailsActivity,EpisodesActivity::class.java).apply{putExtra(EpisodesActivity.EXTRA_PROVIDER_ID,providerId);putExtra(EpisodesActivity.EXTRA_SERIES_ID,stream.remoteId);putExtra(EpisodesActivity.EXTRA_SERIES_NAME,stream.name);putExtra(EpisodesActivity.EXTRA_SERIES_ART,stream.backdrop?:stream.icon)})};if(primary==null)primary=episodes;row.addView(episodes,LinearLayout.LayoutParams(dp(230),dp(64)).apply{marginStart=dp(9)})
            favoriteButton=actionButton(if(stream.favorite)"★  المفضلة" else "☆  المفضلة"){lifecycleScope.launch{val c=dao.stream(contentKey)?:return@launch;dao.setFavorite(contentKey,!c.favorite);favoriteButton.text=if(!c.favorite)"★  المفضلة" else "☆  المفضلة"}};row.addView(favoriteButton,LinearLayout.LayoutParams(dp(165),dp(64)));panel.addView(row);primary?.requestFocus()
        }
    }
    private fun launchEpisode(p:ProviderEntity,e:EpisodeEntity,resume:Long){startActivity(Intent(this,PlayerActivity::class.java).apply{putExtra(PlayerActivity.EXTRA_URL,ContentUrlResolver.episode(p,e));putExtra(PlayerActivity.EXTRA_CONTENT_KEY,e.key);putExtra(PlayerActivity.EXTRA_PROVIDER_ID,p.id);putExtra(PlayerActivity.EXTRA_KIND,"episode");putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE,p.providerType);putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT,p.preferredTransport);putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE,p.preferredEngine);putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS,p.allowCrossProtocolRedirects);putExtra(PlayerActivity.EXTRA_FALLBACK_URL,ContentUrlResolver.directFallback(e));putExtra(PlayerActivity.EXTRA_RESUME_MS,resume);putExtra(PlayerActivity.EXTRA_TITLE,e.title);putExtra(PlayerActivity.EXTRA_SERIES_ID,e.seriesId);putExtra(PlayerActivity.EXTRA_SEASON,e.season);putExtra(PlayerActivity.EXTRA_EPISODE,e.episode)})}
    private fun actionButton(label:String,primary:Boolean=false,action:()->Unit)=Button(this).apply{text=label;isAllCaps=false;textSize=14.5f;typeface=BlofyTvDesign.HeadingTypeface;isFocusable=true;setTextColor(Color.WHITE);background=buttonBackground(false,primary);setOnFocusChangeListener{v,f->v.background=buttonBackground(f,primary);v.animate().scaleX(if(f)1.04f else 1f).scaleY(if(f)1.04f else 1f).translationZ(if(f)dp(12).toFloat() else dp(2).toFloat()).setDuration(90).start()};setOnClickListener{action()}}
    private fun cardBackground()=GradientDrawable(GradientDrawable.Orientation.TL_BR,intArrayOf(0xD92B203B.toInt(),0xE617111F.toInt())).apply{cornerRadius=dp(24).toFloat();setStroke(dp(1),0x996B4D88.toInt())}
    private fun buttonBackground(f:Boolean,p:Boolean)=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,when{p&&f->intArrayOf(0xFFA653FF.toInt(),0xFF7130D2.toInt());p->intArrayOf(0xFF843FE6.toInt(),0xFF5720AD.toInt());f->intArrayOf(0xFF633A8D.toInt(),0xFF35214C.toInt());else->intArrayOf(0xD92B203B.toInt(),0xE61A1325.toInt())}).apply{cornerRadius=dp(18).toFloat();setStroke(if(f)dp(2) else dp(1),if(f)BlofyTvDesign.PurpleBright else 0x99513C67.toInt())}
    private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt();private data class Resume(val episode:EpisodeEntity,val positionMs:Long,val durationMs:Long,val updatedAt:Long)
    companion object{const val EXTRA_PROVIDER_ID="provider_id";const val EXTRA_CONTENT_KEY="content_key"}
}
