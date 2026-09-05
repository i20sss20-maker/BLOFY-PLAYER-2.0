package tv.blofy.player.ui.common

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.TextView
import tv.blofy.player.R
import tv.blofy.player.ui.browser.ContentBrowserActivity
import tv.blofy.player.ui.home.HomeActivity

/**
 * Temporary compatibility bridge for the two large legacy programmatic screens while their
 * remaining inline labels are migrated to resources. It keeps English as the product default and
 * Arabic as a real resource override without touching playback, catalog or focus behavior.
 */
class LegacyScreenLocalizationLifecycle : Application.ActivityLifecycleCallbacks {
    private val listeners = java.util.WeakHashMap<Activity, ViewTreeObserver.OnGlobalLayoutListener>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity && activity !is ContentBrowserActivity) return
        val root = activity.window.decorView ?: return
        localizeTree(activity, root)
        if (listeners.containsKey(activity)) return
        val listener = ViewTreeObserver.OnGlobalLayoutListener { localizeTree(activity, root) }
        listeners[activity] = listener
        root.viewTreeObserver.addOnGlobalLayoutListener(listener)
    }

    override fun onActivityPaused(activity: Activity) {
        val listener = listeners.remove(activity) ?: return
        val root = activity.window.decorView
        if (root.viewTreeObserver.isAlive) root.viewTreeObserver.removeOnGlobalLayoutListener(listener)
    }

    private fun localizeTree(activity: Activity, view: View) {
        if (view is TextView) localizeText(activity, view)
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) localizeTree(activity, view.getChildAt(i))
        }
    }

    private fun localizeText(activity: Activity, view: TextView) {
        val raw = view.text?.toString().orEmpty()
        if (raw.isBlank()) return
        val replacement = when (raw) {
            // Browser
            "إعادة المحاولة" -> activity.getString(R.string.browser_retry)
            "اختر قناة" -> activity.getString(R.string.browser_choose_channel)
            "● مباشر  •  المعاينة تبدأ تلقائيًا" -> activity.getString(R.string.browser_live_preview_auto)
            "OK ملء الشاشة   •   ↑↓ القنوات   •   ← رجوع للفئات   •   ضغط مطوّل للأرشيف" -> activity.getString(R.string.browser_remote_hint)
            "كل الأفلام" -> activity.getString(R.string.all_movies)
            "كل المسلسلات" -> activity.getString(R.string.all_series)

            // Home hero / skeleton / primary labels
            "جديد في BLOFY SERIES" -> activity.getString(R.string.home_new_series)
            "جديد في BLOFY CINEMA" -> activity.getString(R.string.home_new_movie)
            "مسلسل" -> activity.getString(R.string.home_series_type)
            "فيلم" -> activity.getString(R.string.home_movie_type)
            "مسلسل مضاف حديثًا إلى مكتبتك — اكتشف المواسم والحلقات." -> activity.getString(R.string.home_series_fallback)
            "فيلم مضاف حديثًا إلى مكتبتك — جاهز للمشاهدة الآن." -> activity.getString(R.string.home_movie_fallback)
            "عرض المسلسل" -> activity.getString(R.string.home_view_series)
            "شاهد الآن" -> activity.getString(R.string.home_watch_now)
            "جاري تجهيز مكتبتك" -> activity.getString(R.string.home_preparing)
            "نرتب المحتوى لك…" -> activity.getString(R.string.home_arranging)
            "مكتبتك جاهزة للعرض" -> activity.getString(R.string.home_library_ready)
            "أضف أو حدّث قائمة التشغيل، وبعدها بتظهر هنا البانرات والصفوف تلقائيًا." -> activity.getString(R.string.home_library_ready_hint)
            "الرئيسية" -> activity.getString(R.string.home_home)
            "البث المباشر" -> activity.getString(R.string.home_live)
            "الأفلام" -> activity.getString(R.string.home_movies)
            "المسلسلات" -> activity.getString(R.string.home_series)
            "المفضلة" -> activity.getString(R.string.home_favorites)
            "البحث" -> activity.getString(R.string.home_search)
            "الإعدادات" -> activity.getString(R.string.home_settings)
            "المجموعات" -> activity.getString(R.string.home_collections)
            "تابع المشاهدة", "متابعة المشاهدة" -> activity.getString(R.string.home_continue)
            "أكمل من آخر نقطة" -> activity.getString(R.string.home_continue_hint)
            "شاهدت مؤخرًا", "شوهد مؤخرًا" -> activity.getString(R.string.home_recent)
            "ارجع بسرعة لآخر ما فتحته" -> activity.getString(R.string.home_recent_hint)
            "أضيف حديثًا", "أضيف مؤخرًا" -> activity.getString(R.string.home_latest)
            "آخر الأفلام والمسلسلات في مكتبتك" -> activity.getString(R.string.home_latest_hint)
            "الأعلى تقييمًا" -> activity.getString(R.string.home_top_rated)
            "مختارات قوية حسب تقييم السيرفر" -> activity.getString(R.string.home_top_rated_hint)
            "مختارات عربية", "اختيارات عربية" -> activity.getString(R.string.home_arabic_picks)
            "محتوى عربي في واجهة واحدة" -> activity.getString(R.string.home_arabic_picks_hint)
            "ما لقينا محتوى عربي مصنف في هذه القائمة حاليًا." -> activity.getString(R.string.home_arabic_empty)
            "للمحتوى عالي الجودة" -> activity.getString(R.string.home_4k_hint)
            "ما فيه عناصر 4K/HDR واضحة في أسماء المحتوى حاليًا." -> activity.getString(R.string.home_4k_empty)
            "اختصارات سريعة" -> activity.getString(R.string.home_quick_shortcuts)
            "وصل لأقسامك بضغطة واحدة" -> activity.getString(R.string.home_quick_shortcuts_hint)
            "قنواتك الآن" -> activity.getString(R.string.home_live_now)
            "سينما" -> activity.getString(R.string.home_cinema)
            "مواسم وحلقات" -> activity.getString(R.string.home_seasons_episodes)
            "اختياراتك" -> activity.getString(R.string.home_your_picks)
            "ابحث فورًا" -> activity.getString(R.string.home_search_now)
            "الأكثر تميزًا في مكتبتك الآن" -> activity.getString(R.string.home_top10_hint)
            "مميز لك" -> activity.getString(R.string.home_featured)
            "اختيار بارز من مكتبتك" -> activity.getString(R.string.home_featured_hint)
            else -> dynamicReplacement(activity, raw)
        }
        if (replacement != null && replacement != raw) view.text = replacement
    }

    private fun dynamicReplacement(activity: Activity, raw: String): String? {
        if (raw.startsWith("BLOFY  •  ")) {
            val suffix = raw.removePrefix("BLOFY  •  ")
            val localized = when (suffix) {
                "الأفلام" -> activity.getString(R.string.movies)
                "المسلسلات" -> activity.getString(R.string.series)
                "البث المباشر" -> activity.getString(R.string.live_tv)
                else -> null
            }
            if (localized != null) return "BLOFY  •  $localized"
        }
        if (raw.startsWith("جاري التحقق من ")) {
            val label = if (raw.contains("أفلام")) activity.getString(R.string.movies) else activity.getString(R.string.series)
            return activity.getString(R.string.browser_checking_catalog, label)
        }
        if (raw.startsWith("لا يوجد محتوى في هذا القسم")) {
            val all = if (raw.contains("الأفلام")) activity.getString(R.string.all_movies) else activity.getString(R.string.all_series)
            return activity.getString(R.string.browser_empty_category, all)
        }
        if (raw.startsWith("لا توجد ") && raw.contains("محفوظة")) {
            val label = if (raw.contains("أفلام")) activity.getString(R.string.movies) else activity.getString(R.string.series)
            return activity.getString(R.string.browser_no_saved_catalog, label)
        }
        Regex("^الحلقة\\s+(\\d+)$").matchEntire(raw)?.let { match ->
            return activity.getString(R.string.home_episode_hint, match.groupValues[1])
        }
        return null
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) { onActivityPaused(activity) }
}
