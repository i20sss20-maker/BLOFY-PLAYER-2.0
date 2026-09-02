package tv.blofy.player.ui.browser

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import tv.blofy.player.R
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.BlofyTvDesign

internal class LiveChannelAdapter(private val onClick:(StreamEntity)->Unit,private val onFocus:(StreamEntity)->Unit,private val onLongClick:(StreamEntity)->Unit,private val itemKey:(StreamEntity)->String):RecyclerView.Adapter<LiveChannelAdapter.Holder>(){
    private val items=ArrayList<StreamEntity>(256);private var focusedKey:String?=null;init{setHasStableIds(true)}
    fun submit(newItems:List<StreamEntity>)=replace(newItems);fun replace(newItems:List<StreamEntity>){items.clear();items.addAll(newItems);notifyDataSetChanged()};fun append(newItems:List<StreamEntity>){if(newItems.isEmpty())return;val start=items.size;items.addAll(newItems);notifyItemRangeInserted(start,newItems.size)}
    fun indexOfKey(key:String?):Int=if(key.isNullOrBlank())-1 else items.indexOfFirst{itemKey(it)==key};fun itemAt(position:Int):StreamEntity?=items.getOrNull(position);override fun getItemId(position:Int)=itemKey(items[position]).hashCode().toLong()
    override fun onCreateViewHolder(parent:ViewGroup,viewType:Int):Holder{val d=parent.resources.displayMetrics.density;fun dp(v:Int)=(v*d).toInt();val row=LinearLayout(parent.context).apply{orientation=LinearLayout.HORIZONTAL;layoutDirection=View.LAYOUT_DIRECTION_RTL;gravity=Gravity.CENTER_VERTICAL;setPadding(dp(12),dp(8),dp(14),dp(8));isFocusable=true;isClickable=true;isLongClickable=true;background=rowBackground(false)}
        val logo=ImageView(parent.context).apply{scaleType=ImageView.ScaleType.CENTER_INSIDE;setPadding(dp(6),dp(6),dp(6),dp(6));background=GradientDrawable().apply{cornerRadius=dp(14).toFloat();setColor(0xFF120D1A.toInt());setStroke(dp(1),0xFF4A365F.toInt())}};row.addView(logo,LinearLayout.LayoutParams(dp(62),dp(62)).apply{marginStart=dp(14)})
        val textBox=LinearLayout(parent.context).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER_VERTICAL or Gravity.RIGHT};val title=TextView(parent.context).apply{textSize=15.5f;typeface=Typeface.DEFAULT_BOLD;setTextColor(BlofyTvDesign.TextPrimary);maxLines=1;gravity=Gravity.RIGHT};val meta=TextView(parent.context).apply{textSize=11.5f;typeface=BlofyTvDesign.BodyTypeface;setTextColor(BlofyTvDesign.TextMuted);maxLines=1;gravity=Gravity.RIGHT};textBox.addView(title,LinearLayout.LayoutParams(-1,0,1f));textBox.addView(meta,LinearLayout.LayoutParams(-1,dp(23)));row.addView(textBox,LinearLayout.LayoutParams(0,dp(62),1f))
        val badge=TextView(parent.context).apply{textSize=10f;typeface=Typeface.DEFAULT_BOLD;setTextColor(BlofyTvDesign.PurpleSoft);gravity=Gravity.CENTER;background=GradientDrawable().apply{cornerRadius=dp(11).toFloat();setColor(0x66382252);setStroke(dp(1),0x995F3D82.toInt())}};row.addView(badge,LinearLayout.LayoutParams(dp(60),dp(34)));return Holder(row,logo,title,meta,badge)}
    override fun onBindViewHolder(h:Holder,p:Int){val item=items[p];h.title.text=(if(item.locked)"🔒  " else "")+item.name;h.meta.text=if(item.archiveEnabled)"مباشر  •  أرشيف متاح" else "مباشر الآن";h.badge.text=if(item.archiveEnabled)"CATCHUP" else "LIVE";val art=item.icon?:item.backdrop;if(!art.isNullOrBlank())ArtworkLoader.load(h.logo,art)else{ArtworkLoader.cancel(h.logo);h.logo.setImageResource(R.drawable.blofy_logo)};h.itemView.setOnClickListener{onClick(item)};h.itemView.setOnLongClickListener{onLongClick(item);true};h.itemView.setOnFocusChangeListener{v,f->if(f)focusedKey=itemKey(item);v.background=rowBackground(f);h.title.setTextColor(Color.WHITE);h.meta.setTextColor(if(f)0xFFE8D8FA.toInt() else BlofyTvDesign.TextMuted);h.badge.setTextColor(if(f)Color.WHITE else BlofyTvDesign.PurpleSoft);v.animate().cancel();v.animate().scaleX(if(f)1.022f else 1f).scaleY(if(f)1.022f else 1f).translationZ(if(f)14f else 1f).setDuration(85).start();if(f)onFocus(item)}}
    override fun onViewRecycled(h:Holder){ArtworkLoader.cancel(h.logo);h.logo.setImageDrawable(null);super.onViewRecycled(h)};override fun getItemCount()=items.size
    internal class Holder(item:View,val logo:ImageView,val title:TextView,val meta:TextView,val badge:TextView):RecyclerView.ViewHolder(item)
    private fun rowBackground(f:Boolean)=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,if(f)intArrayOf(0xFF7542C7.toInt(),0xFF42275F.toInt()) else intArrayOf(0xE6251A35.toInt(),0xEB18111F.toInt())).apply{cornerRadius=20f;setStroke(if(f)2 else 1,if(f)BlofyTvDesign.PurpleBright else 0xFF433253.toInt())}
}
