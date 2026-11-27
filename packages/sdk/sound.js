/*
 * Zaisma's own sound for every game. Zaisma adds this to every game page, first, before any of the game's own scripts: one volume and one mute
 * over all of the game's audio, whatever the game does with its own settings, and voices (the SDK's room.voice) at a volume of their own. The
 * player sets them in the guide's Settings, beside the game, and the Zaisma game page hands them over (zaisma:sound); nothing leaves the frame.
 * Web Audio: whatever the game connects to a context's speakers goes through one gain of Zaisma's on its way. Audio and video elements: the volume
 * a game sets is kept as its own, and the element plays at that times Zaisma's. Plain JavaScript, no dependencies, MIT licensed.
 */
(function () {
  "use strict";
  var site = typeof __ZAISMA_SOUND__ === "object" && __ZAISMA_SOUND__ ? __ZAISMA_SOUND__.site : "";
  if (!site || window.parent === window || window.__zaismaSoundSet) return;
  window.__zaismaSoundSet = true;
  var sound = { gameVolumePct: 100, isGameSoundOn: true, voiceVolumePct: 100 };
  var levelOf = function (isVoice) { return isVoice ? sound.voiceVolumePct / 100 : sound.isGameSoundOn ? sound.gameVolumePct / 100 : 0; };

  /* ---- Web Audio ---- */

  var Node = window.AudioNode, Destination = window.AudioDestinationNode;
  var gains = [];
  if (Node && Destination) {
    var connect = Node.prototype.connect, disconnect = Node.prototype.disconnect;
    // Each context's own gain in front of its speakers, made the first time something is connected to them.
    var gainOf = function (audioContext) {
      if (audioContext.__zaismaGain) return audioContext.__zaismaGain;
      var gain = audioContext.createGain();
      connect.call(gain, audioContext.destination);
      gain.gain.value = levelOf(audioContext.__zaismaVoice === true);
      audioContext.__zaismaGain = gain;
      gains.push({ audioContext: audioContext, gain: gain });
      return gain;
    };
    Node.prototype.connect = function (target) {
      if (target instanceof Destination && this !== target.context.__zaismaGain) {
        var rest = Array.prototype.slice.call(arguments, 1);
        return connect.apply(this, [gainOf(target.context)].concat(rest));
      }
      return connect.apply(this, arguments);
    };
    Node.prototype.disconnect = function (target) {
      if (target instanceof Destination && target.context.__zaismaGain && this !== target.context.__zaismaGain) {
        var rest = Array.prototype.slice.call(arguments, 1);
        return disconnect.apply(this, [target.context.__zaismaGain].concat(rest));
      }
      return disconnect.apply(this, arguments);
    };
  }

  /* ---- Audio and video elements ---- */

  var Media = window.HTMLMediaElement;
  var elements = [];
  var volume = Media && Object.getOwnPropertyDescriptor(Media.prototype, "volume");
  if (volume && volume.get && volume.set) {
    var own = function (element) { return typeof element.__zaismaVolume === "number" ? element.__zaismaVolume : 1; };
    var apply = function (element) { volume.set.call(element, Math.max(0, Math.min(1, own(element) * levelOf(element.__zaismaVoice === true)))); };
    var keep = function (element) { if (element.__zaismaKept) return; element.__zaismaKept = true; elements.push(new WeakRef(element)); };
    Object.defineProperty(Media.prototype, "volume", {
      configurable: true,
      enumerable: volume.enumerable,
      get: function () { return own(this); },
      set: function (volumeLevel) { this.__zaismaVolume = Math.max(0, Math.min(1, Number(volumeLevel))); keep(this); apply(this); },
    });
    var play = Media.prototype.play;
    Media.prototype.play = function () { keep(this); apply(this); return play.apply(this, arguments); };
    document.addEventListener("play", function (event) { if (event.target instanceof Media) { keep(event.target); apply(event.target); } }, true);
  }

  function applyAll() {
    gains.forEach(function (each) {
      var level = levelOf(each.audioContext.__zaismaVoice === true);
      try { each.gain.gain.setTargetAtTime(level, each.audioContext.currentTime, 0.02); } catch (error) { each.gain.gain.value = level; }
    });
    elements = elements.filter(function (held) { var element = held.deref(); if (element) apply(element); return Boolean(element); });
  }
  var pct = function (given, fallback) { return typeof given === "number" && given >= 0 && given <= 100 ? Math.round(given) : fallback; };
  window.addEventListener("message", function (event) {
    var told = event.data;
    if (event.origin !== site || event.source !== window.parent || !told || told.type !== "zaisma:sound") return;
    sound = { gameVolumePct: pct(told.gameVolumePct, 100), isGameSoundOn: told.isGameSoundOn !== false, voiceVolumePct: pct(told.voiceVolumePct, 100) };
    applyAll();
  });
  // Asked for as the game starts, so a game that plays at once plays at the player's volume.
  window.parent.postMessage({ type: "zaisma:sound-request" }, site);
})();
