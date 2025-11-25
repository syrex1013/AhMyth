const { remote } = require('electron');
const { ipcRenderer } = require('electron');
var app = angular.module('myappy', []);

var victim = remote.getCurrentWebContents().victim;

// Country code to emoji flag mapping
const countryCodeToEmoji = (countryCode) => {
    if (!countryCode) return '🌐'; // Globe for unknown location
    const cc = countryCode.toUpperCase();
    // Validate country code (must be 2 uppercase letters)
    if (!/^[A-Z]{2}$/.test(cc)) return '🌐';
    const chars = [...cc].map(c => String.fromCodePoint(0x1F1A5 + c.charCodeAt(0)));
    return chars.join('');
};

app.controller("NotifiCtrl", function($scope, $sce) {
    $NotifiCtrl = $scope;

    $NotifiCtrl.victimSocket = victim.ip + ":" + victim.port;
    $NotifiCtrl.victimModel = victim.manf + " " + victim.model;
    $NotifiCtrl.victimCountry = victim.country;
    
    // Get country flag emoji with fallback
    $NotifiCtrl.getCountryEmoji = (countryCode) => {
        const emoji = countryCodeToEmoji(countryCode);
        const title = countryCode ? countryCode.toUpperCase() : 'Unknown';
        return $sce.trustAsHtml(`<span title="${title}">${emoji}</span>`);
    };
});
