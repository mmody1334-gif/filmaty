package app.filmaty;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;
import java.util.Locale;

/**
 * "تحميلاتي" — the downloads screen. Lists everything DownloadQueue
 * knows about, newest first, with live progress from DownloadManager.
 * The concurrency limit (how many files download at the same time,
 * default 1 so one file gets the full speed) is adjustable here.
 */
public class DownloadsActivity extends Activity {

    private LinearLayout list;
    private TextView empty;
    private LinearLayout limitRow;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            refresh();
            handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout rootLayout = new LinearLayout(this);
        rootLayout.setOrientation(LinearLayout.VERTICAL);
        rootLayout.setBackgroundColor(Color.parseColor("#0c0a08"));
        int pad = dp(16);
        rootLayout.setPadding(pad, pad, pad, pad);
        setContentView(rootLayout);

        TextView title = new TextView(this);
        title.setText("⬇️ تحميلاتي");
        title.setTextColor(Color.WHITE);
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        rootLayout.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // Concurrency selector: how many files download at the same time.
        LinearLayout limitBox = new LinearLayout(this);
        limitBox.setOrientation(LinearLayout.HORIZONTAL);
        limitBox.setGravity(Gravity.CENTER_VERTICAL);
        limitBox.setPadding(0, dp(10), 0, dp(4));
        TextView limitLabel = new TextView(this);
        limitLabel.setText("تحميلات في نفس الوقت:");
        limitLabel.setTextColor(Color.parseColor("#a99f8e"));
        limitLabel.setTextSize(13);
        limitBox.addView(limitLabel, new LinearLayout.LayoutParams(
                0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        limitRow = new LinearLayout(this);
        limitRow.setOrientation(LinearLayout.HORIZONTAL);
        limitBox.addView(limitRow, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        rootLayout.addView(limitBox, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        renderLimitButtons();

        ScrollView scroll = new ScrollView(this);
        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(list, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        rootLayout.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        empty = new TextView(this);
        empty.setText("لسه مفيش تحميلات.\nابدأ تحميل أي فيلم أو حلقة من الموقع وهتلاقيها هنا.");
        empty.setTextColor(Color.parseColor("#a99f8e"));
        empty.setTextSize(14);
        empty.setGravity(Gravity.CENTER);
        empty.setPadding(0, dp(48), 0, 0);
        rootLayout.addView(empty, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
        handler.postDelayed(tick, 1000);
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(tick);
    }

    // ------------------------------------------------------------- UI

    private void renderLimitButtons() {
        limitRow.removeAllViews();
        int current = DownloadQueue.getLimit(this);
        for (int n = 1; n <= 4; n++) {
            final int value = n;
            Button b = smallButton(String.valueOf(n),
                    n == current ? "#f0a32b" : "#1f1a14");
            b.setOnClickListener(v -> {
                DownloadQueue.setLimit(this, value);
                renderLimitButtons();
                refresh();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(44), dp(40));
            lp.setMargins(dp(4), 0, 0, 0);
            limitRow.addView(b, lp);
        }
    }

    private void refresh() {
        List<DownloadQueue.Row> rows = DownloadQueue.rows(this);
        list.removeAllViews();
        empty.setVisibility(rows.isEmpty() ? View.VISIBLE : View.GONE);
        for (DownloadQueue.Row row : rows) {
            list.addView(rowView(row), new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
    }

    private View rowView(final DownloadQueue.Row row) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(12), dp(10), dp(12), dp(10));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#15110d"));
        bg.setCornerRadius(dp(10));
        box.setBackground(bg);
        LinearLayout.LayoutParams boxLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        boxLp.setMargins(0, 0, 0, dp(10));
        box.setLayoutParams(boxLp);

        TextView name = new TextView(this);
        name.setText(row.name);
        name.setTextColor(Color.WHITE);
        name.setTextSize(14);
        name.setMaxLines(1);
        name.setEllipsize(android.text.TextUtils.TruncateAt.MIDDLE);
        box.addView(name);

        TextView status = new TextView(this);
        status.setText(statusText(row));
        status.setTextColor(Color.parseColor("#a99f8e"));
        status.setTextSize(12);
        status.setPadding(0, dp(4), 0, 0);
        box.addView(status);

        if (DownloadQueue.ACTIVE.equals(row.state)) {
            ProgressBar bar = new ProgressBar(this, null,
                    android.R.attr.progressBarStyleHorizontal);
            bar.setMax(100);
            if (row.total > 0) {
                bar.setIndeterminate(false);
                bar.setProgress((int) (row.downloaded * 100 / row.total));
            } else {
                bar.setIndeterminate(true);
            }
            LinearLayout.LayoutParams barLp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            barLp.setMargins(0, dp(6), 0, 0);
            box.addView(bar, barLp);
        }

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setPadding(0, dp(8), 0, 0);
        box.addView(buttons);

        if (DownloadQueue.ACTIVE.equals(row.state) || DownloadQueue.QUEUED.equals(row.state)) {
            Button cancel = smallButton("إلغاء", "#1f1a14");
            cancel.setOnClickListener(v -> {
                DownloadQueue.cancel(this, row.key);
                refresh();
            });
            buttons.addView(cancel);
        }
        if (DownloadQueue.FAILED.equals(row.state) || DownloadQueue.CANCELLED.equals(row.state)) {
            Button retry = smallButton("إعادة", "#f0a32b");
            retry.setOnClickListener(v -> {
                DownloadQueue.retry(this, row.key);
                refresh();
            });
            buttons.addView(retry);
        }
        if (DownloadQueue.DONE.equals(row.state)) {
            Button open = smallButton("فتح", "#f0a32b");
            open.setOnClickListener(v -> openFile(row));
            buttons.addView(open);
        }
        if (!DownloadQueue.ACTIVE.equals(row.state) && !DownloadQueue.QUEUED.equals(row.state)) {
            Button del = smallButton("مسح من القائمة", "#1f1a14");
            del.setOnClickListener(v -> {
                DownloadQueue.remove(this, row.key);
                refresh();
            });
            buttons.addView(del);
        }
        return box;
    }

    private String statusText(DownloadQueue.Row row) {
        switch (row.state) {
            case DownloadQueue.QUEUED:
                return "في الطابور — هيشتغل لما اللي قبله يخلص";
            case DownloadQueue.DONE:
                return "اكتمل ✅";
            case DownloadQueue.FAILED:
                return "فشل ❌ — جرب إعادة";
            case DownloadQueue.CANCELLED:
                return "اتلغى";
            default:
                break;
        }
        if (row.total > 0) {
            long pct = row.downloaded * 100 / row.total;
            return String.format(Locale.US, "جاري التحميل… %d%% (%.0f / %.0f ميجا)",
                    pct, mb(row.downloaded), mb(row.total));
        }
        return String.format(Locale.US, "جاري التحميل… %.0f ميجا", mb(row.downloaded));
    }

    private void openFile(DownloadQueue.Row row) {
        Uri uri = DownloadQueue.uriFor(this, row.dmId);
        if (uri == null) {
            Toast.makeText(this, "الملف مش متاح", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW);
        String mime = (row.mime == null || row.mime.isEmpty()) ? "video/*" : row.mime;
        i.setDataAndType(uri, mime);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "مفيش تطبيق يفتح نوع الملف ده", Toast.LENGTH_SHORT).show();
        }
    }

    private Button smallButton(String text, String color) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextColor(Color.WHITE);
        b.setTextSize(12);
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setPadding(dp(12), 0, dp(12), 0);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor(color));
        bg.setCornerRadius(dp(8));
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(36));
        lp.setMargins(0, 0, dp(8), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private double mb(long bytes) {
        return bytes / 1048576.0;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }
}
