package tv.blofy.player.data.local

import android.app.Application
import java.io.InputStream
import java.io.OutputStream
import java.security.Key
import java.security.KeyStoreSpi
import java.security.Provider
import java.security.SecureRandom
import java.security.Security
import java.security.cert.Certificate
import java.security.spec.AlgorithmParameterSpec
import java.util.Collections
import java.util.Date
import javax.crypto.KeyGeneratorSpi
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/** JVM-only Keystore fixture: real AES-GCM, in-memory keys, no plaintext fallback in app code. */
class InMemoryKeystoreApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Security.removeProvider("AndroidKeyStore")
        MemoryKeys.values.clear()
        Security.addProvider(TestKeystoreProvider())
    }
}
private object MemoryKeys { val values = java.util.concurrent.ConcurrentHashMap<String, SecretKey>() }
class TestKeystoreProvider : Provider("AndroidKeyStore", 1.0, "Isolated JVM fixture") {
    init {
        put("KeyStore.AndroidKeyStore", MemoryKeyStore::class.java.name)
        put("KeyGenerator.AES", MemoryAesGenerator::class.java.name)
    }
}
class MemoryAesGenerator : KeyGeneratorSpi() {
    private var alias = ""
    override fun engineInit(random: SecureRandom?) = Unit
    override fun engineInit(size: Int, random: SecureRandom?) = Unit
    override fun engineInit(params: AlgorithmParameterSpec?, random: SecureRandom?) {
        alias = params!!.javaClass.getMethod("getKeystoreAlias").invoke(params) as String
    }
    override fun engineGenerateKey(): SecretKey = SecretKeySpec(ByteArray(32).also { SecureRandom().nextBytes(it) }, "AES")
        .also { MemoryKeys.values[alias] = it }
}
class MemoryKeyStore : KeyStoreSpi() {
    override fun engineGetKey(alias: String, password: CharArray?): Key? = MemoryKeys.values[alias]
    override fun engineGetCertificateChain(alias: String): Array<Certificate>? = null
    override fun engineGetCertificate(alias: String): Certificate? = null
    override fun engineGetCreationDate(alias: String): Date? = if (engineContainsAlias(alias)) Date(0) else null
    override fun engineSetKeyEntry(alias: String, key: Key, password: CharArray?, chain: Array<out Certificate>?) { MemoryKeys.values[alias] = key as SecretKey }
    override fun engineSetKeyEntry(alias: String, key: ByteArray, chain: Array<out Certificate>?) { error("not supported") }
    override fun engineSetCertificateEntry(alias: String, cert: Certificate) { error("not supported") }
    override fun engineDeleteEntry(alias: String) { MemoryKeys.values.remove(alias) }
    override fun engineAliases() = Collections.enumeration(MemoryKeys.values.keys)
    override fun engineContainsAlias(alias: String) = MemoryKeys.values.containsKey(alias)
    override fun engineSize() = MemoryKeys.values.size
    override fun engineIsKeyEntry(alias: String) = engineContainsAlias(alias)
    override fun engineIsCertificateEntry(alias: String) = false
    override fun engineGetCertificateAlias(cert: Certificate): String? = null
    override fun engineStore(stream: OutputStream?, password: CharArray?) = Unit
    override fun engineLoad(stream: InputStream?, password: CharArray?) = Unit
}
