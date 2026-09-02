package tv.blofy.player.ui.series

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.R
import tv.blofy.player.data.local.EpisodeEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

internal class EpisodeCardAdapter(private val seriesArt:String?,private val onClick:(EpisodeEntity)->Unit,private val onFocus:(EpisodeEntity)->Unit):RecyclerView.Adapter<EpisodeCardAdapter.Holder>(){
    private val items=mutableListOf<EpisodeEntity>();private var progress=emptyMap<String,Int>();init{setHasStableIds(true)}
    fun submit(newItems:List<EpisodeEntity>){val old=items.toList();val diff=DiffUtil.calculateDiff(object:DiffUtil.Callback(){override fun getOldListSize()=old.size;override fun getNewListSize()=newItems.size;override fun areItemsTheSame(o:Int,n:Int)=old[o].key==newItems[n].key;override fun areContentsTheSame(o:Int,n:Int)=old[o]==newItems[n]},false);items.clear();items.addAll(newItems);diff.dispatchUpdatesTo(this)}
    fun setProgress(values:Map<String,Int>){progress=values.toMap();if(itemCount>0)notifyItemRangeChanged(0,itemCount,"progress")}
    override fun getItemId(position:Int)=items[position].key.hashCode().toLong()
    override fun onCreateViewHolder(parent:ViewGroup,viewType:Int):Holder{val d=parent.resources.displayMetrics.density;fun dp(v:Int)=(v*d).toInt();val row=LinearLayout(parent.context).apply{orientation=LinearLayout.HORIZONTAL;layoutDirection=View.LAYOUT_DIRECTION_RTL;gravity=Gravity.CENTER_VERTICAL;setPadding(dp(10),dp(8),dp(14),dp(8));isFocusable=true;isClickable=true;background=card(false)}
        val frame=FrameLayout(parent.context);val image=ImageView(parent.context).apply{scaleType=ImageView.ScaleType.CENTER_CROP;setBackgroundColor(0xFF16101F.toInt())};frame.addView(image,FrameLayout.LayoutParams(dp(176),dp(98)));frame.addView(View(parent.context).apply{background=GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,intArrayOf(0x0017111F,0xB30D0915.toInt()))},FrameLayout.LayoutParams(dp(176),dp(98)))
        val number=TextView(parent.context).apply{textSize=11.5f;typeface=Typeface.DEFAULT_BOLD;setTextColor(Color.WHITE);gravity=Gravity.CENTER;background=GradientDrawable().apply{cornerRadius=dp(10).toFloat();setColor(0xE27137BA.toInt());setStroke(dp(1),BlofyTvDesign.PurpleBright)}};frame.addView(number,FrameLayout.LayoutParams(dp(48),dp(28),Gravity.BOTTOM or Gravity.END).apply{marginEnd=dp(7);bottomMargin=dp(7)});row.addView(frame,LinearLayout.LayoutParams(dp(176),dp(98)).apply{marginStart=dp(16)})
        val textBox=LinearLayout(parent.context).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER_VERTICAL or Gravity.RIGHT};val title=TextView(parent.context).apply{textSize=15.5f;typeface=Typeface.DEFAULT_BOLD;setTextColor(BlofyTvDesign.TextPrimary);maxLines=1;gravity=Gravity.RIGHT};val meta=TextView(parent.context).apply{textSize=11.5f;typeface=BlofyTvDesign.BodyTypeface;setTextColor(BlofyTvDesign.TextMuted);maxLines=1;gravity=Gravity.RIGHT};val bar=ProgressBar(parent.context,null,android.R.attr.progressBarStyleHorizontal).apply{max=100;progress=0;progressTintList=android.content.res.ColorStateList.valueOf(BlofyTvDesign.PurpleBright);progressBackgroundTintList=android.content.res.ColorStateList.valueOf(0x553D2D4F)};textBox.addView(title,LinearLayout.LayoutParams(-1,0,1f));textBox.addView(meta,LinearLayout.LayoutParams(-1,dp(22)));textBox.addView(bar,LinearLayout.LayoutParams(-1,dp(5)).apply{topMargin=dp(5)});row.addView(textBox,LinearLayout.LayoutParams(0,dp(92),1f))
        val state=TextView(parent.context).apply{textSize=11.5f;typeface=Typeface.DEFAULT_BOLD;setTextColor(BlofyTvDesign.Mint);gravity=Gravity.CENTER};row.addView(state,LinearLayout.LayoutParams(dp(112),dp(58)));return Holder(row,image,number,title,meta,state,bar)}
    override fun onBindViewHolder(h:Holder,p:Int){val e=items[p];h.number.text="E${e.episode}";h.title.text=e.title.ifBlank{"الحلقة ${e.episode}"};val duration=e.durationSecs?.takeIf{it>0}?.let{"${it/60} دقيقة"};h.meta.text=listOfNotNull("الموسم ${e.season}",duration).joinToString("   •   ");val pct=progress[e.key]?:0;h.bar.progress=pct.coerceIn(0,100);h.bar.visibility=if(pct in 1..99)View.VISIBLE else View.INVISIBLE;h.state.text=when{pct>=100->"✓ تمت";pct>0->"استئناف $pct%";else->"تشغيل  ▶"};if(!seriesArt.isNullOrBlank())ArtworkLoader.load(h.image,seriesArt)else h.image.setImageResource(R.drawable.blofy_logo);h.itemView.setOnClickListener{onClick(e)};h.itemView.setOnFocusChangeListener{v,f->v.background=card(f);h.title.setTextColor(Color.WHITE);h.meta.setTextColor(if(f)0xFFE8D8FA.toInt() else BlofyTvDesign.TextMuted);v.animate().cancel();v.animate().scaleX(if(f)1.022f else 1f).scaleY(if(f)1.022f else 1f).translationZ(if(f)14f else 1f).setDuration(85).start();if(f)onFocus(e)}}
    override fun onViewRecycled(h:Holder){ArtworkLoader.cancel(h.image);super.onViewRecycled(h)};override fun getItemCount()=items.size
    internal class Holder(item:View,val image:ImageView,val number:TextView,val title:TextView,val meta:TextView,val state:TextView,val bar:ProgressBar):RecyclerView.ViewHolder(item)
    private fun card(f:Boolean)=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,if(f)intArrayOf(0xFF63379E.toInt(),0xFF2E1B43.toInt()) else intArrayOf(0xE6251A35.toInt(),0xEA17111F.toInt())).apply{cornerRadius=22f;setStroke(if(f)2 else 1,if(f)BlofyTvDesign.PurpleBright else 0xFF49375E.toInt())}
}
