package tv.blofy.player.core.network

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.PlaybackException
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener

/** Retry the same request with HTTP only when Cronet fails to establish a connection.
 * Close the failed request first: one-connection subscriptions cannot overlap transports.
 * Server refusals and mid-body read failures are left to the normal player error policy.
 */
@OptIn(markerClass = [UnstableApi::class])
internal class HttpOpenFallbackFactory(
    private val primary: HttpDataSource.Factory,
    private val fallback: HttpDataSource.Factory
) : HttpDataSource.Factory {
    override fun setDefaultRequestProperties(properties: Map<String, String>): HttpDataSource.Factory = apply {
        primary.setDefaultRequestProperties(properties)
        fallback.setDefaultRequestProperties(properties)
    }

    override fun createDataSource(): HttpDataSource = OpenFallback(primary.createDataSource(), fallback.createDataSource())

    private class OpenFallback(
        private val primary: HttpDataSource,
        private val fallback: HttpDataSource
    ) : HttpDataSource by primary {
        private var active = primary

        override fun open(dataSpec: DataSpec): Long {
            active = primary
            try {
                return primary.open(dataSpec)
            } catch (error: HttpDataSource.HttpDataSourceException) {
                if (error.reason != PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED &&
                    error.reason != PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT) throw error
                // Never mask an HTTP refusal, even if a vendor reports it with an unusual code.
                if (error is HttpDataSource.InvalidResponseCodeException) throw error
                try { primary.close() } catch (closeError: Exception) { error.addSuppressed(closeError) }
                active = fallback
                return fallback.open(dataSpec)
            }
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = active.read(buffer, offset, length)
        override fun close() = active.close()
        override fun getUri(): Uri? = active.uri
        override fun getResponseCode(): Int = active.responseCode
        override fun getResponseHeaders(): Map<String, List<String>> = active.responseHeaders
        override fun addTransferListener(listener: TransferListener) {
            primary.addTransferListener(listener)
            fallback.addTransferListener(listener)
        }
        override fun setRequestProperty(name: String, value: String) {
            primary.setRequestProperty(name, value)
            fallback.setRequestProperty(name, value)
        }
        override fun clearRequestProperty(name: String) {
            primary.clearRequestProperty(name)
            fallback.clearRequestProperty(name)
        }
        override fun clearAllRequestProperties() {
            primary.clearAllRequestProperties()
            fallback.clearAllRequestProperties()
        }
    }
}
