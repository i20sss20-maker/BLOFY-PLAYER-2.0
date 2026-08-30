package tv.blofy.player

import android.app.Application

class BlofyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Foundation hook: database, diagnostics, provider profiles and remote config are initialized here.
    }
}
