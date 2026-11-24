/*
 * How hard the player's device works while the game is open. Zaisma adds this to every game page: where the browser
 * says (Compute Pressure, in Chrome and Edge), it counts the seconds the game is on screen and the seconds of them the
 * device's CPU is under serious or critical pressure, and hands both to the Zaisma game page every half minute. Only
 * these two numbers leave the frame; Zaisma adds them up per game and day, to notice a game that mines in its players'
 * browsers. The game page measures nothing itself: while the game has focus, only the game's own frame gets readings.
 * Plain JavaScript, no dependencies, MIT licensed.
 */
(function () {
  "use strict";
  var site = typeof __ZAISMA_PRESSURE__ === "object" && __ZAISMA_PRESSURE__ ? __ZAISMA_PRESSURE__.site : "";
  if (!site || window.parent === window || typeof window.PressureObserver !== "function") return;
  var REPORT_INTERVAL_MS = 30000;
  var state = null;
  var sinceMs = Date.now();
  var measuredMs = 0;
  var seriousMs = 0;

  function settle() {
    var nowMs = Date.now();
    if (state !== null && !document.hidden) {
      measuredMs += nowMs - sinceMs;
      if (state === "serious" || state === "critical") seriousMs += nowMs - sinceMs;
    }
    sinceMs = nowMs;
  }

  try {
    var observer = new window.PressureObserver(function (records) {
      settle();
      if (records.length) state = records[records.length - 1].state;
    });
    var started = observer.observe("cpu", { sampleInterval: 2000 });
    if (started && typeof started.catch === "function") started.catch(function () {});
  } catch (error) {
    return;
  }
  document.addEventListener("visibilitychange", settle);
  setInterval(function () {
    settle();
    var measuredSec = Math.floor(measuredMs / 1000);
    if (measuredSec < 1) return;
    var seriousSec = Math.min(measuredSec, Math.floor(seriousMs / 1000));
    measuredMs -= measuredSec * 1000;
    seriousMs = Math.max(0, seriousMs - seriousSec * 1000);
    window.parent.postMessage({ type: "zaisma:pressure", measured_sec: measuredSec, serious_sec: seriousSec }, site);
  }, REPORT_INTERVAL_MS);
})();
