/*
 * game-driver.js — neutral offline replacement for the Poki SDK (poki-sdk.js v2).
 * Used by the offline Defold builds of "Level Devil" (Denda Games / Unept) and
 * "Monkey Mart" (TinyDobbins).
 *
 * Implements the exact API surface both games call (index.html boot code +
 * Emscripten glue):
 *   init, setDebug, gameLoadingStart, gameLoadingProgress, gameLoadingFinished,
 *   gameplayStart, gameplayStop, commercialBreak, rewardedBreak, happyTime,
 *   customEvent, displayAd, destroyAd, captureError, measure, movePill,
 *   getURLParam, shareableURL
 *
 * Offline behaviour:
 *   - The real SDK script notifies the page by calling window.poki_sdk_loaded();
 *     Defold's boot code waits inside that callback before PokiSDK.init() and
 *     Module.runApp(). This driver schedules the call so the game boots.
 *   - init() resolves {loaded:true, adBlock:false} immediately.
 *   - commercialBreak() resolves immediately — a pending promise would freeze
 *     the game at the next interstitial.
 *   - rewardedBreak() resolves true immediately (reward auto-granted).
 *   - displayAd/destroyAd hide their container (no banner server offline).
 *   - getURLParam returns null, shareableURL resolves null (no share backend).
 *   - window.GameAnalytics is stubbed with a catch-all no-op (Monkey Mart's
 *     glue calls it directly; the real SDK is removed from the build).
 */
(function () {
  'use strict';
  if (window.PokiSDK && window.PokiSDK.__offlineDriver) return;

  var log = function () {
    try { console.info.apply(console, ['[GameDriver]'].concat([].slice.call(arguments))); } catch (e) {}
  };

  var driver = {
    __offlineDriver: true,

    init: function () {
      log('init (offline) -> {loaded:true, adBlock:false}');
      return Promise.resolve({ loaded: true, adBlock: false });
    },

    setDebug: function (value) {
      log('setDebug', value, '(ignored, offline)');
    },

    gameLoadingStart: function () { log('gameLoadingStart'); },
    gameLoadingProgress: function () { /* no-op offline */ },
    gameLoadingFinished: function () { log('gameLoadingFinished'); },

    gameplayStart: function () { /* analytics: no-op offline */ },
    gameplayStop: function () { /* analytics: no-op offline */ },

    // Interstitial: resolve immediately so the game never stalls.
    commercialBreak: function () {
      log('commercialBreak (skipped, offline)');
      return Promise.resolve();
    },

    // Rewarded: no ad to watch offline — grant the reward right away.
    rewardedBreak: function () {
      log('rewardedBreak (auto-granted, offline)');
      return Promise.resolve(true);
    },

    happyTime: function () { /* analytics: no-op */ },
    customEvent: function () { /* analytics: no-op */ },

    captureError: function (err) {
      log('captureError', err && (err.message || err));
    },
    measure: function () { /* analytics: no-op */ },
    movePill: function () { /* UI hint for the poki pill: no-op offline */ },

    getURLParam: function (key) {
      // Must return a STRING: the Emscripten glue runs UTF8ToString() on the
      // result, and null would throw (null.length).
      log('getURLParam', key, '-> "" (offline)');
      return '';
    },
    shareableURL: function () {
      return Promise.resolve('');
    },

    // Banner ads: nothing to display offline.
    displayAd: function (container, size) {
      log('displayAd (skipped, offline)', size);
      if (container && container.style) container.style.display = 'none';
    },
    destroyAd: function (container) {
      if (container && container.style) container.style.display = 'none';
    },

    isAdBlocked: function () { return false; },
    // Poki SDK v2 internal surface some platform glue uses (e.g. adTimings).
    // Offline: no ads are ever scheduled, so requestPossible() is always false.
    SDK: {
      adTimings: {
        timings: { startAdsAfter: 600000, timeBetweenAds: 600000 },
        requestPossible: function () { return false; }
      }
    }
  };

  window.PokiSDK = driver;

  // Analytics bridge (Monkey Mart): the Emscripten glue dereferences
  // gameanalytics.GameAnalytics.<method> (the GameAnalytics web SDK layout).
  // Stub covers every method; the three reads Lua checks return the same
  // values as the real SDK with no remote configs.
  if (typeof window.GameAnalytics === 'undefined') {
    var gaFixed = {
      isRemoteConfigsReady: function () { return false; },
      getRemoteConfigsContentAsString: function () { return '{}'; },
      getRemoteConfigsValueAsString: function () { return null; }
    };
    var gaStub = new Proxy({}, {
      get: function (target, prop) {
        if (prop in gaFixed) return gaFixed[prop];
        return function () { /* analytics: no-op offline */ };
      }
    });
    window.GameAnalytics = gaStub;
    window.gameanalytics = { GameAnalytics: gaStub };
  }

  // Some Poki wrapper glues call a host-page callback the real wrapper never
  // defines either; give it a safe no-op so boot doesn't throw.
  if (typeof window.continueToGame !== 'function') {
    window.continueToGame = function () { /* offline: nothing to wait for */ };
  }

  // Application firewall (Defold engine issues its HTTP via fetch/XHR):
  // any request that would leave localhost is answered locally with an empty
  // JSON 200 instead of touching the network. Keeps stray calls (e.g. Monkey
  // Mart's IAP store lookup at leveldata.poki.io) fully offline and harmless.
  function isLocalUrl(url) {
    try {
      var u = new URL(url, window.location.href);
      return u.protocol === 'about:' || u.protocol === 'blob:' ||
             u.protocol === 'data:' ||
             u.hostname === 'localhost' || u.hostname === '127.0.0.1' ||
             u.hostname.endsWith('.localhost');
    } catch (e) { return true; }
  }
  var _fetch = window.fetch && window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = (input && input.url) ? input.url : String(input);
    if (_fetch && isLocalUrl(url)) return _fetch(input, init);
    log('fetch (firewalled, local empty answer)', url);
    return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
  var _xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (!isLocalUrl(String(url))) {
      this.__blockedExternal = String(url);
    }
    return _xhrOpen.apply(this, arguments);
  };
  var _xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__blockedExternal) {
      // Never leaves the machine: fake a small JSON 200 response locally.
      var xhr = this;
      log('xhr (firewalled, local empty answer)', xhr.__blockedExternal);
      var body = '{}';
      try {
        Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
        Object.defineProperty(xhr, 'statusText', { value: 'OK', configurable: true });
        Object.defineProperty(xhr, 'responseText', { value: body, configurable: true });
        Object.defineProperty(xhr, 'response', { value: body, configurable: true });
        Object.defineProperty(xhr, 'responseURL', { value: '', configurable: true });
      } catch (e) { /* older engines: ignore */ }
      setTimeout(function () {
        try {
          if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
          if (typeof xhr.onload === 'function') xhr.onload();
          if (typeof xhr.onloadend === 'function') xhr.onloadend();
        } catch (e) {}
      }, 0);
      return;
    }
    return _xhrSend.apply(this, arguments);
  };

  // sendBeacon bypasses fetch/XHR (Monkey Mart's IAP store ping uses it).
  var _sendBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = function (url, data) {
    if (isLocalUrl(String(url)) && _sendBeacon) return _sendBeacon(url, data);
    log('sendBeacon (firewalled, dropped)', url);
    return true; // pretend queued — nothing is transmitted
  };

  // The real poki-sdk.js signals readiness by calling page-defined
  // poki_sdk_loaded(). Poll instead of a one-shot timer: the inline script
  // that defines the gate may be parsed after this driver runs.
  window.__driverLoaded = true;
  var gateTimer = setInterval(function () {
    if (typeof window.poki_sdk_loaded === 'function') {
      clearInterval(gateTimer);
      window.__pokiGateDone = true;
      log('calling poki_sdk_loaded() (offline boot gate)');
      window.poki_sdk_loaded();
    }
  }, 100);
  setTimeout(function () {
    if (!window.__pokiGateDone) log('boot gate still missing after 20s');
  }, 20000);
})();
