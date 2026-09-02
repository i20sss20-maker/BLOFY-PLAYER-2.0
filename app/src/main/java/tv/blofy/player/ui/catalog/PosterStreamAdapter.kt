package tv.blofy.player.ui.catalog

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
import tv.blofy.player.ui.common.BlofyTvDesign

internal class PosterStreamAdapter(private val onClick:(StreamEntity)->Unit,private val onFocus:(StreamEntity)->Unit={}):RecyclerView.Adapter<PosterStreamAdapter.Holder>(){
 private val items=ArrayList<StreamEntity>(256);init{setHasStableIds(true)}
 fun replace(n:List<StreamEntity>){items.clear();items.addAll(n);notifyDataSetChanged()};fun append(n:List<StreamEntity>){if(n.isEmpty())return;val s=items.size;items.addAll(n);notifyItemRangeInserted(s,n.size)};fun itemAt(p:Int)=items.getOrNull(p);override fun getItemId(p:Int)=items[p].key.hashCode().toLong()
 override fun onCreateViewHolder(parent:ViewGroup,viewType:Int):Holder{val d=parent.resources.displayMetrics.density;fun dp(v:Int)=(v*d).toInt();val root=LinearLayout(parent.context).apply{orientation=LinearLayout.VERTICAL;gravity=Gravity.CENTER_HORIZONTAL;isFocusable=true;isClickable=true;setPadding(dp(5),dp(5),dp(5),dp(8));background=card(false);clipToOutline=true;elevation=dp(2).toFloat()};val frame=FrameLayout(parent.context);val image=ImageView(parent.context).apply{scaleType=ImageView.ScaleType.CENTER_CROP;setBackgroundColor(0xFF100D16.toInt());clipToOutline=true;alpha=.92f};frame.addView(image,FrameLayout.LayoutParams(-1,dp(250)));val rating=TextView(parent.context).apply{textSize=10.5f;typeface=BlofyTvDesign.LabelTypeface;setTextColor(Color.WHITE);gravity=Gravity.CENTER;setPadding(dp(8),dp(3),dp(8),dp(3));visibility=View.GONE;background=BlofyTvDesign.badge(dp(10).toFloat())};frame.addView(rating,FrameLayout.LayoutParams(-2,-2,Gravity.TOP or Gravity.END).apply{topMargin=dp(8);marginEnd=dp(8)});root.addView(frame,LinearLayout.LayoutParams(-1,dp(250)));val title=TextView(parent.context).apply{textSize=13.5f;typeface=BlofyTvDesign.MediumTypeface;setTextColor(BlofyTvDesign.TextSecondary);gravity=Gravity.START;maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END;setPadding(dp(4),dp(8),dp(4),0)};root.addView(title,LinearLayout.LayoutParams(-1,dp(34)));val meta=TextView(parent.context).apply{textSize=11.5f;typeface=BlofyTvDesign.MediumTypeface;setTextColor(BlofyTvDesign.TextMuted);gravity=Gravity.START;maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END;setPadding(dp(4),0,dp(4),0);alpha=0f;visibility=View.INVISIBLE};root.addView(meta,LinearLayout.LayoutParams(-1,dp(24)));return Holder(root,image,title,meta,rating)}
 override fun onBindViewHolder(h:Holder,p:Int){val item=items[p];h.itemView.tag=item.key;h.title.text=item.name;h.meta.text=listOfNotNull(item.year?.takeIf(String::isNotBlank),item.genre?.takeIf(String::isNotBlank)?.substringBefore(',')).joinToString("  •  ");h.rating.text=item.rating?.takeIf(String::isNotBlank)?.let{"★ $it"}.orEmpty();render(h,h.itemView.hasFocus());ArtworkLoader.load(h.image,item.icon?:item.backdrop);if(p%5==0)ArtworkLoader.prefetch(h.itemView.context,(p+1 until minOf(items.size,p+11)).map{items[it].icon?:items[it].backdrop});h.itemView.setOnClickListener{onClick(item)};h.itemView.setOnFocusChangeListener{v,f->render(h,f);v.animate().cancel();v.animate().scaleX(if(f)1.045f else 1f).scaleY(if(f)1.045f else 1f).translationZ(if(f)16f else 2f).setDuration(if(f)BlofyTvDesign.FocusInMs else BlofyTvDesign.FocusOutMs).start();h.image.animate().cancel();h.image.animate().alpha(if(f)1f else .92f).setDuration(if(f)90 else 60).start();if(f)onFocus(item)}}
 private fun render(h:Holder,f:Boolean){h.itemView.background=card(f);h.title.typeface=if(f)BlofyTvDesign.LabelTypeface else BlofyTvDesign.MediumTypeface;h.title.setTextColor(if(f)Color.WHITE else BlofyTvDesign.TextSecondary);h.meta.visibility=if(f)View.VISIBLE else View.INVISIBLE;h.rating.visibility=if(f&&h.rating.text.isNotBlank())View.VISIBLE else View.GONE;h.meta.animate().cancel();h.meta.animate().alpha(if(f)1f else 0f).setDuration(if(f)90 else 55).start()}
 override fun onViewRecycled(h:Holder){ArtworkLoader.cancel(h.image);h.image.setImageDrawable(null);super.onViewRecycled(h)};override fun onViewDetachedFromWindow(h:Holder){ArtworkLoader.cancel(h.image);super.onViewDetachedFromWindow(h)};override fun getItemCount()=items.size
 internal class Holder(item:View,val image:ImageView,val title:TextView,val meta:TextView,val rating:TextView):RecyclerView.ViewHolder(item)
 private fun card(f:Boolean)=GradientDrawable(GradientDrawable.Orientation.TL_BR,if(f)intArrayOf(0xFF4C2B70.toInt(),0xFF1B1325.toInt()) else intArrayOf(0xF21A1522.toInt(),0xF2110E17.toInt())).apply{cornerRadius=18f;setStroke(if(f)2 else 1,if(f)BlofyTvDesign.PurpleBright else 0xFF352B40.toInt())}
}
