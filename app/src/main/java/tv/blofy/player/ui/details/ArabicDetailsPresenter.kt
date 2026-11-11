package tv.blofy.player.ui.details

import android.os.Build
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.mlkit.nl.translate.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import java.security.MessageDigest
import tv.blofy.player.data.local.StreamEntity
import tv.blofy.player.data.metadata.ProviderMetadata
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.ContentPresentation
import tv.blofy.player.ui.common.ContentScreenStyle

/**
 * Optional on-device Arabic translation for source text that has no Arabic variant.
 * Only the language model (~30 MB) is downloaded, on Wi-Fi, after first opt-in.
 * No user playlist, provider credentials, titles or stories are posted to a
 * translation server. Failures leave original descriptions fully readable.
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
    private var translator: Translator? = null
    private var showingOriginal = false
    private var autoEnabled = preferences.getBoolean("enabled", false)

    val button: Button = Button(activity).apply {
        text = "ترجمة للعربية"
        textSize = 12.5f
        isAllCaps = false
        ContentScreenStyle.styleAction(this, false)
        visibility = View.GONE
        setOnClickListener {
            if (buttonShowingOriginal()) {
                showingOriginal = !showingOriginal
                renderVisible()
            } else {
                autoEnabled = true
                preferences.edit().putBoolean("enabled", true).apply()
                requestTranslation()
            }
        }
    }

    private fun buttonShowingOriginal(): Boolean {
        val hasTranslation = translated(currentTitle) != null || translated(currentOverview) != null
        return hasTranslation && translator == null
    }

    fun render(metadata: ProviderMetadata.Metadata?) {
        version++
        translator?.close()
        translator = null
        showingOriginal = false
        val arabicUi = isArabicUi()
        currentTitle = ArabicDetailsPolicy.preferredTitle(stream.name, metadata?.title, arabicUi)
        currentOverview = ArabicDetailsPolicy.preferredOverview(stream.plot, metadata?.overview, arabicUi)
            ?: "لا يتوفر وصف لهذا المحتوى."
        originalTitleView.visibility = View.GONE
        if (!arabicUi) {
            titleView.text = ContentPresentation.title(currentTitle, stream.kind)
            overviewView.text = currentOverview
            button.visibility = View.GONE
            return
        }
        renderVisible()
        val needs = ArabicDetailsPolicy.needsTranslation(currentTitle) ||
            ArabicDetailsPolicy.needsTranslation(currentOverview)
        button.visibility = if (needs) View.VISIBLE else View.GONE
        if (needs && autoEnabled && (
            (ArabicDetailsPolicy.needsTranslation(currentTitle) && translated(currentTitle) == null) ||
            (ArabicDetailsPolicy.needsTranslation(currentOverview) && translated(currentOverview) == null)
        )) requestTranslation()
    }

    private fun renderVisible() {
        val englishTitle = currentTitle
        val translatedTitle = if (!showingOriginal) translated(englishTitle) else null
        val newTitle = translatedTitle?.takeIf(String::isNotBlank) ?: englishTitle
        titleView.text = ContentPresentation.title(newTitle, stream.kind)
        if (translatedTitle != null && translatedTitle != englishTitle) {
            originalTitleView.text = ContentPresentation.title(englishTitle, stream.kind)
            originalTitleView.visibility = View.VISIBLE
        } else {
            originalTitleView.visibility = View.GONE
        }
        val localizedOverview = if (!showingOriginal) translated(currentOverview) else null
        overviewView.text = localizedOverview?.takeIf(String::isNotBlank) ?: currentOverview
        button.text = if (buttonShowingOriginal()) {
            if (showingOriginal) "عرض الترجمة العربية" else "عرض النص الأصلي"
        } else "ترجمة للعربية"
        button.isEnabled = true
    }

    private fun requestTranslation() {
        if (translator != null || !isArabicUi()) return
        val inputs = listOf(currentTitle, currentOverview).distinct().filter {
            ArabicDetailsPolicy.needsTranslation(it) && translated(it) == null
        }
        if (inputs.isEmpty()) {
            renderVisible()
            return
        }
        val token = version
        val options = TranslatorOptions.Builder()
            .setSourceLanguage(TranslateLanguage.ENGLISH)
            .setTargetLanguage(TranslateLanguage.ARABIC)
            .build()
        val client = Translation.getClient(options)
        translator = client
        button.isEnabled = false
        button.text = "تجهيز الترجمة عبر Wi-Fi…"
        client.downloadModelIfNeeded(DownloadConditions.Builder().requireWifi().build())
            .addOnSuccessListener {
                if (token != version || activity.isFinishing || activity.isDestroyed) {
                    client.close()
                    return@addOnSuccessListener
                }
                translateNext(client, inputs, 0, token)
            }
            .addOnFailureListener {
                client.close()
                if (translator === client) translator = null
                if (token == version && !activity.isFinishing && !activity.isDestroyed) {
                    button.isEnabled = true
                    button.text = "تعذر تنزيل الترجمة - حاول عبر Wi-Fi"
                }
            }
    }

    private fun translateNext(client: Translator, pending: List<String>, index: Int, token: Int) {
        if (token != version || activity.isFinishing || activity.isDestroyed) {
            client.close()
            return
        }
        if (index >= pending.size) {
            client.close()
            if (translator === client) translator = null
            renderVisible()
            return
        }
        val original = pending[index]
        client.translate(original)
            .addOnSuccessListener { result ->
                if (token == version && result.isNotBlank() && result != original) {
                    cache(original, result)
                }
                translateNext(client, pending, index + 1, token)
            }
            .addOnFailureListener {
                client.close()
                if (translator === client) translator = null
                if (token == version && !activity.isFinishing && !activity.isDestroyed) {
                    renderVisible()
                    button.text = "تعذر الترجمة - إعادة المحاولة"
                }
            }
    }

    private fun translated(original: String): String? {
        if (!ArabicDetailsPolicy.needsTranslation(original)) return null
        return preferences.getString("v2_" + key(original), null)
    }

    private fun cache(original: String, translation: String) {
        // Keep only a small local display cache. Source metadata is unchanged.
        if (preferences.all.size > 400) {
            preferences.edit().clear().putBoolean("enabled", autoEnabled).apply()
        }
        preferences.edit().putString("v2_" + key(original), translation.take(6000)).apply()
    }

    private fun key(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    @Suppress("DEPRECATION")
    private fun isArabicUi() = if (Build.VERSION.SDK_INT >= 24)
        activity.resources.configuration.locales[0].language == "ar"
    else activity.resources.configuration.locale.language == "ar"

    fun close() {
        version++
        translator?.close()
        translator = null
    }
}
