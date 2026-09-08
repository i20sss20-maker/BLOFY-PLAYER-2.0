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
import tv.blofy.player.core.profile.KidsContentGuard
import tv.blofy.player.core.remote.QuickMenuInterceptor
import tv.blofy.player.core.update.AppUpdateLifecycle
import tv.blofy.player.data.ContentRepository
import tv.blofy.player.data.ResumeStateWriter
import tv.blofy.player.data.local.BlofyDatabase
import tv.blofy.player.ui.catalog.CatalogPageMemory
import tv.blofy.player.ui.catalog.ArtworkLoader
import tv.blofy.player.ui.common.LegacyScreenLocalizationLifecycle
import tv.blofy.player.ui.common.RootExitConfirmationLifecycle
import tv.blofy.player.ui.login.LoginLocalFastPathLifecycle
import tv.blofy.player.ui.login.LoginPortalRefreshLifecycle
import tv.blofy.player.ui.profile.ProfileCloudLifecycle
import tv.blofy.player.ui.profile.ProfileHomeLayoutLifecycle
import tv.blofy.player.ui.profile.ProfileSwitcherLifecycle
import tv.blofy.player.ui.profile.ProfileUxLifecycle
import tv.blofy.player.ui.search.CatalogSearchLifecycle
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

        val settings = getSharedPreferences("blofy_player_settings", MODE_PRIVATE)
        if (AppCompatDelegate.getApplicationLocales().isEmpty) {
            AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags("en"))
            if (!settings.contains("app_language_tag")) {
                settings.edit().putString("app_language_tag", "en").putString("app_language", "English").apply()
            }
        }

        CrashRecovery.install(this)
        registerActivityLifecycleCallbacks(QuickMenuInterceptor())
        registerActivityLifecycleCallbacks(AppUpdateLifecycle())
        registerActivityLifecycleCallbacks(RootExitConfirmationLifecycle())
        registerActivityLifecycleCallbacks(LoginLocalFastPathLifecycle())
        registerActivityLifecycleCallbacks(LoginPortalRefreshLifecycle())
        registerActivityLifecycleCallbacks(ProfileSwitcherLifecycle())
        registerActivityLifecycleCallbacks(KidsContentGuard())
        registerActivityLifecycleCallbacks(ProfileUxLifecycle())
        registerActivityLifecycleCallbacks(ProfileHomeLayoutLifecycle())
        registerActivityLifecycleCallbacks(CatalogSearchLifecycle())
        registerActivityLifecycleCallbacks(ProfileCloudLifecycle())
        registerActivityLifecycleCallbacks(SubscriptionEntryLifecycle())
        registerActivityLifecycleCallbacks(RuntimeSettingsLifecycle())
        registerActivityLifecycleCallbacks(LegacyScreenLocalizationLifecycle())

        // Stability rule: Activity resume must never start full-catalog preparation, FTS rebuilds,
        // provider-secret migration or recursive cache scans. Those jobs compete with Room reads,
        // RecyclerView binding and DPAD on low-powered TV boxes. Catalog refresh/preparation stays
        // explicit (first import / user refresh / worker), while Home remains read-only and instant.
        applicationScope.launch {
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
