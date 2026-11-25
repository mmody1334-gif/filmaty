package app.filmaty;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.app.PictureInPictureParams;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.util.Rational;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Filmaty Android app: the website in a WebView, plus what a browser tab
 * cannot do — real fullscreen that rotates to landscape, popup/redirect
 * and ad-host blocking (so embed players run ad-free), proper back
 * navigation, and downloads through Android's DownloadManager.
 */
public class MainActivity extends Activity {

    static final String HOME = "https://filmaty.hudhaifa-bio.workers.dev/";
    static final String APP_HOST = "filmaty.hudhaifa-bio.workers.dev";

    // Ad / popup networks commonly injected by free embed players.
    static final Set<String> AD_HOSTS = new HashSet<>(Arrays.asList(
            "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
            "google-analytics.com", "googletagmanager.com", "popads.net", "popcash.net",
            "propellerads.com", "propellerclick.com", "adsterra.com", "adsterratools.com",
            "exoclick.com", "exosrv.com", "juicyads.com", "trafficjunky.net", "hilltopads.net",
            "a-ads.com", "adcash.com", "admaven.com", "ad-maven.com", "clickadu.com", "onclickads.net",
            "onclkds.com", "richpush.co", "pushame.com", "mgid.com", "outbrain.com", "taboola.com",
            "revcontent.com", "zeropark.com", "monetag.com", "ophoacit.com", "acscdn.com",
            "highperformanceformat.com", "profitableratecpm.com", "effectivegatecpm.com",
            "realsrv.com", "tsyndicate.com", "dtscout.com", "histats.com", "yandex.ru",
            "mc.yandex.ru", "adskeeper.co.uk", "bidvertiser.com", "popmyads.com",
            "whos.amung.us", "cloudfront-ads.net", "ads.mobidea.com"));

    private WebView web;
    private FrameLayout root;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private long lastBackPress = 0;
    private TextView downloadsFab;

    private final Handler badgeHandler = new Handler(Looper.getMainLooper());
    private final Runnable badgeTick = new Runnable() {
        @Override
        public void run() {
            updateDownloadsBadge();
            badgeHandler.postDelayed(this, 2000);
        }
    };

    private final BroadcastReceiver downloadCompleteReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            DownloadQueue.onSystemComplete(context);
            updateDownloadsBadge();
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0c0a08"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0c0a08"));
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Floating shortcut to the downloads screen (badge = running + queued).
        downloadsFab = new TextView(this);
        downloadsFab.setText("⬇️");
        downloadsFab.setTextSize(14);
        downloadsFab.setGravity(Gravity.CENTER);
        GradientDrawable fabBg = new GradientDrawable();
        fabBg.setColor(Color.parseColor("#f0a32b"));
        fabBg.setCornerRadii(new float[]{0,0,dp(16),dp(16),dp(16),dp(16),0,0});
        fabBg.setAlpha(215);
        downloadsFab.setAlpha(0.92f);
        downloadsFab.setBackground(fabBg);
        downloadsFab.setOnClickListener(v ->
                startActivity(new Intent(this, DownloadsActivity.class)));
        FrameLayout.LayoutParams fabLp = new FrameLayout.LayoutParams(dp(30), dp(64));
        fabLp.gravity = Gravity.CENTER_VERTICAL | Gravity.START;
        fabLp.setMargins(0, dp(60), 0, 0);
        root.addView(downloadsFab, fabLp);

        IntentFilter dlFilter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(downloadCompleteReceiver, dlFilter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(downloadCompleteReceiver, dlFilter);
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(true); // onCreateWindow below refuses every popup
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setUserAgentString(s.getUserAgentString() + " FilmatyApp/" + versionName());

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, length) ->
                download(url, userAgent, contentDisposition, mimeType));

        String start = HOME;
        Intent intent = getIntent();
        if (intent != null && intent.getData() != null && APP_HOST.equals(intent.getData().getHost())) {
            start = intent.getData().toString();
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(start);

        checkForAppUpdate();
    }

    @SuppressWarnings("deprecation")
    private long localVersionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) return info.getLongVersionCode();
            return info.versionCode;
        } catch (Exception e) {
            return 1L;
        }
    }

    private void checkForAppUpdate() {
        final long currentCode = localVersionCode();
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL u = new URL("https://api.github.com/repos/mmody1334-gif/filmaty/releases/latest");
                conn = (HttpURLConnection) u.openConnection();
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                conn.setRequestProperty("Accept", "application/vnd.github+json");
                conn.setRequestProperty("User-Agent", "FilmatyApp/" + versionName());
                if (conn.getResponseCode() != 200) return;
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                    String line;
                    while ((line = br.readLine()) != null) sb.append(line);
                }
                Matcher m = Pattern.compile("\"tag_name\"\\s*:\\s*\"apk-v1\\.(\\d+)\"").matcher(sb.toString());
                if (!m.find()) return;
                final long remoteCode = Long.parseLong(m.group(1));
                if (remoteCode <= currentCode) return;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    new AlertDialog.Builder(this)
                            .setTitle("تحديث جديد متاح")
                            .setMessage("يتوفر إصدار أحدث من تطبيق فيلماتي (1." + remoteCode + "). هل تريد تحميله الآن؟")
                            .setPositiveButton("تحديث الآن", (d, w) -> download(
                                    "https://github.com/mmody1334-gif/filmaty/releases/latest/download/filmaty.apk",
                                    web != null ? web.getSettings().getUserAgentString() : "FilmatyApp",
                                    "attachment; filename=\"filmaty.apk\"",
                                    "application/vnd.android.package-archive"))
                            .setNegativeButton("لاحقاً", null)
                            .show();
                });
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent.getData() != null && APP_HOST.equals(intent.getData().getHost())) {
            web.loadUrl(intent.getData().toString());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateDownloadsBadge();
        badgeHandler.postDelayed(badgeTick, 2000);
    }

    @Override
    protected void onPause() {
        super.onPause();
        badgeHandler.removeCallbacks(badgeTick);
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(downloadCompleteReceiver);
        } catch (Exception ignored) {
        }
        badgeHandler.removeCallbacks(badgeTick);
        super.onDestroy();
    }

    // ---------------------------------------------------------------- back

    @Override
    public void onBackPressed() {
        if (customView != null) {
            exitFullscreen();
            return;
        }
        if (web != null) {
            web.evaluateJavascript("window.__filmatyHandleBack ? window.__filmatyHandleBack() : false", value -> {
                if ("true".equals(value)) return;
                handleDefaultBack();
            });
            return;
        }
        handleDefaultBack();
    }

    private void handleDefaultBack() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPress < 2000) {
            super.onBackPressed();
        } else {
            lastBackPress = now;
            Toast.makeText(this, "اضغط رجوع مرة تانية للخروج", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= 26 && customView != null) {
            try {
                enterPictureInPictureMode(
                        new PictureInPictureParams.Builder()
                                .setAspectRatio(new Rational(16, 9))
                                .build());
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (!isInPictureInPictureMode && customView != null) {
            hideSystemBars(true);
        }
    }

    // ---------------------------------------------------------- fullscreen

    private void enterFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        if (customView != null) {
            callback.onCustomViewHidden();
            return;
        }
        customView = view;
        customViewCallback = callback;
        root.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setVisibility(View.GONE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars(true);
    }

    private void exitFullscreen() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        web.setVisibility(View.VISIBLE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars(false);
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars(boolean hide) {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c == null) return;
            if (hide) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                c.show(WindowInsets.Type.systemBars());
            }
        } else {
            w.getDecorView().setSystemUiVisibility(hide
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                      | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                      | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    : View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && customView != null) hideSystemBars(true);
    }

    // ------------------------------------------------------------ download

    // Media downloads go through DownloadQueue: one at a time by default
    // (adjustable in the downloads screen), the rest wait in line.
    private void download(String url, String ua, String disposition, String mime) {
        if (url == null || !url.startsWith("http")) return;
        if (url.endsWith(".apk") || url.contains("github.com")) {
            // The app-update APK skips the queue.
            downloadNow(url, ua, disposition, mime);
            return;
        }
        String name = URLUtil.guessFileName(url, disposition, mime);
        DownloadQueue.enqueue(this, name, url, ua, mime, HOME);
        updateDownloadsBadge();
        Toast.makeText(this, "⬇️ اتضاف لقائمة التحميل: " + name, Toast.LENGTH_SHORT).show();
    }

    private void downloadNow(String url, String ua, String disposition, String mime) {
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            String name = URLUtil.guessFileName(url, disposition, mime);
            r.setTitle(name);
            r.setDescription("فيلماتي");
            r.setMimeType(mime);
            r.addRequestHeader("User-Agent", ua);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) r.addRequestHeader("Cookie", cookies);
            if (APP_HOST.equals(Uri.parse(url).getHost())) r.addRequestHeader("Referer", HOME);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "⬇️ بدأ التحميل: " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            openExternal(Uri.parse(url));
        }
    }

    private void updateDownloadsBadge() {
        if (downloadsFab == null) return;
        int n = DownloadQueue.runningCount(this) + DownloadQueue.queuedCount(this);
        downloadsFab.setText(n > 0 ? "⬇️\n" + n : "⬇️");
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    // -------------------------------------------------------------- client

    static boolean isAdHost(String host) {
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        for (String ad : AD_HOSTS) {
            if (host.equals(ad) || host.endsWith("." + ad)) return true;
        }
        return false;
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            if (!req.isForMainFrame()) return false;
            Uri u = req.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if (APP_HOST.equals(u.getHost())) return false;
            if (scheme.equals("intent") || scheme.equals("market")) return true; // ad redirects
            if (isAdHost(u.getHost())) return true;
            // Anything else leaving the site: only on a real tap, and in the
            // phone's browser (Telegram, GitHub, ...). Script-driven
            // redirects (the classic ad hijack) are dropped.
            if (req.hasGesture() && (scheme.equals("https") || scheme.equals("http") || scheme.equals("tg"))) {
                openExternal(u);
            }
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            if (isAdHost(req.getUrl().getHost())) {
                return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
            }
            return null;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            String html = "<html dir='rtl'><body style='background:#0c0a08;color:#eee;font-family:sans-serif;"
                    + "display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;text-align:center'>"
                    + "<div style='font-size:48px'>📡</div><h2>مفيش اتصال بالإنترنت</h2>"
                    + "<p style='color:#aaa'>اتأكد من النت وجرب تاني</p>"
                    + "<button onclick=\"location.href='" + HOME + "'\" style='background:#f0a32b;color:#fff;border:0;"
                    + "border-radius:8px;padding:12px 28px;font-size:16px;font-weight:bold'>إعادة المحاولة</button></body></html>";
            view.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", null);
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            enterFullscreen(view, callback);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            // Popups are the main ad vector of embed players: refuse all.
            return false;
        }

        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }
}
