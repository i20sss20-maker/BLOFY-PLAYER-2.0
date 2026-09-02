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
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import tv.blofy.player.core.playback.ContentUrlResolver
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.local.ProviderEntity
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.player.PlayerActivity

class MovieDetailsActivity : AppCompatActivity() {
    private lateinit var favoriteButton: Button
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val providerId=intent.getStringExtra(EXTRA_PROVIDER_ID).orEmpty(); val contentKey=intent.getStringExtra(EXTRA_CONTENT_KEY).orEmpty()
        if(providerId.isBlank()||contentKey.isBlank()){finish();return}
        val root=FrameLayout(this).apply{setBackgroundColor(0xFF090711.toInt())}
        val backdrop=ImageView(this).apply{scaleType=ImageView.ScaleType.CENTER_CROP;alpha=.58f}
        root.addView(backdrop,FrameLayout.LayoutParams(-1,-1))
        root.addView(View(this).apply{background=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,intArrayOf(0xFA090711.toInt(),0xDF0D0915.toInt(),0x75171024,0x20090711))},FrameLayout.LayoutParams(-1,-1))
        val body=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;layoutDirection=View.LAYOUT_DIRECTION_RTL;gravity=Gravity.CENTER_VERTICAL;setPadding(dp(58),dp(36),dp(58),dp(36))}
        root.addView(body,FrameLayout.LayoutParams(-1,-1));setContentView(root)
        lifecycleScope.launch{
            val dao=BlofyDatabase.get(applicationContext).dao();val provider=dao.provider(providerId)?:run{finish();return@launch};val stream=dao.stream(contentKey)?:run{finish();return@launch};val watch=dao.watchState(contentKey);val url=ContentUrlResolver.movie(provider,stream)
            ArtworkLoader.loadPriority(backdrop,listOf(stream.backdrop,stream.icon))
            val posterCard=LinearLayout(this@MovieDetailsActivity).apply{gravity=Gravity.CENTER;setPadding(dp(7),dp(7),dp(7),dp(7));background=cardBackground();elevation=dp(10).toFloat()}
            val poster=ImageView(this@MovieDetailsActivity).apply{scaleType=ImageView.ScaleType.CENTER_CROP;setBackgroundColor(0xFF16101F.toInt())};posterCard.addView(poster,LinearLayout.LayoutParams(dp(290),dp(430)));ArtworkLoader.loadPriority(poster,listOf(stream.icon,stream.backdrop));body.addView(posterCard,LinearLayout.LayoutParams(dp(304),dp(444)).apply{marginStart=dp(42)})
            val info=LinearLayout(this@MovieDetailsActivity).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER_VERTICAL or Gravity.END;layoutDirection=View.LAYOUT_DIRECTION_RTL;setPadding(dp(14),0,dp(14),0)}
            info.addView(TextView(this@MovieDetailsActivity).apply{text="BLOFY CINEMA";textSize=12f;letterSpacing=.12f;typeface=BlofyTvDesign.HeadingTypeface;setTextColor(BlofyTvDesign.PurpleBright);gravity=Gravity.END})
            info.addView(TextView(this@MovieDetailsActivity).apply{text=stream.name;textSize=42f;typeface=BlofyTvDesign.HeadingTypeface;setTextColor(Color.WHITE);gravity=Gravity.END;maxLines=2;includeFontPadding=false})
            info.addView(TextView(this@MovieDetailsActivity).apply{text=buildList{add("فيلم");stream.year?.takeIf(String::isNotBlank)?.let(::add);stream.duration?.takeIf(String::isNotBlank)?.let(::add);stream.rating?.takeIf(String::isNotBlank)?.let{add("★ $it")};stream.genre?.takeIf(String::isNotBlank)?.substringBefore(',')?.let(::add);stream.extension?.takeIf(String::isNotBlank)?.let{add(it.uppercase())}}.joinToString("   •   ");textSize=14.5f;typeface=BlofyTvDesign.BodyTypeface;setTextColor(0xFFE8D8FA.toInt());gravity=Gravity.END;setPadding(0,dp(9),0,dp(15))})
            info.addView(TextView(this@MovieDetailsActivity).apply{text=stream.plot?.takeIf(String::isNotBlank)?:"استمتع بالمشاهدة على BLOFY PLAYER";textSize=16.5f;typeface=BlofyTvDesign.BodyTypeface;maxLines=5;setTextColor(BlofyTvDesign.TextSecondary);gravity=Gravity.END;setLineSpacing(0f,1.18f);setPadding(0,0,0,dp(20))})
            val resumeMs=watch?.positionMs?:0L;val durationMs=watch?.durationMs?:0L
            if(resumeMs>30000L&&durationMs>0L){val p=((resumeMs*100L)/durationMs).coerceIn(1,99);info.addView(TextView(this@MovieDetailsActivity).apply{text="متابعة المشاهدة   •   $p%";textSize=13.5f;typeface=BlofyTvDesign.HeadingTypeface;setTextColor(BlofyTvDesign.Mint);gravity=Gravity.END;setPadding(0,0,0,dp(10))})}
            val row=LinearLayout(this@MovieDetailsActivity).apply{orientation=LinearLayout.HORIZONTAL;layoutDirection=View.LAYOUT_DIRECTION_RTL;gravity=Gravity.END}
            val play=actionButton(if(resumeMs>30000L)"▶  استئناف" else "▶  شاهد الآن",true){openPlayer(provider,stream,url,resumeMs)};row.addView(play,LinearLayout.LayoutParams(dp(195),dp(64)).apply{marginStart=dp(9)})
            if(resumeMs>30000L)row.addView(actionButton("↺  من البداية"){openPlayer(provider,stream,url,0L)},LinearLayout.LayoutParams(dp(165),dp(64)).apply{marginStart=dp(9)})
            favoriteButton=actionButton(if(stream.favorite)"★  المفضلة" else "☆  المفضلة"){lifecycleScope.launch{val c=dao.stream(contentKey)?:return@launch;dao.setFavorite(contentKey,!c.favorite);favoriteButton.text=if(!c.favorite)"★  المفضلة" else "☆  المفضلة"}};row.addView(favoriteButton,LinearLayout.LayoutParams(dp(165),dp(64)))
            info.addView(row);body.addView(info,LinearLayout.LayoutParams(0,-1,1f));play.requestFocus()
        }
    }
    private fun openPlayer(p:ProviderEntity,s:StreamEntity,url:String,resume:Long){startActivity(Intent(this,PlayerActivity::class.java).apply{putExtra(PlayerActivity.EXTRA_URL,url);putExtra(PlayerActivity.EXTRA_CONTENT_KEY,s.key);putExtra(PlayerActivity.EXTRA_PROVIDER_ID,p.id);putExtra(PlayerActivity.EXTRA_KIND,"movie");putExtra(PlayerActivity.EXTRA_PROVIDER_TYPE,p.providerType);putExtra(PlayerActivity.EXTRA_PREFERRED_TRANSPORT,p.preferredTransport);putExtra(PlayerActivity.EXTRA_PREFERRED_ENGINE,p.preferredEngine);putExtra(PlayerActivity.EXTRA_ALLOW_CROSS_PROTOCOL_REDIRECTS,p.allowCrossProtocolRedirects);putExtra(PlayerActivity.EXTRA_FALLBACK_URL,ContentUrlResolver.directFallback(s));putExtra(PlayerActivity.EXTRA_TITLE,s.name);putExtra(PlayerActivity.EXTRA_RESUME_MS,resume)})}
    private fun actionButton(label:String,primary:Boolean=false,action:()->Unit)=Button(this).apply{text=label;isAllCaps=false;textSize=14.5f;typeface=BlofyTvDesign.HeadingTypeface;isFocusable=true;setTextColor(Color.WHITE);background=buttonBackground(false,primary);setOnFocusChangeListener{v,f->v.background=buttonBackground(f,primary);v.animate().scaleX(if(f)1.04f else 1f).scaleY(if(f)1.04f else 1f).translationZ(if(f)dp(12).toFloat() else dp(2).toFloat()).setDuration(90).start()};setOnClickListener{action()}}
    private fun cardBackground()=GradientDrawable(GradientDrawable.Orientation.TL_BR,intArrayOf(0xD92B203B.toInt(),0xE617111F.toInt())).apply{cornerRadius=dp(24).toFloat();setStroke(dp(1),0x996B4D88.toInt())}
    private fun buttonBackground(f:Boolean,p:Boolean)=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,when{p&&f->intArrayOf(0xFFA653FF.toInt(),0xFF7130D2.toInt());p->intArrayOf(0xFF843FE6.toInt(),0xFF5720AD.toInt());f->intArrayOf(0xFF633A8D.toInt(),0xFF35214C.toInt());else->intArrayOf(0xD92B203B.toInt(),0xE61A1325.toInt())}).apply{cornerRadius=dp(18).toFloat();setStroke(if(f)dp(2) else dp(1),if(f)BlofyTvDesign.PurpleBright else 0x99513C67.toInt())}
    private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt()
    companion object{const val EXTRA_PROVIDER_ID="provider_id";const val EXTRA_CONTENT_KEY="content_key"}
}
