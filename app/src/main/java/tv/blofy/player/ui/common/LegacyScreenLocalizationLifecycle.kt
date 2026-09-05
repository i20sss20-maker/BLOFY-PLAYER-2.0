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
import tv.blofy.player.ui.login.LoginActivity

/**
 * Temporary compatibility bridge for large legacy programmatic screens while their
 * remaining inline labels are migrated to resources. English is the product default;
 * Arabic remains available when the app locale is explicitly Arabic.
 */
class LegacyScreenLocalizationLifecycle : Application.ActivityLifecycleCallbacks {
    private val listeners = java.util.WeakHashMap<Activity, ViewTreeObserver.OnGlobalLayoutListener>()

    override fun onActivityResumed(activity: Activity) {
        if (activity !is HomeActivity && activity !is ContentBrowserActivity && activity !is LoginActivity) return
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

        // LoginActivity still contains legacy Arabic literals. Preserve them only when Arabic
        // is the actively selected app locale; otherwise translate them to the English product UI.
        if (activity is LoginActivity && !isArabic(activity)) {
            val login = loginEnglish(raw)
            if (login != null && login != raw) {
                view.text = login
                return
            }
        }

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
            "استكشف الأفلام" -> activity.getString(R.string.home_explore_movies)
            "جاري تجهيز مكتبتك" -> activity.getString(R.string.home_preparing)
            "نرتب المحتوى لك…" -> activity.getString(R.string.home_arranging)
            "مكتبتك جاهزة للعرض" -> activity.getString(R.string.home_library_ready)
            "أضف أو حدّث قائمة التشغيل، وبعدها بتظهر هنا البانرات والصفوف تلقائيًا." -> activity.getString(R.string.home_library_ready_hint)
            "وش بتشاهد اليوم؟" -> activity.getString(R.string.home_today)
            "كل محتواك في مكان واحد" -> activity.getString(R.string.home_all_content)
            "أفلام   •   مسلسلات   •   بث مباشر" -> activity.getString(R.string.home_all_content_meta)
            "بث مباشر، أفلام ومسلسلات بواجهة مصممة للتلفزيون وسريعة بالريموت." -> activity.getString(R.string.home_all_content_subtitle)
            "كل محتواك. أسرع. أبسط." -> activity.getString(R.string.home_compact_subtitle)
            "الرئيسية" -> activity.getString(R.string.home_home)
            "البث المباشر", "بث مباشر" -> activity.getString(R.string.home_live)
            "الأفلام" -> activity.getString(R.string.home_movies)
            "المسلسلات" -> activity.getString(R.string.home_series)
            "المفضلة" -> activity.getString(R.string.home_favorites)
            "البحث", "بحث" -> activity.getString(R.string.home_search)
            "الإعدادات" -> activity.getString(R.string.home_settings)
            "المجموعات", "مختارات" -> activity.getString(R.string.home_collections)
            "آخر القنوات" -> activity.getString(R.string.home_recent_channels)
            "مختارات BLOFY" -> activity.getString(R.string.home_blofy_collections)
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
            "مختارات متجددة وتجربة تلفزيون مصممة عشان توصل للمحتوى بأقل عدد من الضغطات." -> activity.getString(R.string.home_promo_subtitle)
            else -> dynamicReplacement(activity, raw)
        }
        if (replacement != null && replacement != raw) view.text = replacement
    }

    private fun isArabic(activity: Activity): Boolean =
        activity.resources.configuration.locales[0]?.language.equals("ar", ignoreCase = true)

    private fun loginEnglish(raw: String): String? {
        val exact = when (raw) {
            "كل شيء يبدأ من هنا" -> "Everything starts here"
            "فعّل جهازك، اختر قائمتك، وادخل مباشرة إلى BLOFY" -> "Activate your device, choose a playlist, and enter BLOFY instantly"
            "تفعيل جهاز BLOFY" -> "Activate BLOFY device"
            "امسح الرمز بالكاميرا لإدارة هذا الجهاز بسرعة" -> "Scan the QR code to manage this device quickly"
            "امسح QR" -> "Scan QR"
            "أضف قائمتك" -> "Add playlist"
            "ابدأ المشاهدة" -> "Start watching"
            "رقم الجهاز" -> "Device ID"
            "رمز الربط" -> "Pairing code"
            "↻  تحديث حالة التفعيل" -> "↻  Refresh activation status"
            "قوائم التشغيل" -> "Playlists"
            "● جاهز للدخول" -> "● Ready"
            "اختر قائمتك المحفوظة أو أضف قائمة جديدة. العودة لاحقًا تفتح من الكاش مباشرة." -> "Choose a saved playlist or add a new one. Future launches open directly from local cache."
            "ما عندك قوائم إلى الآن • اضغط إضافة / إدارة" -> "No playlists yet • Select Add / Manage"
            "＋  إضافة / إدارة القوائم" -> "＋  Add / Manage playlists"
            "▶  دخول إلى BLOFY" -> "▶  Enter BLOFY"
            "BLOFY SECURE SESSION  •  بياناتك محفوظة محليًا  •  القوائم لا يعاد تحميلها عند كل دخول" -> "BLOFY SECURE SESSION  •  Your data is stored locally  •  Playlists are not reloaded on every launch"
            "فعّل جهازك ثم اختر قائمة التشغيل" -> "Activate your device, then choose a playlist"
            "إضافة / إدارة القوائم" -> "Add / Manage playlists"
            "دخول" -> "Enter"
            "تحديث" -> "Refresh"
            "جاري إنشاء هوية الجهاز..." -> "Creating device identity..."
            "رمز تفعيل BLOFY" -> "BLOFY activation QR code"
            "فتح سريع" -> "Fast launch"
            "من الكاش" -> "From cache"
            "قائمة آمنة" -> "Secure playlist"
            "محفوظة محليًا" -> "Stored locally"
            "جهاز واحد" -> "One device"
            "هوية مستقرة" -> "Stable identity"
            "تم إلغاء الاتصال" -> "Connection cancelled"
            "إلغاء" -> "Cancel"
            "أضف قائمة تشغيل أولاً" -> "Add a playlist first"
            "جاري التحقق من تفعيل الجهاز..." -> "Checking device activation..."
            "الجهاز مفعل • أضف قائمة" -> "Device activated • Add a playlist"
            "تعذر التحقق من التفعيل" -> "Unable to verify activation"
            "تعذر اختيار القائمة • حاول مرة أخرى" -> "Unable to select playlist • Try again"
            "● القائمة النشطة   •   Xtream" -> "● Active playlist   •   Xtream"
            "● القائمة النشطة   •   M3U" -> "● Active playlist   •   M3U"
            "Xtream   •   اضغط OK للدخول" -> "Xtream   •   Press OK to enter"
            "M3U   •   اضغط OK للدخول" -> "M3U   •   Press OK to enter"
            "ابدأ بإضافة أول قائمة" -> "Add your first playlist"
            "● الفترة التجريبية فعالة" -> "● Trial is active"
            "● الجهاز مفعل وجاهز" -> "● Device activated and ready"
            "انتهت صلاحية الجهاز" -> "Device access expired"
            "الجهاز موقوف" -> "Device is blocked"
            "حالة التفعيل غير معروفة" -> "Unknown activation status"
            "في انتظار إضافة قائمة" -> "Waiting for a playlist"
            else -> null
        }
        if (exact != null) return exact
        return when {
            raw.startsWith("جاري تجهيز ") -> "Preparing ${raw.removePrefix("جاري تجهيز ")}"
            raw.startsWith("جاري اختيار ") -> "Selecting ${raw.removePrefix("جاري اختيار ")}"
            raw.startsWith("● جاهز • ") -> "● Ready • ${raw.removePrefix("● جاهز • ")}"
            else -> null
        }
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
