package tv.blofy.player.ui.details

import android.os.Build
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import java.security.MessageDigest
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import tv.blofy.player.BuildConfig
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.ProviderMetadata
import tv.blofy.player.ui.common.ContentPresentation
import tv.blofy.player.ui.common.ContentScreenStyle

/**
 * Arabic movie/series display translation.
 *
 * New users explicitly opt in to first-party BLOFY AI (Groq) before a title
 * or overview is transmitted. Old on-device ML Kit preferences remain local
 * until the user presses the cloud button. No credentials or playback URLs
 * are sent to the cloud, and the source catalog is never modified.
 *
 * Re-rendering identical metadata does not abort active translation.
 */
internal class ArabicDetailsPresenter(
    private val activity: AppCompatActivity,
    private val stream: StreamEntity,
    private val titleView: TextView,
    private val overviewView: TextView,
    private val originalTitleView: TextView
) {
    private val preferences = activity.getSharedPreferences("blofy_local_metadata_ar", 0)
    private var currentTitle = ""
    private var currentOverview = ""
    private var version = 0
    private var localTranslator: Translator? = null
    private var cloudJob: Job? = null
    private var cloudFailed = false
    private var lastCloudAttemptVersion = -1
    private var showingOriginal = false
    private var localAutoEnabled = preferences.getBoolean("enabled", false)
    // Deliberately separate from the old local-translation preference. A
    // previous ML Kit opt-in must never silently consent to uploading a plot.
    private var cloudEnabled = preferences.getBoolean("groq_opt_in_v1", false)

    val button: Button = Button(activity).apply {
        textSize = 12.5f
        isAllCaps = false
        ContentScreenStyle.styleAction(this, false)
        visibility = View.GONE
        setOnClickListener {
            if (!isArabicUi()) return@setOnClickListener
            if (BuildConfig.CODE_ONLY_LOGIN) {
                if (cloudEnabled && allCloudFieldsReady() && cloudJob?.isActive != true) {
                    showingOriginal = !showingOriginal
                    renderVisible()
                } else {
                    // Explicit user action authorizes only title/synopsis text
                    // to be sent to the first-party Gateway for Arabic translation.
                    if (!cloudEnabled) {
                        cloudEnabled = true
                        preferences.edit().putBoolean("groq_opt_in_v1", true).apply()
                    }
                    version++ // stop old ML Kit callbacks before switching sources
                    localTranslator?.close()
                    localTranslator = null
                    showingOriginal = false
                    requestCloud(force = true)
                }
            } else {
                if (hasVisibleTranslation() && localTranslator == null) {
                    showingOriginal = !showingOriginal
                    renderVisible()
                } else {
                    localAutoEnabled = true
                    preferences.edit().putBoolean("enabled", true).apply()
                    requestLocal()
                }
            }
        }
    }

    fun render(metadata: ProviderMetadata.Metadata?) {
        val arabicUi = isArabicUi()
        val newTitle = ArabicDetailsPolicy.preferredTitle(stream.name, metadata?.title, arabicUi)
        val newOverview = ArabicDetailsPolicy.preferredOverview(stream.plot, metadata?.overview, arabicUi)
            ?: "لا يتوفر وصف لهذا المحتوى."
        if (currentTitle == newTitle && currentOverview == newOverview) {
            renderVisible()
            return
        }
        version++
        localTranslator?.close()
        localTranslator = null
        cloudJob?.cancel()
        cloudJob = null
        showingOriginal = false
        cloudFailed = false
        currentTitle = newTitle
        currentOverview = newOverview
        originalTitleView.visibility = View.GONE

        if (!arabicUi) {
            titleView.text = ContentPresentation.title(currentTitle, stream.kind)
            overviewView.text = currentOverview
            button.visibility = View.GONE
            return
        }
        renderVisible()
        val needs = needsCloudTranslation()
        if (BuildConfig.CODE_ONLY_LOGIN) {
            // Only accounts that opted in on this device request AI.
            if (CloudTranslationPolicy.shouldRequest(
                    codeOnly = true, arabicUi = true, optedIn = cloudEnabled,
                    needsTranslation = needs, cached = allCloudFieldsReady()
                ) && lastCloudAttemptVersion != version) {
                requestCloud()
            }
        } else if (needs && localAutoEnabled && !hasVisibleTranslation()) {
            requestLocal()
        }
    }

    private fun needsCloudTranslation() =
        ArabicDetailsPolicy.needsTranslation(currentTitle) ||
            ArabicDetailsPolicy.needsTranslation(currentOverview)

    private fun aiCached(original: String): String? =
        preferences.getString("groq_v1_" + key(original), null)?.takeIf(String::isNotBlank)

    private fun hasCloudTranslation(): Boolean =
        (ArabicDetailsPolicy.needsTranslation(currentTitle) && aiCached(currentTitle) != null) ||
            (ArabicDetailsPolicy.needsTranslation(currentOverview) && aiCached(currentOverview) != null)

    private fun allCloudFieldsReady(): Boolean =
        (!ArabicDetailsPolicy.needsTranslation(currentTitle) || aiCached(currentTitle) != null) &&
            (!ArabicDetailsPolicy.needsTranslation(currentOverview) || aiCached(currentOverview) != null)

    private fun translated(original: String): String? {
        if (!ArabicDetailsPolicy.needsTranslation(original)) return null
        return (if (cloudEnabled && BuildConfig.CODE_ONLY_LOGIN) aiCached(original) else null)
            ?: preferences.getString("v2_" + key(original), null)
    }

    private fun hasVisibleTranslation() =
        translated(currentTitle) != null || translated(currentOverview) != null

    private fun renderVisible() {
        if (!isArabicUi()) return
        val translatedTitle = if (showingOriginal) null else translated(currentTitle)
        val newTitle = translatedTitle?.takeIf(String::isNotBlank) ?: currentTitle
        titleView.text = ContentPresentation.title(newTitle, stream.kind)
        if (translatedTitle != null && translatedTitle != currentTitle) {
            originalTitleView.text = ContentPresentation.title(currentTitle, stream.kind)
            originalTitleView.visibility = View.VISIBLE
        } else originalTitleView.visibility = View.GONE
        overviewView.text = if (showingOriginal) currentOverview
            else translated(currentOverview)?.takeIf(String::isNotBlank) ?: currentOverview

        val needs = needsCloudTranslation()
        button.visibility = if (needs || hasVisibleTranslation()) View.VISIBLE else View.GONE
        if (BuildConfig.CODE_ONLY_LOGIN) {
            button.text = when {
                cloudJob?.isActive == true -> "جاري الترجمة الذكية…"
                cloudFailed -> "تعذر اتصال BLOFY AI • إعادة المحاولة"
                !cloudEnabled -> "ترجمة AI للعربية • عبر الإنترنت"
                hasCloudTranslation() && showingOriginal -> "عرض الترجمة العربية"
                hasCloudTranslation() -> "عرض النص الأصلي"
                else -> "ترجمة AI للعربية"
            }
            button.isEnabled = cloudJob?.isActive != true
        } else {
            button.text = when {
                localTranslator != null -> "جاري تجهيز الترجمة المحلية…"
                hasVisibleTranslation() && showingOriginal -> "عرض الترجمة العربية"
                hasVisibleTranslation() -> "عرض النص الأصلي"
                else -> "ترجمة محلية للعربية"
            }
            button.isEnabled = localTranslator == null
        }
    }

    private fun requestCloud(force: Boolean = false) {
        if (!CloudTranslationPolicy.shouldRequest(
                codeOnly = BuildConfig.CODE_ONLY_LOGIN, arabicUi = isArabicUi(),
                optedIn = cloudEnabled, needsTranslation = needsCloudTranslation(),
                cached = allCloudFieldsReady() && !force
            ) || cloudJob?.isActive == true) return
        cloudJob?.cancel()
        lastCloudAttemptVersion = version
        val captured = version
        val title = currentTitle
        val overview = currentOverview
        cloudFailed = false
        cloudJob = activity.lifecycleScope.launch {
            val output = StreamAiTranslationClient.translate(
                activity.applicationContext,
                if (ArabicDetailsPolicy.needsTranslation(title)) title else "",
                if (ArabicDetailsPolicy.needsTranslation(overview)) overview else ""
            )
            if (version != captured || activity.isFinishing || activity.isDestroyed) return@launch
            cloudJob = null
            if (output == null) {
                cloudFailed = true
            } else {
                if (output.title.isNotBlank() && title.isNotBlank() && output.title != title) {
                    cache("groq_v1_", title, output.title)
                }
                if (output.overview.isNotBlank() && overview.isNotBlank() && output.overview != overview) {
                    cache("groq_v1_", overview, output.overview)
                }
                if (!allCloudFieldsReady()) cloudFailed = true
            }
            renderVisible()
        }
        renderVisible()
    }

    // Backward-compatible offline fallback only for subscribers who had
    // already enabled ML Kit locally; new cloud opt-ins never download a model.
    private fun requestLocal() {
        if (localTranslator != null || cloudEnabled || !isArabicUi()) return
        val inputs = listOf(currentTitle, currentOverview).distinct().filter {
            ArabicDetailsPolicy.needsTranslation(it) && translated(it) == null
        }
        if (inputs.isEmpty()) { renderVisible(); return }
        val token = version
        val client = Translation.getClient(TranslatorOptions.Builder()
            .setSourceLanguage(TranslateLanguage.ENGLISH)
            .setTargetLanguage(TranslateLanguage.ARABIC).build())
        localTranslator = client
        renderVisible()
        client.downloadModelIfNeeded(DownloadConditions.Builder().requireWifi().build())
            .addOnSuccessListener {
                if (token != version || activity.isFinishing || activity.isDestroyed || cloudEnabled) {
                    client.close(); return@addOnSuccessListener
                }
                translateLocalNext(client, inputs, 0, token)
            }
            .addOnFailureListener {
                client.close()
                if (localTranslator === client) localTranslator = null
                if (token == version) renderVisible()
            }
    }

    private fun translateLocalNext(client: Translator, pending: List<String>, index: Int, token: Int) {
        if (token != version || activity.isFinishing || activity.isDestroyed || cloudEnabled) {
            client.close(); return
        }
        if (index >= pending.size) {
            client.close()
            if (localTranslator === client) localTranslator = null
            renderVisible(); return
        }
        val source = pending[index]
        client.translate(source)
            .addOnSuccessListener { result ->
                if (token == version && result.isNotBlank() && result != source) {
                    cache("v2_", source, result)
                    renderVisible()
                }
                translateLocalNext(client, pending, index + 1, token)
            }
            .addOnFailureListener {
                client.close()
                if (localTranslator === client) localTranslator = null
                if (token == version) renderVisible()
            }
    }

    private fun cache(prefix: String, original: String, translation: String) {
        if (preferences.all.size > 500) {
            preferences.edit().clear()
                .putBoolean("enabled", localAutoEnabled)
                .putBoolean("groq_opt_in_v1", cloudEnabled)
                .apply()
        }
        preferences.edit().putString(prefix + key(original), translation.take(5500)).apply()
    }

    private fun key(value: String) = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    @Suppress("DEPRECATION")
    private fun isArabicUi() = if (Build.VERSION.SDK_INT >= 24)
        activity.resources.configuration.locales[0].language == "ar"
    else activity.resources.configuration.locale.language == "ar"

    fun close() {
        version++
        cloudJob?.cancel()
        cloudJob = null
        localTranslator?.close()
        localTranslator = null
    }
}
