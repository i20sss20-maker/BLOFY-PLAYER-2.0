package tv.blofy.player.core.identity

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A separate onboarding coordinator for the external provider mode.
 * Only persist a profile after its provider independently confirms access.
 * Legacy code sessions and active catalog are deliberately untouched here.
 */
object ExternalStreamConnectOnboarding {
    suspend fun pair(context: Context, rawCode: String): ExternalStreamConnectVerifier.Result {
        val credentials = ExternalStreamConnectClient.redeem(rawCode)
        val result = ExternalStreamConnectVerifier.verify(credentials)
        if (result.status == ExternalStreamConnectVerifier.Status.ACTIVE) {
            withContext(Dispatchers.IO) {
                ExternalStreamConnectStore.save(context.applicationContext, credentials)
            }
        }
        return result
    }

    suspend fun checkSaved(context: Context): ExternalStreamConnectVerifier.Result? {
        val credentials = withContext(Dispatchers.IO) {
            ExternalStreamConnectStore.load(context.applicationContext)
        } ?: return null
        return ExternalStreamConnectVerifier.verify(credentials)
    }
}
