package tv.blofy.player

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import tv.blofy.player.core.commercial.CommercialConfigRepository
import tv.blofy.player.core.commercial.CrashRecovery
import tv.blofy.player.core.identity.ActivationStartupRegistration
import tv.blofy.player.core.profile.KidsContentGuard
import tv.blofy.player.core.remote.QuickMenuInterceptor
import tv.blofy.player.core.update.AppUpdateLifecycle
import tv.blofy.player.data.CatalogPlaybackLifecycle
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.ResumeStateWriter
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.data.remote.XtreamClient
import tv.blofy.player.ui.catalog.CatalogPageMemory
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.LegacyScreenLocalizationLifecycle
import tv.blofy.player.ui.common.RootExitConfirmationLifecycle
import tv.blofy.player.ui.login.StartupEntryLifecycle
import tv.blofy.player.ui.player.LiveChannelOverlayLifecycle
import tv.blofy.player.ui.player.PlayerReturnNavigationLifecycle
import tv.blofy.player.ui.profile.ProfileCloudLifecycle
import tv.blofy.player.ui.profile.ProfileHomeLayoutLifecycle
import tv.blofy.player.ui.profile.ProfileSwitcherLifecycle
import tv.blofy.player.ui.profile.ProfileUxLifecycle
import tv.blofy.player.ui.search.CatalogSearchLifecycle
import tv.blofy.player.ui.search.ScopedSearchRedirectLifecycle
import tv.blofy.player.ui.settings.RuntimeSettingsLifecycle
import tv.blofy.player.ui.subscription.SubscriptionEntryLifecycle

class BlofyApp : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val resumeStateWriter: ResumeStateWriter by lazy {
        val repository = ContentRepository(BlofyDatabase.get(this).dao())
        ResumeStateWriter(applicationScope) { request ->
            repository.saveResume(
                contentKey = request.contentKey,
                providerId = request.providerId,
                kind = request.kind,
                positionMs = request.positionMs,
                durationMs = request.durationMs
            )
        }
    }

    override fun onCreate() {
        super.onCreate()
        current = this
        XtreamClient.initialize(this)

        // SettingsActivity stores the user's explicit language choice here. Reconcile AppCompat's
        // process locale from that durable value on every cold start instead of treating an empty
        // locale list as English and accidentally resetting a previously selected language.
        val settings = getSharedPreferences("blofy_player_settings", MODE_PRIVATE)
        val storedTag = settings.getString("app_language_tag", null)?.trim().orEmpty()
        val streamChoiceMade = settings.getBoolean("stream_language_choice_made", false)
        // A previous STREAM package could remember the old English auto-default
        // even though it did not expose a language picker. Upgrade that implicit
        // value to Arabic exactly once; never override an explicit choice made in
        // the new STREAM language picker. PLAYER maintains its existing behavior.
        val resolvedTag = when {
            BuildConfig.CODE_ONLY_LOGIN && !streamChoiceMade -> "ar"
            storedTag.isNotBlank() -> storedTag
            BuildConfig.CODE_ONLY_LOGIN -> "ar"
            else -> "en"
        }
        val currentTags = AppCompatDelegate.getApplicationLocales().toLanguageTags()
        if (currentTags != resolvedTag) {
            AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(resolvedTag))
        }
        if (storedTag != resolvedTag) {
            settings.edit()
                .putString("app_language_tag", resolvedTag)
                .putString("app_language", if (resolvedTag == "ar") "العربية" else "English")
                .commit()
        }

        CrashRecovery.install(this)
        registerActivityLifecycleCallbacks(QuickMenuInterceptor())
        if (!BuildConfig.IS_GOOGLE_PLAY) registerActivityLifecycleCallbacks(AppUpdateLifecycle())
        if (!BuildConfig.CODE_ONLY_LOGIN) {
            // Legacy pairing and existing BLOFY PLAYER auto-update must never
            // interrupt the code-only STREAM product or redirect to QR login.
            registerActivityLifecycleCallbacks(tv.blofy.player.core.identity.ActivationLeaseLifecycle())
            registerActivityLifecycleCallbacks(StartupEntryLifecycle())
        }
        registerActivityLifecycleCallbacks(CatalogPlaybackLifecycle())
        // Record the source screen before the Live overlay wraps the Player window. Playback keeps
        // its existing BACK/HUD handling; this callback only restores the recorded source on finish.
        registerActivityLifecycleCallbacks(PlayerReturnNavigationLifecycle())
        registerActivityLifecycleCallbacks(LiveChannelOverlayLifecycle())
        registerActivityLifecycleCallbacks(RootExitConfirmationLifecycle())
        registerActivityLifecycleCallbacks(ProfileSwitcherLifecycle())
        registerActivityLifecycleCallbacks(KidsContentGuard())
        registerActivityLifecycleCallbacks(ProfileUxLifecycle())
        registerActivityLifecycleCallbacks(ProfileHomeLayoutLifecycle())
        registerActivityLifecycleCallbacks(ScopedSearchRedirectLifecycle())
        registerActivityLifecycleCallbacks(CatalogSearchLifecycle())
        registerActivityLifecycleCallbacks(ProfileCloudLifecycle())
        if (!BuildConfig.CODE_ONLY_LOGIN) registerActivityLifecycleCallbacks(SubscriptionEntryLifecycle())
        registerActivityLifecycleCallbacks(RuntimeSettingsLifecycle())
        registerActivityLifecycleCallbacks(LegacyScreenLocalizationLifecycle())

        // Startup network work stays asynchronous. A fresh identity is registered immediately so
        // the Device ID / pairing code shown on Login is already known by the server. Existing
        // entitlement states do not re-register here.
        if (!BuildConfig.CODE_ONLY_LOGIN) applicationScope.launch {
            ActivationStartupRegistration.registerIfNeeded(this@BlofyApp)
        }

        // Stability rule: Application-level callbacks must never own Login controls or start
        // catalog/database maintenance on Activity resume. Login remains self-contained, while
        // catalog refresh/preparation stays explicit (first import / user refresh / worker).
        if (!BuildConfig.CODE_ONLY_LOGIN) applicationScope.launch {
            runCatching { CommercialConfigRepository.refresh(this@BlofyApp) }
        }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        ArtworkLoader.trimMemory(level)
        when {
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> CatalogPageMemory.clear()
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> CatalogPageMemory.trimForMemoryPressure()
            level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN -> CatalogPageMemory.trimForMemoryPressure()
        }
    }

    override fun onLowMemory() {
        CatalogPageMemory.clear()
        ArtworkLoader.clearMemory()
        super.onLowMemory()
    }

    companion object {
        @Volatile private var current: BlofyApp? = null
        fun contextOrNull(): Context? = current?.applicationContext
    }
}
