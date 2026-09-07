package tv.blofy.player.ui.profile

import android.app.AlertDialog
import android.app.Application
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowAlertDialog
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.core.security.ParentalGate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class ProfilesManagementGateTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private var controller: ActivityController<ProfilesActivity>? = null
    private val activity get() = checkNotNull(controller).get()

    @Before fun setup() {
        listOf("blofy_profiles", "blofy_parental").forEach { name ->
            context.getSharedPreferences(name, 0).edit().clear().commit()
        }
    }

    @After fun cleanup() {
        controller?.pause()?.stop()?.destroy()
        controller = null
    }

    private fun open() { controller = Robolectric.buildActivity(ProfilesActivity::class.java).setup() }
    private fun views(root: View): List<View> = listOf(root) +
        if (root is ViewGroup) (0 until root.childCount).flatMap { views(root.getChildAt(it)) } else emptyList()
    private fun tapButton(label: String) {
        views(activity.window.decorView).filterIsInstance<Button>().single { it.text.toString() == label }.performClick()
    }
    private fun dialog(): AlertDialog = checkNotNull(ShadowAlertDialog.getLatestAlertDialog()).also { assertTrue(it.isShowing) }
    private fun answerPin(pin: String) {
        val prompt = dialog()
        views(prompt.window!!.decorView).filterIsInstance<EditText>().single().setText(pin)
        prompt.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
    }
    private fun tapProfile(name: String) {
        val title = views(activity.window.decorView).filterIsInstance<TextView>()
            .single { it.text.toString().startsWith("👤  $name") }
        (title.parent as View).performClick()
    }

    @Test fun contentPinCannotBeClearedWithoutItsCurrentPin() {
        assertTrue(ParentalGate.setPin(context, "1234"))
        open()
        tapButton("إلغاء PIN المحتوى")
        assertTrue(ParentalGate.hasPin(context))
        answerPin("9999")
        assertTrue(ParentalGate.verify(context, "1234"))
        answerPin("1234")
        assertFalse(ParentalGate.hasPin(context))
    }

    @Test fun contentPinReplacementRequiresTheOldPin() {
        assertTrue(ParentalGate.setPin(context, "1234"))
        open()
        views(activity.window.decorView).filterIsInstance<EditText>().last().setText("5678")
        tapButton("حفظ PIN للمحتوى")
        assertTrue(ParentalGate.verify(context, "1234"))
        assertFalse(ParentalGate.verify(context, "5678"))
        answerPin("1234")
        assertTrue(ParentalGate.verify(context, "5678"))
        assertFalse(ParentalGate.verify(context, "1234"))
    }

    @Test fun activeProfilePinCannotBeClearedWithoutItsCurrentPin() {
        ProfileStore.setPin(context, "main", "1234")
        open()
        tapButton("إلغاء PIN للملف")
        answerPin("9999")
        assertNotNull(ProfileStore.active(context).pinHash)
        tapButton("إلغاء PIN للملف")
        answerPin("1234")
        assertNull(ProfileStore.active(context).pinHash)
    }

    @Test fun kidsCannotCreateAnAdultProfileWithoutTheGlobalPin() {
        assertTrue(ParentalGate.setPin(context, "1234"))
        ProfileStore.select(context, "kids")
        open()
        tapButton("＋ إضافة ملف")
        assertEquals("PIN", views(dialog().window!!.decorView).filterIsInstance<EditText>().single().hint.toString())
        answerPin("9999")
        assertEquals(2, ProfileStore.all(context).size)
        answerPin("1234")
        assertEquals("اسم الملف", views(dialog().window!!.decorView).filterIsInstance<EditText>().single().hint.toString())
    }

    @Test fun kidsCannotDeleteTheirProfileToFallBackToAdultWithoutAuthorization() {
        ProfileStore.setPin(context, "main", "1234")
        ProfileStore.select(context, "kids")
        open()
        tapButton("حذف الملف الحالي")
        answerPin("9999")
        assertEquals("kids", ProfileStore.active(context).id)
        assertEquals(2, ProfileStore.all(context).size)
    }

    @Test fun kidsCannotBypassProtectedAdultBySelectingAnotherUnprotectedAdult() {
        ProfileStore.setPin(context, "main", "1234")
        val other = ProfileStore.create(context, "Other adult")
        ProfileStore.select(context, "kids")
        open()
        tapProfile("Other adult")
        assertEquals("kids", ProfileStore.active(context).id)
        answerPin("9999")
        assertEquals("kids", ProfileStore.active(context).id)
        tapProfile("Other adult")
        answerPin("1234")
        assertEquals(other.id, ProfileStore.active(context).id)
    }

    @Test fun defaultKidsCanReturnToAdultWhenNoPinWasConfigured() {
        ProfileStore.select(context, "kids")
        open()
        tapProfile("الرئيسي")
        assertEquals("main", ProfileStore.active(context).id)
    }

    @Test fun normalAdultCanCreateProfileWhenNoPinWasConfigured() {
        open()
        tapButton("＋ إضافة ملف")
        val prompt = dialog()
        views(prompt.window!!.decorView).filterIsInstance<EditText>().single().setText("New adult")
        prompt.getButton(AlertDialog.BUTTON_POSITIVE).performClick()
        assertTrue(ProfileStore.all(context).any { it.name == "New adult" && !it.kids })
    }

    @Test fun profilePinChangedWhileDialogIsOpenCannotBeClearedWithStalePin() {
        ProfileStore.setPin(context, "main", "1234")
        open()
        tapButton("إلغاء PIN للملف")
        ProfileStore.setPin(context, "main", "5678")
        answerPin("1234")
        assertTrue(ProfileStore.verifyPin(ProfileStore.active(context), "5678"))
        assertNotNull(ProfileStore.active(context).pinHash)
    }
}
