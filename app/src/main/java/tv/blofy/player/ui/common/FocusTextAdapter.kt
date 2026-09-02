package tv.blofy.player.ui.common

import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.AsyncListDiffer
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView

class FocusTextAdapter<T : Any>(private val label:(T)->String,private val onClick:(T)->Unit,private val onFocus:((T)->Unit)?=null,private val onLongClick:((T)->Unit)?=null,private val itemKey:((T)->String)?=null):RecyclerView.Adapter<FocusTextAdapter<T>.Holder>(){
 private val differ=AsyncListDiffer(this,object:DiffUtil.ItemCallback<T>(){
  override fun areItemsTheSame(o:T,n:T)=itemKey?.let{it(o)==it(n)}?: (o===n)
  override fun areContentsTheSame(o:T,n:T)=o===n
 });private val items get()=differ.currentList;private var focusedKey:String?=null;private var focusedPosition=RecyclerView.NO_POSITION;private var restorePending=false;private var attached:RecyclerView?=null
 init{setHasStableIds(itemKey!=null)}
 fun submit(n:List<T>){val owned=attached?.hasFocus()==true;val pk=focusedKey;val pp=focusedPosition;differ.submitList(n.toList()){focusedPosition=when{pk!=null&&itemKey!=null->items.indexOfFirst{itemKey.invoke(it)==pk};pp!=RecyclerView.NO_POSITION&&items.isNotEmpty()->pp.coerceIn(0,items.lastIndex);else->RecyclerView.NO_POSITION};if(focusedPosition<0)focusedPosition=RecyclerView.NO_POSITION;restorePending=owned&&focusedPosition!=RecyclerView.NO_POSITION;if(restorePending)attached?.post{attached?.findViewHolderForAdapterPosition(focusedPosition)?.itemView?.requestFocus()}}}
 fun clearFocusMemory(){focusedKey=null;focusedPosition=RecyclerView.NO_POSITION;restorePending=false};override fun getItemId(p:Int)=itemKey?.invoke(items[p])?.hashCode()?.toLong()?:super.getItemId(p);override fun onAttachedToRecyclerView(r:RecyclerView){super.onAttachedToRecyclerView(r);attached=r};override fun onDetachedFromRecyclerView(r:RecyclerView){if(attached===r)attached=null;restorePending=false;super.onDetachedFromRecyclerView(r)}
 override fun onCreateViewHolder(parent:ViewGroup,viewType:Int):Holder{val c=parent.context;val view=TextView(c).apply{textSize=TvUiTuning.sp(c,15.5f);typeface=BlofyTvDesign.MediumTypeface;setTextColor(BlofyTvDesign.TextSecondary);gravity=Gravity.CENTER_VERTICAL or Gravity.RIGHT;layoutDirection=View.LAYOUT_DIRECTION_RTL;setPadding(TvUiTuning.dp(c,18),0,TvUiTuning.dp(c,18),0);minimumHeight=TvUiTuning.dp(c,BlofyTvDesign.CategoryRowHeight);maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END;isFocusable=true;isFocusableInTouchMode=true;isClickable=true;isLongClickable=true;background=itemBackground(false);setOnFocusChangeListener{v,f->val t=v as TextView;v.animate().cancel();t.typeface=if(f)BlofyTvDesign.LabelTypeface else BlofyTvDesign.MediumTypeface;t.setTextColor(if(f)Color.WHITE else BlofyTvDesign.TextSecondary);v.background=itemBackground(f);v.animate().scaleX(if(f)1.026f else 1f).scaleY(if(f)1.026f else 1f).translationX(if(f)TvUiTuning.dp(c,5).toFloat() else 0f).translationZ(if(f)14f else 2f).setDuration(if(f)BlofyTvDesign.FocusInMs else BlofyTvDesign.FocusOutMs).start();if(f){val p=(v.tag as? Int)?:RecyclerView.NO_POSITION;items.getOrNull(p)?.let{focusedPosition=p;focusedKey=itemKey?.invoke(it);onFocus?.invoke(it)}}}};return Holder(view)}
 override fun onBindViewHolder(h:Holder,p:Int){val item=items[p];h.text.text=label(item);h.text.tag=p;if(!h.text.hasFocus()){h.text.typeface=BlofyTvDesign.MediumTypeface;h.text.setTextColor(BlofyTvDesign.TextSecondary)};h.text.background=itemBackground(h.text.hasFocus());h.text.setOnClickListener{onClick(item)};h.text.setOnLongClickListener{onLongClick?.invoke(item);onLongClick!=null};if(restorePending&&p==focusedPosition)h.text.post{if(h.bindingAdapterPosition==focusedPosition&&h.text.visibility==View.VISIBLE){h.text.requestFocus();restorePending=false}}}
 override fun getItemCount()=items.size;inner class Holder(val text:TextView):RecyclerView.ViewHolder(text)
 private fun itemBackground(f:Boolean)=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,if(f)intArrayOf(0xFF533078.toInt(),0xFF251831.toInt())else intArrayOf(0xE61B1622.toInt(),0xEE121019.toInt())).apply{cornerRadius=BlofyTvDesign.CardRadius.toFloat();setStroke(if(f)2 else 1,if(f)BlofyTvDesign.PurpleBright else 0xFF342A3F.toInt())}
}
