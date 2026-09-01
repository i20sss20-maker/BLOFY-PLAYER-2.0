package tv.blofy.player;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.drawable.Drawable;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/** Public bridge to the untouched original v339 BlofyUi implementation. */
public final class V339OriginalBridge {
    public static final int BLACK = BlofyUi.BLACK;
    public static final int NAVY = BlofyUi.NAVY;
    public static final int PANEL = BlofyUi.PANEL;
    public static final int PANEL_ALT = BlofyUi.PANEL_ALT;
    public static final int PANEL_SOFT = BlofyUi.PANEL_SOFT;
    public static final int PURPLE = BlofyUi.PURPLE;
    public static final int PURPLE_DARK = BlofyUi.PURPLE_DARK;
    public static final int PURPLE_LIGHT = BlofyUi.PURPLE_LIGHT;
    public static final int CYAN = BlofyUi.CYAN;
    public static final int TEXT = BlofyUi.TEXT;
    public static final int MUTED = BlofyUi.MUTED;
    public static final int SUCCESS = BlofyUi.SUCCESS;
    public static final int ERROR = BlofyUi.ERROR;
    public static final int STROKE = BlofyUi.STROKE;
    public static final int DIVIDER = BlofyUi.DIVIDER;

    private V339OriginalBridge() {}

    public static int dp(Context context, int value) { return BlofyUi.dp(context, value); }
    public static boolean isTv(Context context) { return BlofyUi.isTv(context); }
    public static TextView text(Context context, String value, int sp, int color) { return BlofyUi.text(context, value, sp, color); }
    public static TextView title(Context context, String value, int sp) { return BlofyUi.title(context, value, sp); }
    public static TextView chip(Context context, String value) { return BlofyUi.chip(context, value); }
    public static EditText input(Context context, String hint, boolean numeric) { return BlofyUi.input(context, hint, numeric); }
    public static Button button(Context context, String label, boolean primary) { return BlofyUi.button(context, label, primary); }
    public static TextView navChip(Context context, String label) { return BlofyUi.navChip(context, label); }
    public static TextView sidebarItem(Context context, String icon, String label, boolean selected) { return BlofyUi.sidebarItem(context, icon, label, selected); }
    public static Drawable panel(Context context, int color, int radiusDp, int strokeColor) { return BlofyUi.panel(context, color, radiusDp, strokeColor); }
    public static Drawable gradientPanel(Context context, int start, int end, int radiusDp, int strokeColor) { return BlofyUi.gradientPanel(context, start, end, radiusDp, strokeColor); }
    public static Drawable focusDrawable(Context context, int normal, int focused, int focusStroke) { return BlofyUi.focusDrawable(context, normal, focused, focusStroke); }
    public static Drawable screenGradient() { return BlofyUi.screenGradient(); }
    public static Drawable heroScrim() { return BlofyUi.heroScrim(); }
    public static void attachScaleFocus(android.view.View view, float scale) { BlofyUi.attachScaleFocus(view, scale); }
    public static ColorStateList progressColors() { return BlofyUi.progressColors(); }
}