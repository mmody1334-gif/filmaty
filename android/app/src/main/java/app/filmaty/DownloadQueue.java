package app.filmaty;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Filmaty download queue on top of Android's DownloadManager.
 *
 * The site can ask for many downloads at once, but we only hand a few
 * (default 1, adjustable in the downloads screen) to DownloadManager so
 * a single file gets the full bandwidth; when one finishes we enqueue
 * the next. Items persist in SharedPreferences so the queue survives
 * process death; live status always comes from DownloadManager itself.
 */
final class DownloadQueue {

    private static final String PREFS = "filmaty_downloads";
    private static final String KEY_ITEMS = "items";
    private static final String KEY_LIMIT = "limit";

    // Item states stored in prefs.
    static final String QUEUED = "queued";       // waiting for a free slot
    static final String ACTIVE = "active";       // handed to DownloadManager
    static final String DONE = "done";
    static final String FAILED = "failed";
    static final String CANCELLED = "cancelled";

    /** One row as the UI sees it. */
    static final class Row {
        String key;
        String name;
        String url;
        String ua;
        String mime;
        String referer;
        String state;
        long dmId = -1;
        long addedAt;
        int dmStatus;
        long downloaded;
        long total;
    }

    private DownloadQueue() {}

    // ------------------------------------------------------------ config

    static int getLimit(Context ctx) {
        return prefs(ctx).getInt(KEY_LIMIT, 1);
    }

    static void setLimit(Context ctx, int limit) {
        if (limit < 1) limit = 1;
        if (limit > 4) limit = 4;
        prefs(ctx).edit().putInt(KEY_LIMIT, limit).apply();
        pump(ctx); // a higher limit frees slots immediately
    }

    // ------------------------------------------------------------- ops

    /** Add a media download to the queue and start it if a slot is free. */
    static synchronized void enqueue(Context ctx, String name, String url, String ua,
                                     String mime, String referer) {
        JSONArray arr = read(ctx);
        JSONObject o = new JSONObject();
        try {
            o.put("key", "dl" + System.currentTimeMillis() + "_" + arr.length());
            o.put("name", name);
            o.put("url", url);
            o.put("ua", ua == null ? "" : ua);
            o.put("mime", mime == null ? "" : mime);
            o.put("referer", referer == null ? "" : referer);
            o.put("state", QUEUED);
            o.put("dmId", -1L);
            o.put("addedAt", System.currentTimeMillis());
            arr.put(o);
            write(ctx, arr);
        } catch (JSONException ignored) {
        }
        pump(ctx);
    }

    static synchronized void cancel(Context ctx, String key) {
        JSONArray arr = read(ctx);
        boolean changed = false;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null || !key.equals(o.optString("key"))) continue;
            long dmId = o.optLong("dmId", -1);
            if (dmId != -1) {
                try {
                    dm(ctx).remove(dmId);
                } catch (Exception ignored) {
                }
            }
            put(o, "state", CANCELLED);
            changed = true;
        }
        if (changed) write(ctx, arr);
        pump(ctx);
    }

    static synchronized void retry(Context ctx, String key) {
        JSONArray arr = read(ctx);
        boolean changed = false;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null || !key.equals(o.optString("key"))) continue;
            put(o, "state", QUEUED);
            put(o, "dmId", -1L);
            changed = true;
        }
        if (changed) write(ctx, arr);
        pump(ctx);
    }

    static synchronized void remove(Context ctx, String key) {
        JSONArray arr = read(ctx);
        JSONArray out = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            if (key.equals(o.optString("key"))) continue;
            out.put(o);
        }
        write(ctx, out);
    }

    static synchronized void clearFinished(Context ctx) {
        JSONArray arr = read(ctx);
        JSONArray out = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            String st = o.optString("state");
            if (DONE.equals(st) || FAILED.equals(st) || CANCELLED.equals(st)) continue;
            out.put(o);
        }
        write(ctx, out);
    }

    /** DownloadManager fired ACTION_DOWNLOAD_COMPLETE: free the slot. */
    static void onSystemComplete(Context ctx) {
        pump(ctx);
    }

    /** Number of downloads currently running (for the floating badge). */
    static synchronized int runningCount(Context ctx) {
        sync(ctx);
        JSONArray arr = read(ctx);
        int n = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && ACTIVE.equals(o.optString("state"))) n++;
        }
        return n;
    }

    /** Number of downloads still waiting for a slot. */
    static synchronized int queuedCount(Context ctx) {
        JSONArray arr = read(ctx);
        int n = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && QUEUED.equals(o.optString("state"))) n++;
        }
        return n;
    }

    /** Newest-first snapshot of the queue for the downloads screen. */
    static synchronized List<Row> rows(Context ctx) {
        sync(ctx);
        JSONArray arr = read(ctx);
        List<Row> out = new ArrayList<>();
        DownloadManager dm = dm(ctx);
        for (int i = arr.length() - 1; i >= 0; i--) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            Row r = new Row();
            r.key = o.optString("key");
            r.name = o.optString("name");
            r.url = o.optString("url");
            r.ua = o.optString("ua");
            r.mime = o.optString("mime");
            r.referer = o.optString("referer");
            r.state = o.optString("state");
            r.dmId = o.optLong("dmId", -1);
            r.addedAt = o.optLong("addedAt");
            if (r.dmId != -1 && ACTIVE.equals(r.state) && dm != null) {
                Cursor c = null;
                try {
                    c = dm.query(new DownloadManager.Query().setFilterById(r.dmId));
                    if (c != null && c.moveToFirst()) {
                        r.dmStatus = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        r.downloaded = c.getLong(c.getColumnIndexOrThrow(
                                DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        r.total = c.getLong(c.getColumnIndexOrThrow(
                                DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    }
                } catch (Exception ignored) {
                } finally {
                    if (c != null) c.close();
                }
            }
            out.add(r);
        }
        return out;
    }

    static Uri uriFor(Context ctx, long dmId) {
        try {
            return dm(ctx).getUriForDownloadedFile(dmId);
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------------------------------------------------- internals

    /** Start queued items while there is a free slot. */
    static synchronized void pump(Context ctx) {
        sync(ctx);
        JSONArray arr = read(ctx);
        int limit = getLimit(ctx);
        int active = 0;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && ACTIVE.equals(o.optString("state"))) active++;
        }
        boolean changed = false;
        for (int i = 0; i < arr.length() && active < limit; i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null || !QUEUED.equals(o.optString("state"))) continue;
            long id = enqueueInDm(ctx, o);
            if (id != -1) {
                put(o, "dmId", id);
                put(o, "state", ACTIVE);
                active++;
            } else {
                put(o, "state", FAILED);
            }
            changed = true;
        }
        if (changed) write(ctx, arr);
    }

    /** Reconcile stored "active" items with DownloadManager's truth. */
    private static void sync(Context ctx) {
        JSONArray arr = read(ctx);
        boolean changed = false;
        DownloadManager dm = dm(ctx);
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null || !ACTIVE.equals(o.optString("state"))) continue;
            long dmId = o.optLong("dmId", -1);
            if (dmId == -1 || dm == null) {
                put(o, "state", CANCELLED);
                changed = true;
                continue;
            }
            Cursor c = null;
            try {
                c = dm.query(new DownloadManager.Query().setFilterById(dmId));
                if (c == null || !c.moveToFirst()) {
                    // Removed from the system downloads UI.
                    put(o, "state", CANCELLED);
                    changed = true;
                } else {
                    int st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    if (st == DownloadManager.STATUS_SUCCESSFUL) {
                        put(o, "state", DONE);
                        changed = true;
                    } else if (st == DownloadManager.STATUS_FAILED) {
                        put(o, "state", FAILED);
                        changed = true;
                    }
                }
            } catch (Exception e) {
                put(o, "state", FAILED);
                changed = true;
            } finally {
                if (c != null) c.close();
            }
        }
        if (changed) write(ctx, arr);
    }

    private static long enqueueInDm(Context ctx, JSONObject o) {
        try {
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(o.optString("url")));
            String name = o.optString("name");
            String mime = o.optString("mime");
            String ua = o.optString("ua");
            String referer = o.optString("referer");
            r.setTitle(name);
            r.setDescription("فيلماتي");
            if (!mime.isEmpty()) r.setMimeType(mime);
            if (!ua.isEmpty()) r.addRequestHeader("User-Agent", ua);
            String cookies = CookieManager.getInstance().getCookie(o.optString("url"));
            if (cookies != null) r.addRequestHeader("Cookie", cookies);
            if (!referer.isEmpty()) r.addRequestHeader("Referer", referer);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            return dm(ctx).enqueue(r);
        } catch (Exception e) {
            return -1;
        }
    }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static DownloadManager dm(Context ctx) {
        try {
            return (DownloadManager) ctx.getApplicationContext().getSystemService(Context.DOWNLOAD_SERVICE);
        } catch (Exception e) {
            return null;
        }
    }

    private static JSONArray read(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_ITEMS, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void write(Context ctx, JSONArray arr) {
        prefs(ctx).edit().putString(KEY_ITEMS, arr.toString()).apply();
    }

    private static void put(JSONObject o, String key, Object value) {
        try {
            o.put(key, value);
        } catch (JSONException ignored) {
        }
    }
}
