const { remote } = require('electron');
const { ipcRenderer } = require('electron');
var app = angular.module('myappy', []);

var victim = remote.getCurrentWebContents().victim;

// Country code to flag image (using flagcdn.com for reliable rendering)
const countryCodeToFlag = (countryCode) => {
    if (!countryCode) return { type: 'icon', value: 'globe', title: 'Unknown' };
    const cc = countryCode.toLowerCase();
    if (cc === 'local') return { type: 'icon', value: 'home', title: 'Local Network' };
    if (cc === 'lan') return { type: 'icon', value: 'linkify', title: 'LAN' };
    if (!/^[a-z]{2}$/i.test(cc)) return { type: 'icon', value: 'globe', title: 'Unknown' };
    return { 
        type: 'flag', 
        value: `https://flagcdn.com/32x24/${cc}.png`,
        title: cc.toUpperCase()
    };
};

app.controller("NotifiCtrl", function($scope, $sce) {
    $NotifiCtrl = $scope;

    $NotifiCtrl.victimSocket = victim.ip + ":" + victim.port;
    $NotifiCtrl.victimModel = victim.manf + " " + victim.model;
    $NotifiCtrl.victimCountry = victim.country;
    
    // Get country flag with image (works on Windows)
    $NotifiCtrl.getCountryEmoji = (countryCode) => {
        const flag = countryCodeToFlag(countryCode);
        if (flag.type === 'icon') {
            return $sce.trustAsHtml(`<i class="${flag.value} icon" title="${flag.title}"></i>`);
        } else {
            return $sce.trustAsHtml(`<img src="${flag.value}" alt="${flag.title}" title="${flag.title}" style="width:32px;height:24px;vertical-align:middle;border-radius:3px;box-shadow:0 2px 4px rgba(0,0,0,0.3);">`);
        }
    };
});
