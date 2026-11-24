/*
 * Zaisma's relay. Zaisma adds this first to every game page. A connection between two players'
 * browsers (WebRTC, what PeerJS and Godot use) would show each the other's internet address, so
 * every one goes through Cloudflare's relay (TURN) instead: players only ever see Cloudflare's
 * address, and connections also get through school and office networks where direct ones fail.
 * The game's own WebRTC code works unchanged: this wraps RTCPeerConnection so each connection uses
 * only the relay, with Zaisma's relay servers, whatever servers the game asks for (the game's own
 * relay stays when it's one of the game's listed servers). Plain JavaScript, no dependencies, MIT licensed.
 */
(function (window) {
  "use strict";
  var config = typeof __ZAISMA_RELAY__ === "object" && __ZAISMA_RELAY__ ? __ZAISMA_RELAY__ : {};
  var NAMES = ["RTCPeerConnection", "webkitRTCPeerConnection"];
  var ownRelayHosts = (config.ownRelayHosts || []).map(function (host) { return String(host).toLowerCase(); });
  /** Ask again this long after the relay couldn't be had, not on every connection. */
  var RETRY_AFTER_MS = 60 * 1000;
  /** Credentials with less left than this are fetched anew. */
  var RENEW_BEFORE_MS = 10 * 60 * 1000;
  var storageKey = "zaisma:relay:" + config.game;

  /** What this window wrapped: our getters (so nothing is wrapped twice), and each original's wrapper. */
  var getters = new WeakSet();
  var wrappers = new WeakMap();
  /** The configuration the game asked each connection for, and the relay servers it was given. */
  var askedConfigurations = new WeakMap();
  var givenServers = new WeakMap();

  // ---- Zaisma's relay servers for this tab ----

  var kept = null; // { iceServers, expiresAtMs }
  var fetching = null;
  var failedAtMs = 0;
  var hasWarned = false;

  function warn(message) {
    if (hasWarned) return;
    hasWarned = true;
    window.console.warn("Zaisma: connections between players go only through Zaisma's relay, so they don't connect right now. " + message);
  }

  function isFresh(credentials) {
    return Boolean(credentials && credentials.iceServers && credentials.expiresAtMs - Date.now() > RENEW_BEFORE_MS);
  }

  function storedCredentials() {
    try {
      var stored = JSON.parse(window.sessionStorage.getItem(storageKey) || "null");
      return isFresh(stored) ? stored : null;
    } catch (error) {
      return null; // storage off: fetch new ones
    }
  }

  /** The game page's key to player passes, which also gives relay credentials (the SDK asks for it the same way). */
  function roomKey() {
    return new Promise(function (resolve, reject) {
      if (!config.site || !config.rooms || window.parent === window) return reject(new Error("Connections between players work when the game is played on Zaisma."));
      var timerNumber = window.setTimeout(function () {
        window.removeEventListener("message", onMessage);
        reject(new Error("Zaisma couldn't check this browser. Reload the game to try again."));
      }, 30000);
      function onMessage(event) {
        if (event.origin !== config.site || event.source !== window.parent || !event.data || event.data.type !== "zaisma:room-key") return;
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timerNumber);
        if (typeof event.data.key === "string") resolve(event.data.key);
        else reject(new Error("Zaisma couldn't check this browser, or this game doesn't use online play. Reload the game to try again."));
      }
      window.addEventListener("message", onMessage);
      window.parent.postMessage({ type: "zaisma:room-key" }, config.site);
    });
  }

  /** A frame of the game's own (a srcdoc frame runs its own copy of this script) asks the game page's copy, which Zaisma's page answers. */
  var RELAY_KEY = typeof Symbol === "function" ? Symbol.for("zaisma.relayServers") : "__zaismaRelayServers";
  function parentRelayServers() {
    try {
      return window.parent !== window && typeof window.parent[RELAY_KEY] === "function" ? window.parent[RELAY_KEY] : null;
    } catch (error) {
      return null; // another site's frame
    }
  }

  /** Zaisma's relay servers, as iceServers: [] when there are none to be had (connections then don't connect, rather than go direct). */
  function relayServers() {
    var fromParent = parentRelayServers();
    if (fromParent) return fromParent();
    if (isFresh(kept)) return Promise.resolve(kept.iceServers);
    var stored = storedCredentials();
    if (stored) {
      kept = stored;
      return Promise.resolve(kept.iceServers);
    }
    if (Date.now() - failedAtMs < RETRY_AFTER_MS) return Promise.resolve([]);
    if (!fetching) {
      fetching = roomKey()
        .then(function (key) {
          // text/plain keeps this a simple request, so the browser needs no preflight.
          return window.fetch(config.rooms + "/v1/relay", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ gameSlug: config.game, roomKey: key }) });
        })
        .then(function (response) {
          return response.json().then(function (answer) {
            if (!response.ok || !answer || !Array.isArray(answer.iceServers)) throw new Error((answer && answer.error && answer.error.message) || "Zaisma's relay didn't answer.");
            return answer;
          });
        })
        .then(
          function (answer) {
            fetching = null;
            kept = { iceServers: answer.iceServers, expiresAtMs: Date.parse(answer.expiresAt) };
            try { window.sessionStorage.setItem(storageKey, JSON.stringify(kept)); } catch (error) { /* fine */ }
            return kept.iceServers;
          },
          function (error) {
            fetching = null;
            failedAtMs = Date.now();
            warn(error && error.message ? error.message : "");
            return [];
          },
        );
    }
    return fetching;
  }

  // ---- What each connection is given ----

  /** The game's own relay servers among its listed servers: turn: and turns: addresses on those hosts, nothing else. */
  function ownRelays(iceServers) {
    var out = [];
    (Array.isArray(iceServers) ? iceServers : []).forEach(function (server) {
      if (!server || typeof server !== "object") return;
      var urls = [].concat(server.urls !== undefined ? server.urls : server.url !== undefined ? server.url : []).filter(function (address) {
        var host = /^turns?:(\[[^\]]+\]|[^:?\/]+)/i.exec(String(address));
        return host !== null && ownRelayHosts.indexOf(host[1].toLowerCase()) !== -1;
      });
      if (urls.length) out.push({ urls: urls, username: server.username, credential: server.credential });
    });
    return out;
  }

  /** A configuration from base that only relays, through Zaisma's servers and the game's own relay. */
  function relayedConfiguration(base, asked, servers) {
    var out = {};
    for (var name in base) if (Object.prototype.hasOwnProperty.call(base, name)) out[name] = base[name];
    out.iceTransportPolicy = "relay";
    out.iceServers = servers.concat(ownRelays(asked.iceServers));
    // Gathering ahead of time waits until there are servers to gather from.
    if (!servers.length) out.iceCandidatePoolSize = 0;
    else if (asked.iceCandidatePoolSize !== undefined) out.iceCandidatePoolSize = asked.iceCandidatePoolSize;
    return out;
  }

  function define(target, name, method) {
    Object.defineProperty(target, name, { value: method, writable: true, configurable: true, enumerable: false });
  }

  /** The wrapper for one window's RTCPeerConnection, and its prototype's calls made to relay first. */
  function wrap(Native) {
    var proto = Native.prototype;
    var nativeSetConfiguration = proto.setConfiguration;
    var nativeGetConfiguration = proto.getConfiguration;

    function RTCPeerConnection(configuration) {
      if (!new.target) throw new TypeError("Failed to construct 'RTCPeerConnection': Please use the 'new' operator.");
      var asked = configuration && typeof configuration === "object" ? configuration : {};
      var servers = isFresh(kept) ? kept.iceServers : [];
      var parts = Array.prototype.slice.call(arguments);
      parts[0] = relayedConfiguration(asked, asked, servers);
      var connection = Reflect.construct(Native, parts, new.target);
      askedConfigurations.set(connection, asked);
      if (servers.length) givenServers.set(connection, servers);
      // Fetched now, so they're there by the game's first offer or answer.
      if (!servers.length) relayServers();
      return connection;
    }
    RTCPeerConnection.prototype = proto;
    Object.setPrototypeOf(RTCPeerConnection, Native);
    define(proto, "constructor", RTCPeerConnection);

    /**
     * Before a connection gathers addresses (its first offer or answer): Zaisma's relay servers, and
     * a check that it only relays. Covers every connection in this window, however it was made.
     */
    function relayFirst(connection) {
      return relayServers().then(function (servers) {
        if (connection.signalingState === "closed") return; // the call itself says so
        var current = nativeGetConfiguration.call(connection);
        // Servers it already has stay when new ones couldn't be had.
        var use = servers.length ? servers : givenServers.get(connection) || [];
        if (givenServers.get(connection) !== use || current.iceTransportPolicy !== "relay") {
          try {
            nativeSetConfiguration.call(connection, relayedConfiguration(current, askedConfigurations.get(connection) || current, use));
            givenServers.set(connection, use);
          } catch (error) {
            /* checked just below */
          }
        }
        if (nativeGetConfiguration.call(connection).iceTransportPolicy !== "relay") {
          throw new DOMException("On Zaisma, connections between players go only through Zaisma's relay, and this one couldn't be set to.", "InvalidStateError");
        }
      });
    }
    ["createOffer", "createAnswer", "setLocalDescription"].forEach(function (name) {
      var native = proto[name];
      if (typeof native !== "function") return;
      define(proto, name, function () {
        var connection = this;
        var parts = arguments;
        return relayFirst(connection).then(function () { return native.apply(connection, parts); });
      });
    });
    if (typeof nativeSetConfiguration === "function") {
      // A game changing its servers keeps Zaisma's relay.
      define(proto, "setConfiguration", function (configuration) {
        var asked = configuration && typeof configuration === "object" ? configuration : {};
        askedConfigurations.set(this, asked);
        var servers = givenServers.get(this) || [];
        return nativeSetConfiguration.call(this, relayedConfiguration(asked, asked, servers));
      });
    }
    wrappers.set(Native, RTCPeerConnection);
    return RTCPeerConnection;
  }

  // ---- Every window the game can reach ----

  function install(target) {
    try {
      if (!target) return;
      NAMES.forEach(function (name) {
        var descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (!descriptor || (descriptor.get && getters.has(descriptor.get))) return;
        var Native = target[name];
        if (typeof Native !== "function") return;
        var Relayed = wrappers.get(Native) || wrap(Native);
        var current = Relayed;
        var get = function () { return current; };
        getters.add(get);
        // Libraries like webrtc-adapter put their own wrapper around this one; nothing puts the original back.
        Object.defineProperty(target, name, { configurable: true, enumerable: false, get: get, set: function (assigned) { current = assigned === Native ? Relayed : assigned; } });
      });
      watchFrames(target);
    } catch (error) {
      /* another site's window: nothing of it is reachable from here */
    }
  }

  /** A frame the game makes has its own RTCPeerConnection: it's wrapped the moment the game reaches into the frame. */
  function watchFrames(target) {
    ["HTMLIFrameElement", "HTMLFrameElement", "HTMLObjectElement"].forEach(function (name) {
      var Element = target[name];
      if (typeof Element !== "function") return;
      ["contentWindow", "contentDocument"].forEach(function (property) {
        var descriptor = Object.getOwnPropertyDescriptor(Element.prototype, property);
        if (!descriptor || !descriptor.get || getters.has(descriptor.get)) return;
        var nativeGet = descriptor.get;
        var get = function () {
          var reached = nativeGet.call(this);
          if (reached) install(property === "contentDocument" ? reached.defaultView : reached);
          return reached;
        };
        getters.add(get);
        Object.defineProperty(Element.prototype, property, { configurable: true, enumerable: descriptor.enumerable, get: get });
      });
    });
    watchInsertedFrames(target);
    var nativeOpen = target.open;
    if (typeof nativeOpen === "function" && !getters.has(nativeOpen)) {
      var open = function () {
        var opened = nativeOpen.apply(this, arguments);
        install(opened);
        return opened;
      };
      getters.add(open);
      target.open = open;
    }
  }

  /**
   * A frame is a window of its own the moment it's in the page, and a game can reach it by index (window[0]) without
   * going through contentWindow: every frame in the page is wrapped right after anything is put into the page, and a
   * frame made from text (srcdoc) runs this script first, from the address it came from. Only the page's own frames
   * are looked at, so a page with none pays one length check per change.
   */
  var relayUrl = window.document && window.document.currentScript && window.document.currentScript.src ? window.document.currentScript.src : "";

  function installFrames(target) {
    try {
      var targetDocument = target.document;
      ["iframe", "frame", "object"].forEach(function (tag) {
        var frames = targetDocument.getElementsByTagName(tag);
        for (var index = 0; index < frames.length; index++) install(frames[index].contentWindow);
      });
    } catch (error) {
      /* a frame of another site: nothing of it is reachable from here */
    }
  }

  function watchInsertedFrames(target) {
    var Node = target.Node;
    var Element = target.Element;
    if (typeof Node !== "function" || typeof Element !== "function") return;
    var after = function (proto, name) {
      var native = proto[name];
      if (typeof native !== "function" || getters.has(native)) return;
      var wrapped = function () {
        var answer = native.apply(this, arguments);
        installFrames(target);
        return answer;
      };
      getters.add(wrapped);
      Object.defineProperty(proto, name, { configurable: true, writable: true, enumerable: false, value: wrapped });
    };
    ["appendChild", "insertBefore", "replaceChild"].forEach(function (name) { after(Node.prototype, name); });
    ["append", "prepend", "before", "after", "replaceWith", "replaceChildren", "insertAdjacentElement", "insertAdjacentHTML"].forEach(function (name) { after(Element.prototype, name); });
    // A frame's own page replaces its first one when it loads (a srcdoc in the page's markup, say): wrapped before the game's load handler runs.
    if (target.document && typeof target.document.addEventListener === "function") target.document.addEventListener("load", function () { installFrames(target); }, true);
    ["innerHTML", "outerHTML"].forEach(function (property) {
      var descriptor = Object.getOwnPropertyDescriptor(Element.prototype, property);
      if (!descriptor || !descriptor.set || getters.has(descriptor.set)) return;
      var nativeSet = descriptor.set;
      var set = function (text) {
        nativeSet.call(this, text);
        installFrames(target);
      };
      getters.add(set);
      Object.defineProperty(Element.prototype, property, { configurable: true, enumerable: descriptor.enumerable, get: descriptor.get, set: set });
    });
    // A frame made from text runs this script before its own.
    var Frame = target.HTMLIFrameElement;
    if (!relayUrl || typeof Frame !== "function") return;
    var withRelay = function (text) { return '<script src="' + relayUrl.replace(/"/g, "&quot;") + '"></script>' + String(text); };
    var srcdoc = Object.getOwnPropertyDescriptor(Frame.prototype, "srcdoc");
    if (srcdoc && srcdoc.set && !getters.has(srcdoc.set)) {
      var nativeSrcdoc = srcdoc.set;
      var setSrcdoc = function (text) { nativeSrcdoc.call(this, withRelay(text)); };
      getters.add(setSrcdoc);
      Object.defineProperty(Frame.prototype, "srcdoc", { configurable: true, enumerable: srcdoc.enumerable, get: srcdoc.get, set: setSrcdoc });
    }
    // Whatever else puts a frame or a srcdoc in the page (the page's own markup, document.write, setHTMLUnsafe, an attribute
    // set some other way) is seen here, before the frame's page loads: its srcdoc gets this script first, and its window is wrapped.
    var Observer = target.MutationObserver;
    if (typeof Observer === "function" && target.document && target.document.documentElement && typeof nativeSrcdoc === "function") {
      var prefix = withRelay("");
      new Observer(function () {
        var frames = target.document.getElementsByTagName("iframe");
        for (var index = 0; index < frames.length; index++) {
          var frame = frames[index];
          var text = frame.getAttribute("srcdoc");
          if (text !== null && text.indexOf(prefix) !== 0) nativeSrcdoc.call(frame, withRelay(text));
        }
        installFrames(target);
      }).observe(target.document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["srcdoc"] });
    }
    var nativeSetAttribute = Element.prototype.setAttribute;
    if (typeof nativeSetAttribute === "function" && !getters.has(nativeSetAttribute)) {
      var setAttribute = function (name, text) {
        var isSrcdoc = this instanceof Frame && String(name).toLowerCase() === "srcdoc";
        return nativeSetAttribute.call(this, name, isSrcdoc ? withRelay(text) : text);
      };
      getters.add(setAttribute);
      Object.defineProperty(Element.prototype, "setAttribute", { configurable: true, writable: true, enumerable: false, value: setAttribute });
    }
  }

  try {
    Object.defineProperty(window, RELAY_KEY, { configurable: false, enumerable: false, writable: false, value: relayServers });
  } catch (error) {
    /* already there: this script ran twice */
  }
  install(window);
  // A game that plays online gets its relay servers while it loads, so its first connection doesn't wait.
  if (config.fetchEarly && NAMES.some(function (name) { return typeof window[name] === "function"; })) relayServers();
})(window);
