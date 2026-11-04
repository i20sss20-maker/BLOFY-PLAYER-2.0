package tv.blofy.player.data

import com.google.gson.JsonParseException
import java.io.EOFException
import java.io.IOException
import java.net.ConnectException
import java.net.ProtocolException
import java.net.UnknownHostException
import java.util.zip.ZipException
import javax.net.ssl.SSLException
import retrofit2.HttpException

/**
 * A broken gzip response can be re-requested with Accept-Encoding: identity.
 * This is a DIFFERENT transport mode, not an endless replay of the same body.
 * Never mask authentication, DNS or TLS errors.
 */
internal object CatalogTransportFallbackPolicy {
    fun shouldTryIdentity(error: Throwable): Boolean {
        val chain = generateSequence(error) { it.cause }.take(12).toList()
        if (chain.any { it is HttpException || it is UnknownHostException ||
                it is ConnectException || it is SSLException }) return false
        return chain.any { it is EOFException || it is ProtocolException ||
                it is ZipException || it is JsonParseException ||
                it is IOException }
    }
}
