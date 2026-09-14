package tv.blofy.player.core.privacy

import android.content.Context

object PrivacyPreferences {
    fun diagnosticsEnabled(context: Context): Boolean = context.applicationContext
        .getSharedPreferences("blofy_privacy", Context.MODE_PRIVATE).getBoolean("diagnostics_opt_in", false)

    fun setDiagnostics(context: Context, enabled: Boolean) {
        context.applicationContext.getSharedPreferences("blofy_privacy", Context.MODE_PRIVATE)
            .edit().putBoolean("diagnostics_opt_in", enabled).apply()
    }
}
