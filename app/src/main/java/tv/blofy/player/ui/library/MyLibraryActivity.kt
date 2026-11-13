package tv.blofy.player.ui.library

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

/**
 * Legacy navigation target. STREAM now has a single Downloads destination
 * in the same sidebar position as its former My Library menu item.
 * Keep this trampoline for old deep links without duplicating navigation.
 */
class MyLibraryActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        startActivity(Intent(this, DownloadsActivity::class.java))
        finish()
    }
}
