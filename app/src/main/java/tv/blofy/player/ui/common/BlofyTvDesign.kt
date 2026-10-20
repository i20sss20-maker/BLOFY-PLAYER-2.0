package tv.blofy.player.ui.common
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView
object BlofyTvDesign {
 // Cinema Luxe: graphite black, champagne gold and restrained burgundy.
 val Background=Color.rgb(8,8,11);val BackgroundRaised=Color.rgb(16,13,16);val Surface=Color.rgb(26,21,24);val SurfaceRaised=Color.rgb(36,27,31);val SurfaceFocused=Color.rgb(86,43,53);val Purple=Color.rgb(185,145,82);val PurpleBright=Color.rgb(242,210,139);val PurpleDeep=Color.rgb(126,78,52);val PurpleSoft=Color.rgb(255,232,180);val Lavender=Color.rgb(255,232,180);val Mint=Color.rgb(227,192,123);val Error=Color.rgb(232,125,130);val TextPrimary=Color.rgb(255,255,255);val TextSecondary=Color.rgb(236,229,220);val TextMuted=Color.rgb(184,169,158);val Divider=Color.rgb(83,61,61)
 const val HeroTitleSp=40f;const val DetailTitleSp=40f;const val TitleSp=31f;const val HeadingSp=20f;const val BodySp=15f;const val LabelSp=14.5f;const val CaptionSp=12f
 const val ScreenPadding=28;const val PanelPadding=14;const val RailWidth=250;const val CategoryRowHeight=60;const val LiveListWidth=455;const val CardRadius=20;const val PanelRadius=24;const val ButtonRadius=18;const val BadgeRadius=12;const val StandardGap=20;const val FocusInMs=0L;const val FocusOutMs=0L;const val SectionTransitionMs=80L
 val DisplayTypeface:Typeface by lazy{Typeface.create("sans-serif",Typeface.BOLD)};val HeadingTypeface:Typeface by lazy{Typeface.create("sans-serif",Typeface.BOLD)};val LabelTypeface:Typeface by lazy{Typeface.create("sans-serif-medium",Typeface.BOLD)};val BodyTypeface:Typeface by lazy{Typeface.create("sans-serif",Typeface.NORMAL)};val MediumTypeface:Typeface by lazy{Typeface.create("sans-serif-medium",Typeface.NORMAL)}
 fun surface(radius:Float=CardRadius.toFloat(),focused:Boolean=false)=GradientDrawable(GradientDrawable.Orientation.TL_BR,if(focused)intArrayOf(0xFF6D3945.toInt(),0xFF342024.toInt())else intArrayOf(0xF2262022.toInt(),0xF20C0B0C.toInt())).apply{cornerRadius=radius;setStroke(if(focused)2 else 1,if(focused)PurpleBright else 0xFF5E4743.toInt())}
 fun glassSurface(radius:Float=CardRadius.toFloat(),focused:Boolean=false)=GradientDrawable(GradientDrawable.Orientation.TL_BR,if(focused)intArrayOf(0xEE68404A.toInt(),0xF0211518.toInt())else intArrayOf(0xE6211B1D.toInt(),0xF20C0B0D.toInt())).apply{cornerRadius=radius;setStroke(if(focused)2 else 1,if(focused)PurpleBright else 0x665E4545)}
 fun elevatedSurface(radius:Float=PanelRadius.toFloat())=GradientDrawable(GradientDrawable.Orientation.TL_BR,intArrayOf(0xF22D2325.toInt(),0xF10F0D0F.toInt())).apply{cornerRadius=radius;setStroke(1,0xFF5A4440.toInt())}
 fun primaryButton(radius:Float=ButtonRadius.toFloat(),focused:Boolean=false)=GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,if(focused)intArrayOf(0xFFF2D28B.toInt(),0xFFC88D54.toInt())else intArrayOf(0xFFC9A562.toInt(),0xFF8C523F.toInt())).apply{cornerRadius=radius;setStroke(if(focused)2 else 1,if(focused)0xFFFFFFFF.toInt() else 0xFFA47B55.toInt())}
 fun secondaryButton(radius:Float=ButtonRadius.toFloat(),focused:Boolean=false)=glassSurface(radius,focused);fun badge(radius:Float=BadgeRadius.toFloat())=GradientDrawable().apply{cornerRadius=radius;setColor(0xCC2A2020.toInt());setStroke(1,0xFF6C514A.toInt())}
 fun applyTitle(t:TextView)=t.apply{textSize=TitleSp;typeface=DisplayTypeface;setTextColor(TextPrimary);includeFontPadding=false};fun applyHeroTitle(t:TextView)=t.apply{textSize=HeroTitleSp;typeface=DisplayTypeface;setTextColor(TextPrimary);includeFontPadding=false;letterSpacing=-.01f};fun applyHeading(t:TextView)=t.apply{textSize=HeadingSp;typeface=HeadingTypeface;setTextColor(TextPrimary);includeFontPadding=false};fun applyBody(t:TextView)=t.apply{textSize=BodySp;typeface=BodyTypeface;setTextColor(TextSecondary);includeFontPadding=false;setLineSpacing(0f,1.16f)};fun applyLabel(t:TextView)=t.apply{textSize=LabelSp;typeface=LabelTypeface;setTextColor(TextPrimary);includeFontPadding=false};fun applyCaption(t:TextView)=t.apply{textSize=CaptionSp;typeface=MediumTypeface;setTextColor(TextMuted);includeFontPadding=false}
 fun installTvFocus(v:View,radius:Float=CardRadius.toFloat(),scale:Float=1.025f,primary:Boolean=false,onFocused:(()->Unit)?=null){
  installTvFocusInternal(v,radius,scale,primary){ focused -> if(focused) onFocused?.invoke() }
 }
 fun installTvFocusState(v:View,radius:Float=CardRadius.toFloat(),scale:Float=1.025f,primary:Boolean=false,onFocusChanged:(Boolean)->Unit){
  installTvFocusInternal(v,radius,scale,primary,onFocusChanged)
 }
 private fun installTvFocusInternal(v:View,radius:Float,scale:Float,primary:Boolean,onFocusChanged:((Boolean)->Unit)?){
  v.isFocusable=true;v.isFocusableInTouchMode=true
  val normal=if(primary)primaryButton(radius,false)else secondaryButton(radius,false)
  val focused=if(primary)primaryButton(radius,true)else secondaryButton(radius,true)
  v.background=normal;(v as? TextView)?.setTextColor(TextPrimary)
  v.setOnFocusChangeListener{x,f->
   x.animate().cancel();x.background=if(f)focused else normal;(x as? TextView)?.setTextColor(TextPrimary)
   val targetScale=if(f)minOf(scale,1.012f) else 1f
   x.scaleX=targetScale;x.scaleY=targetScale;x.translationZ=if(f)6f else 0f;x.alpha=1f
   onFocusChanged?.invoke(f)
  }
 }
}
