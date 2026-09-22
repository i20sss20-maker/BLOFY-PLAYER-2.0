package tv.blofy.player.ui.profile

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.content.res.AppCompatResources
import tv.blofy.player.R
import tv.blofy.player.core.profile.ProfileStore
import tv.blofy.player.core.security.ParentalGate
import tv.blofy.player.data.profile.ProfileLibraryStore
import tv.blofy.player.ui.common.BlofyTvDesign
import tv.blofy.player.ui.common.TvUiTuning

class ProfilesActivity : AppCompatActivity() {
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = resources.configuration.layoutDirection
            gravity = Gravity.TOP
            setPadding(dp(42), dp(30), dp(42), dp(30))
            background = AppCompatResources.getDrawable(this@ProfilesActivity, R.drawable.blofy_home_background)
        }
        setContentView(root)
        render()
    }

    private fun render() {
        root.removeAllViews()
        val active = ProfileStore.active(this)
        root.addView(TextView(this).apply {
            text = getString(R.string.profiles_title)
            textSize = 30f
            typeface = BlofyTvDesign.HeadingTypeface
            setTextColor(Color.WHITE)
            gravity = Gravity.START
        })
        root.addView(TextView(this).apply {
            text = getString(R.string.profiles_current, active.name, ProfileStore.all(this@ProfilesActivity).size)
            textSize = 13f
            setTextColor(BlofyTvDesign.TextMuted)
            gravity = Gravity.START
            setPadding(0, dp(5), 0, dp(18))
        })

        ProfileStore.all(this).forEachIndexed { index, profile ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_VERTICAL or Gravity.START
                setPadding(dp(20), dp(12), dp(20), dp(12))
                isFocusable = true
                isClickable = true
                background = cardBg(profile.id == active.id, false)
                addView(TextView(this@ProfilesActivity).apply {
                    val lock = if (profile.pinHash != null) "  🔒" else ""
                    val icon = when { profile.kids -> "🧒"; profile.guest -> "◌"; else -> "👤" }
                    text = "$icon  ${profile.name}$lock"
                    textSize = 19f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(Color.WHITE)
                    gravity = Gravity.START
                })
                addView(TextView(this@ProfilesActivity).apply {
                    text = when {
                        profile.guest -> getString(R.string.profiles_guest_meta)
                        profile.kids && profile.pinHash != null -> getString(R.string.profiles_kids_locked_meta)
                        profile.kids -> getString(R.string.profiles_kids_meta)
                        else -> getString(R.string.profiles_standard_meta)
                    }
                    textSize = 12f
                    setTextColor(BlofyTvDesign.TextMuted)
                    gravity = Gravity.START
                })
                setOnFocusChangeListener { view, focused ->
                    view.background = cardBg(profile.id == active.id, focused)
                    view.animate().cancel()
                    val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.015f) else 1f
                    view.animate()
                        .scaleX(targetScale)
                        .scaleY(targetScale)
                        .translationZ(if (focused) TvUiTuning.focusElevation(view.context, dp(8).toFloat()) else 0f)
                        .setDuration(TvUiTuning.focusDuration(view.context, focused))
                        .start()
                }
                setOnClickListener { selectProfile(profile) }
            }
            root.addView(card, LinearLayout.LayoutParams(-1, dp(92)).apply { bottomMargin = dp(9) })
            if (index == 0) card.post { card.requestFocus() }
        }

        val profileManagement = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = resources.configuration.layoutDirection }
        profileManagement.addView(actionButton(getString(R.string.profiles_add)) { requireManagementAccess { showCreateProfile() } }, LinearLayout.LayoutParams(0, dp(54), 1f).apply { marginStart = dp(8) })
        profileManagement.addView(actionButton(getString(R.string.profiles_delete_current)) { requireManagementAccess { deleteActiveProfile() } }, LinearLayout.LayoutParams(0, dp(54), 1f))
        root.addView(profileManagement, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(8) })

        root.addView(TextView(this).apply {
            text = getString(R.string.profiles_current_security)
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(0, dp(18), 0, dp(8))
        })
        val profilePin = EditText(this).apply {
            hint = getString(if (active.pinHash != null) R.string.profiles_pin_change_hint else R.string.profiles_pin_hint)
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(BlofyTvDesign.TextMuted)
            background = fieldBg()
            setPadding(dp(16), 0, dp(16), 0)
        }
        root.addView(profilePin, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(9) })

        val profileActions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = resources.configuration.layoutDirection }
        profileActions.addView(actionButton(getString(R.string.profiles_save_profile_pin)) {
            val value = profilePin.text?.toString().orEmpty()
            if (value.length in 4..8 && value.all(Char::isDigit)) {
                requireManagementAccess {
                    ProfileStore.setPin(this, active.id, value)
                    Toast.makeText(this, getString(R.string.profiles_profile_pin_saved, active.name), Toast.LENGTH_SHORT).show()
                    render()
                }
            } else Toast.makeText(this, getString(R.string.profiles_pin_invalid), Toast.LENGTH_SHORT).show()
        }, LinearLayout.LayoutParams(0, dp(54), 1f).apply { marginStart = dp(8) })
        profileActions.addView(actionButton(getString(R.string.profiles_clear_profile_pin)) {
            requireManagementAccess {
                ProfileStore.setPin(this, active.id, null)
                Toast.makeText(this, getString(R.string.profiles_profile_pin_cleared), Toast.LENGTH_SHORT).show()
                render()
            }
        }, LinearLayout.LayoutParams(0, dp(54), 1f))
        root.addView(profileActions)

        root.addView(TextView(this).apply {
            text = getString(R.string.profiles_content_pin_title)
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            gravity = Gravity.START
            setPadding(0, dp(18), 0, dp(8))
        })
        val parentalPin = EditText(this).apply {
            hint = getString(if (ParentalGate.hasPin(this@ProfilesActivity)) R.string.profiles_pin_change_hint else R.string.profiles_pin_hint)
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            isSingleLine = true
            setTextColor(Color.WHITE)
            setHintTextColor(BlofyTvDesign.TextMuted)
            background = fieldBg()
            setPadding(dp(16), 0, dp(16), 0)
        }
        root.addView(parentalPin, LinearLayout.LayoutParams(-1, dp(58)).apply { bottomMargin = dp(9) })

        val parentalActions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; layoutDirection = resources.configuration.layoutDirection }
        parentalActions.addView(actionButton(getString(R.string.profiles_save_content_pin)) {
            val value = parentalPin.text?.toString().orEmpty()
            if (value.trim().length in 4..8 && value.trim().all(Char::isDigit)) {
                requireManagementAccess {
                    if (ParentalGate.setPin(this, value)) {
                        Toast.makeText(this, getString(R.string.profiles_content_pin_saved), Toast.LENGTH_SHORT).show(); render()
                    }
                }
            } else Toast.makeText(this, getString(R.string.profiles_pin_invalid), Toast.LENGTH_SHORT).show()
        }, LinearLayout.LayoutParams(0, dp(54), 1f).apply { marginStart = dp(8) })
        parentalActions.addView(actionButton(getString(R.string.profiles_clear_content_pin)) {
            requireManagementAccess {
                ParentalGate.clearPin(this); Toast.makeText(this, getString(R.string.profiles_content_pin_cleared), Toast.LENGTH_SHORT).show(); render()
            }
        }, LinearLayout.LayoutParams(0, dp(54), 1f))
        root.addView(parentalActions)
    }

    private fun showCreateProfile() {
        val name = EditText(this).apply {
            hint = getString(R.string.profiles_name_hint)
            isSingleLine = true
            setPadding(dp(18), dp(6), dp(18), dp(6))
        }
        val kids = CheckBox(this).apply { text = getString(R.string.profiles_kids_mode) }
        val guest = CheckBox(this).apply { text = getString(R.string.profiles_guest_mode) }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(4), dp(18), 0)
            addView(name, LinearLayout.LayoutParams(-1, dp(58)))
            addView(kids)
            addView(guest)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.profiles_create_title)
            .setView(box)
            .setNegativeButton(R.string.profiles_cancel, null)
            .setPositiveButton(R.string.profiles_create) { _, _ ->
                runCatching { ProfileStore.create(this, name.text?.toString().orEmpty(), kids.isChecked, guest.isChecked) }
                    .onSuccess { render() }
                    .onFailure { Toast.makeText(this, it.message ?: getString(R.string.profiles_create_failed), Toast.LENGTH_SHORT).show() }
            }.show()
    }

    private fun deleteActiveProfile() {
        val active = ProfileStore.active(this)
        if (ProfileStore.all(this).size <= 1) {
            Toast.makeText(this, getString(R.string.profiles_last_delete_blocked), Toast.LENGTH_SHORT).show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.profiles_delete_title, active.name))
            .setMessage(R.string.profiles_delete_message)
            .setNegativeButton(R.string.profiles_cancel, null)
            .setPositiveButton(R.string.profiles_delete) { _, _ ->
                if (ProfileStore.delete(this, active.id)) {
                    ProfileLibraryStore.clearProfile(this, active.id)
                    render()
                }
            }.show()
    }

    private fun selectProfile(profile: ProfileStore.Profile) {
        val active = ProfileStore.active(this)
        if (profile.id == active.id) return
        if (profile.pinHash != null) {
            requireProfilePin(listOf(profile)) { activate(profile) }
        } else if (active.kids && !profile.kids &&
            (ParentalGate.hasPin(this) || ProfileStore.all(this).any { !it.kids && it.pinHash != null })) {
            requireManagementAccess { activate(profile) }
        } else {
            activate(profile)
        }
    }

    /** Management must never be a way to erase a PIN or leave Kids without adult authorization. */
    private fun requireManagementAccess(onGranted: () -> Unit) {
        val active = ProfileStore.active(this)
        val grantIfStillCurrent = {
            if (!isFinishing && !isDestroyed && ProfileStore.active(this).id == active.id) onGranted()
        }
        if (ParentalGate.hasPin(this)) {
            ParentalGate.requirePin(this, grantIfStillCurrent)
            return
        }
        val protectedProfiles = if (active.kids) {
            ProfileStore.all(this).filter { !it.kids && it.pinHash != null }
        } else listOf(active).filter { it.pinHash != null }
        when {
            protectedProfiles.isNotEmpty() -> requireProfilePin(protectedProfiles, grantIfStillCurrent)
            active.kids -> Toast.makeText(this, getString(R.string.profiles_adult_required), Toast.LENGTH_SHORT).show()
            else -> grantIfStillCurrent()
        }
    }

    private fun requireProfilePin(profiles: List<ProfileStore.Profile>, onGranted: () -> Unit) {
        val input = EditText(this).apply {
            hint = "PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            isSingleLine = true
            setPadding(dp(18), dp(6), dp(18), dp(6))
        }
        AlertDialog.Builder(this)
            .setTitle(if (profiles.size == 1) getString(R.string.profiles_open_title, profiles.first().name) else getString(R.string.profiles_adult_pin_title))
            .setMessage(R.string.profiles_enter_pin)
            .setView(input)
            .setNegativeButton(R.string.profiles_cancel, null)
            .setPositiveButton(R.string.profiles_open) { _, _ ->
                val candidates = ProfileStore.all(this).filter { current ->
                    current.pinHash != null && profiles.any { it.id == current.id }
                }
                if (candidates.any { ProfileStore.verifyPin(it, input.text?.toString().orEmpty()) }) onGranted()
                else Toast.makeText(this, getString(R.string.profiles_pin_wrong), Toast.LENGTH_SHORT).show()
            }
            .show()
    }

    private fun activate(profile: ProfileStore.Profile) {
        ProfileStore.select(this, profile.id)
        Toast.makeText(this, getString(R.string.profiles_selected, profile.name), Toast.LENGTH_SHORT).show()
        render()
    }

    private fun actionButton(label: String, action: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 14f; setTextColor(Color.WHITE); background = buttonBg(false)
        stateListAnimator = null
        setOnFocusChangeListener { view, focused ->
            view.background = buttonBg(focused)
            view.animate().cancel()
            val targetScale = if (focused) TvUiTuning.focusScale(view.context, 1.02f) else 1f
            view.animate()
                .scaleX(targetScale)
                .scaleY(targetScale)
                .translationZ(if (focused) TvUiTuning.focusElevation(view.context, dp(7).toFloat()) else 0f)
                .setDuration(TvUiTuning.focusDuration(view.context, focused))
                .start()
        }
        setOnClickListener { action() }
    }

    private fun cardBg(selected: Boolean, focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        when { focused -> intArrayOf(0xFF6D3FA0.toInt(), 0xFF352047.toInt()); selected -> intArrayOf(0xFF342248.toInt(), 0xFF20162C.toInt()); else -> intArrayOf(0xFF21172D.toInt(), 0xFF15101D.toInt()) }
    ).apply { cornerRadius = dp(16).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) BlofyTvDesign.FocusStroke else 0xFF4B385E.toInt()) }

    private fun fieldBg() = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(0xFF20162B.toInt()); setStroke(dp(1), 0xFF513D67.toInt()) }
    private fun buttonBg(focused: Boolean) = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
        if (focused) intArrayOf(0xFF7143A3.toInt(), 0xFF43285E.toInt()) else intArrayOf(0xFF2A1C39.toInt(), 0xFF1D1427.toInt())
    ).apply { cornerRadius = dp(14).toFloat(); setStroke(if (focused) dp(2) else dp(1), if (focused) BlofyTvDesign.FocusStroke else 0xFF513D67.toInt()) }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
