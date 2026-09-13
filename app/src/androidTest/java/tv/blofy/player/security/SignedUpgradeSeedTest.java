package tv.blofy.player.security;

import android.content.Context;
import android.content.SharedPreferences;
import android.database.sqlite.SQLiteDatabase;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/** Framework-only fixture: can execute against the original, un-obfuscated rc07.42. */
@RunWith(AndroidJUnit4.class)
public class SignedUpgradeSeedTest {
    @Test public void seedOldReleaseData() throws Exception {
        assumeTrue("true".equals(InstrumentationRegistry.getArguments().getString("signedUpgradeReview")));
        Context c = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("tv.blofy.player.v2", c.getPackageName());
        assertEquals(2000053, c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionCode);
        SharedPreferences identity = c.getSharedPreferences("blofy_device_identity", Context.MODE_PRIVATE);
        String id = identity.getString("device_id_v2", "");
        String pin = identity.getString("activation_code", "");
        assertTrue(id.matches("BLOFY-[A-Z0-9]{4}-[A-Z0-9]{4}"));
        assertTrue(pin.matches("[0-9]{6}"));
        assertTrue(c.getSharedPreferences("blofy_signed_upgrade_review", Context.MODE_PRIVATE).edit()
                .putString("device_id", id).putString("pin", pin).putString("sentinel", "rc42-data-retained").commit());
        String alias = "blofy_provider_credentials_v1";
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        SecretKey key = (SecretKey) store.getKey(alias, null);
        if (key == null) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true).build());
            key = generator.generateKey();
        }
        assertTrue(c.getDatabasePath("blofy-player-2.db").isFile());
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(c.getDatabasePath("blofy-player-2.db").getPath(), null, SQLiteDatabase.OPEN_READWRITE)) {
            assertEquals(12, db.getVersion());
            db.beginTransaction();
            try {
                db.execSQL("INSERT INTO providers (id,name,baseUrl,username,password,providerType,liveFormat,preferredTransport,preferredEngine,allowCrossProtocolRedirects,enabled,updatedAt,subscriberToken) VALUES (?,?,?,?,?,'xtream','ts','cronet','media3',1,1,1000,'')",
                        new Object[]{"signed-upgrade-qa", "BLOFY Upgrade QA", seal("https://upgrade-test.invalid", key), seal("local-qa-user", key), seal("local-qa-password", key)});
                db.execSQL("INSERT INTO streams (`key`,providerId,remoteId,categoryId,kind,name,archiveEnabled,archiveDurationDays,favorite,locked) VALUES ('signed-upgrade-movie','signed-upgrade-qa','1',NULL,'movie','Upgrade QA Movie',0,0,1,1)");
                db.execSQL("INSERT INTO watch_state (contentKey,providerId,kind,positionMs,durationMs,completed,updatedAt) VALUES ('signed-upgrade-movie','signed-upgrade-qa','movie',60000,300000,0,1000)");
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        }
    }

    private static String seal(String value, SecretKey key) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV(), encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] packed = ByteBuffer.allocate(1 + iv.length + encrypted.length).put((byte) iv.length).put(iv).put(encrypted).array();
        return "BLOFYENC1:" + Base64.encodeToString(packed, Base64.NO_WRAP);
    }
}
