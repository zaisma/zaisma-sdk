// The dev page's own scripts (local-play.js serves them as /bench/dev.js and /bench/kept.js). The dev page is the bench's: its bar
// (bench/glass.ts) and one frame, the player's page, which is zaisma.com's game page with its own scripts. These never reach into it.

/** What the dev page's frame lets the player's page pass on to the game: the game page's own list (apps/site/src/pages.ts; test/node/local-play-parity.test.ts holds the two together). */
export const FRAME_ALLOW = "fullscreen; gamepad; autoplay; web-share; clipboard-write; cross-origin-isolated; compute-pressure; microphone";

/** The dev page's script: it keeps the player's place, reloads the game when a file changes, runs the dev bar's menus and the Players panel. */
export const devScriptSource = () => `(${devScript.toString()})();\n`;

/**
 * The end of a sign-in on the bench (/account/kept): it tells the open game pages, as zaisma.com's own page does. Opened as a tab of its own,
 * it closes; reached in the player's own tab (a blocked pop-up sends the sign-in there), it goes back to the player's dev page and game.
 */
export const KEPT_SCRIPT_SOURCE = `try { new BroadcastChannel("zaisma").postMessage("signed-in"); } catch {}
var keptPlayerNumber = Number(new URL(document.currentScript.src).searchParams.get("player")) || 0;
setTimeout(function () {
  if (window.opener) window.close();
  else {
    // The dev page's own query (kept by the dev script for this tab) goes back with the player.
    var rest = ""; try { rest = sessionStorage.getItem("zaisma-bench:query") || ""; } catch (error) {}
    location.replace(keptPlayerNumber ? "/?player=" + keptPlayerNumber + (rest ? "&" + rest : "") : "/" + (rest ? "?" + rest : ""));
  }
}, 800);
`;

/** Where a tab arrives (/ with no player): the tab's own player number again, or a new player's, then the dev page. */
export const ARRIVE_SCRIPT_SOURCE = `(function () {
  var kept = null;
  try { kept = Number(sessionStorage.getItem("zaisma-bench:player")) || null; } catch (error) {}
  // The page's own query goes through with the player (a room code only when it's a real one).
  var rest = new URLSearchParams(location.search); rest.delete("player");
  if (!/^[A-Z0-9]{6}$/.test(rest.get("room") || "")) rest.delete("room");
  fetch("/bench/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ keptPlayerNumber: kept }) })
    .then(function (response) { return response.json(); })
    .then(function (answer) { location.replace("/?player=" + answer.playerNumber + (rest.toString() ? "&" + rest.toString() : "")); });
})();
`;

/** Run in the browser. Written as a function so it stays real code; the bench serves its text. */
function devScript() {
  const scriptUrl = new URL(document.currentScript.src);
  const isPage = scriptUrl.searchParams.get("page") === "players";
  let playerNumber = Number(scriptUrl.searchParams.get("player")) || 0;
  try {
    // The Players page a sign-in opened knows its player from the tab (a tab opened by a page starts with a copy of the page's storage).
    if (isPage && !playerNumber) playerNumber = Number(sessionStorage.getItem("zaisma-bench:player")) || 0;
    else {
      sessionStorage.setItem("zaisma-bench:player", String(playerNumber));
      // The page's own query, besides the player, for the way back from a sign-in (KEPT_SCRIPT_SOURCE).
      const rest = new URLSearchParams(location.search); rest.delete("player");
      if (!isPage) sessionStorage.setItem("zaisma-bench:query", rest.toString());
    }
  } catch {
    // Storage off: the tab is a new player each time it comes to /.
  }
  const frame = document.getElementById("bench-player");
  const panel = document.getElementById("bench-panel");
  const playersButton = document.getElementById("bench-players-open");
  const addTab = document.getElementById("bench-add-tab");
  let reloadNumber = null;
  let roomCode = null;

  const refresh = (name) =>
    fetch(`/bench/sheet/${name}?player=${playerNumber}`)
      .then((response) => response.text())
      .then((text) => {
        const body = document.getElementById(`bench-${name}-body`);
        if (body) body.innerHTML = text;
      })
      .catch(() => {});

  // --- The Players panel: drawn by the bench, and every change through the bench's API, the same calls a developer's AI makes ---
  let panelView = { view: "list", playerId: "", tab: "profile", search: "" };
  const drawPanel = (changes = {}) => {
    panelView = { ...panelView, ...changes };
    const query = new URLSearchParams({ player: String(playerNumber), view: panelView.view, player_id: panelView.playerId, tab: panelView.tab, search: panelView.search, page: isPage ? "yes" : "" });
    return fetch(`/bench/panel?${query}`)
      .then((response) => response.text())
      .then((text) => {
        panel.innerHTML = text;
        const search = panel.querySelector("[data-bench-search]");
        if (search && panelView.search) {
          search.focus();
          search.setSelectionRange(search.value.length, search.value.length);
        }
      })
      .catch(() => {});
  };
  const showPanel = (isShown) => {
    if (!panel || isPage) return;
    panel.hidden = !isShown;
    playersButton?.setAttribute("aria-pressed", String(isShown));
    if (isShown) drawPanel();
  };
  const api = (method, path, body) =>
    fetch(path, { method, headers: { "content-type": "application/json" }, ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body ?? {}) }) }).then(async (response) => ({ isOk: response.ok, answer: await response.json().catch(() => ({})) }));
  const showError = (answer) => {
    const line = panel.querySelector("[data-bench-error]");
    if (line && answer?.error) {
      line.textContent = answer.error.message;
      line.hidden = false;
    }
  };
  // Playing as someone starts the game again as them: here the dev page comes back with the game; on the page a sign-in opened, the
  // game page hears it as zaisma.com's own end of a sign-in, and the page closes or goes back to the player's game.
  const playAs = (playerId) =>
    api("PUT", `/bench/api/open-players/${playerNumber}`, { player_id: playerId === "guest" ? null : playerId }).then(({ isOk }) => {
      if (!isOk) return;
      if (!isPage) return location.assign(`/?player=${playerNumber}`);
      try {
        new BroadcastChannel("zaisma").postMessage("signed-in");
      } catch {
        // No channel: the game page checks again as its tab comes back into view.
      }
      if (window.opener) window.close();
      else location.assign(`/?player=${playerNumber}`);
    });
  if (panel) {
    panel.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const closer = target?.closest("[data-bench-panel]");
      if (closer) return showPanel(false);
      const viewer = target?.closest("[data-bench-view]");
      if (viewer) return drawPanel({ view: viewer.dataset.benchView, playerId: viewer.dataset.playerId ?? panelView.playerId, tab: "profile", search: "" });
      const tab = target?.closest("[data-bench-tab]");
      if (tab) return drawPanel({ tab: tab.dataset.benchTab, search: "" });
      const caller = target?.closest("[data-bench-call]");
      if (caller) {
        const [method, path] = caller.dataset.benchCall.split(" ");
        return api(method, path, JSON.parse(caller.dataset.benchBody || "{}")).then(({ isOk, answer }) => (isOk ? drawPanel() : showError(answer)));
      }
      const maker = target?.closest("[data-bench-make]");
      if (maker) {
        const form = maker.closest("[data-bench-form]");
        const field = (name) => form.querySelector(`[name="${name}"]`).value;
        return api("POST", "/bench/api/players", { name: field("name"), age_band: field("age_band"), social_mode: field("social_mode") }).then(({ isOk, answer }) =>
          isOk ? drawPanel({ view: "player", playerId: answer.player.player_id, tab: "profile", search: "" }) : showError(answer),
        );
      }
      const deleter = target?.closest("[data-bench-delete]");
      if (deleter && confirm(`Delete ${deleter.dataset.playerName}? Their saves, items, purchases, friends and blocks on the bench go too.`)) {
        return api("DELETE", deleter.dataset.benchDelete).then(() => drawPanel({ view: "list", playerId: "" }));
      }
    });
    // A profile's fields save as they change; picking a friend or a block adds them.
    panel.addEventListener("change", (event) => {
      const field = event.target;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
      if (field.dataset.benchField) {
        api("PATCH", field.dataset.benchField, { [field.name]: field.value }).then(({ isOk, answer }) => (isOk ? drawPanel() : showError(answer)));
      } else if (field.dataset.benchAdd && field.value) {
        api("PUT", `${field.dataset.benchAdd}${field.value}`).then(({ isOk, answer }) => (isOk ? drawPanel() : showError(answer)));
      }
    });
    let searchTimer = null;
    panel.addEventListener("input", (event) => {
      if (!(event.target instanceof HTMLInputElement) || !event.target.hasAttribute("data-bench-search")) return;
      const search = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => drawPanel({ search }), 200);
    });
  }
  playersButton?.addEventListener("click", () => showPanel(panel.hidden));

  // --- The dev bar's menus: each opens under its button, drawn afresh where it shows what changes, and closes on a pick, Escape or a click away ---
  const closeMenus = () => {
    for (const menu of document.querySelectorAll(".bench-menu")) menu.hidden = true;
    for (const button of document.querySelectorAll("[data-bench-menu]")) button.setAttribute("aria-expanded", "false");
  };
  const openMenu = (button) => {
    const menu = document.getElementById(button.dataset.benchMenu);
    const wasOpen = !menu.hidden;
    closeMenus();
    if (wasOpen) return;
    menu.hidden = false;
    const buttonBox = button.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(buttonBox.left, innerWidth - menu.offsetWidth - 8))}px`;
    button.setAttribute("aria-expanded", "true");
    if (menu.id === "bench-add-menu") refresh("phone");
    if (menu.id === "bench-log-menu") refresh("log");
    menu.querySelector(".bm-item")?.focus();
  };
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const menuButton = target?.closest("[data-bench-menu]");
    if (menuButton) return openMenu(menuButton);
    // Playing as someone, from the player menu or the Players panel.
    const player = target?.closest("[data-bench-play-as]");
    if (player) {
      closeMenus();
      return playAs(player.dataset.benchPlayAs);
    }
    // The player menu's All players opens the panel.
    const opener = target?.closest('[data-bench-panel="open"]');
    if (opener) {
      event.preventDefault();
      closeMenus();
      return showPanel(true);
    }
    if (target?.closest(".bm-item") && !target.closest("[data-bench-clip]")) return setTimeout(closeMenus, 0);
    if (!target?.closest(".bench-menu")) closeMenus();
  });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });
  if (isPage) {
    drawPanel();
    return;
  }

  // --- Record a clip: the game's frame records it (local-play-clip.js), the bench checks and keeps it, and it plays back here before it's sent ---
  const clipBody = document.getElementById("bench-clip-body");
  let clipRequestId = null;
  let lastAskedClipRequestId = null;
  const escaped = (text) => String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const showClip = (markup) => {
    clipBody.hidden = false;
    clipBody.innerHTML = markup;
  };
  const base64Of = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let text = "";
    for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(text);
  };
  const keepClip = (body) =>
    fetch(`/bench/clips?player=${playerNumber}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((response) => response.json())
      .then((answer) => {
        if (answer.error) return showClip(`<span class="bp-error">${escaped(answer.error.message)}</span><span class="bp-note">${escaped(answer.error.fix)}</span>`);
        const name = answer.clip_url.split("/").pop();
        showClip(
          `<video src="${escaped(answer.clip_url)}" muted loop autoplay playsinline style="width:100%;border-radius:6px"></video>` +
            `<span class="bp-note">${(answer.duration_ms / 1000).toFixed(1)} s, ${answer.width_px} by ${answer.height_px}, ${Math.round(answer.size_bytes / 1024)} KB, <span title="${escaped(answer.clip_file)}">${escaped(name)}</span> in the bench's clips folder</span>` +
            (answer.can_send ? `<button class="bm-item" type="button" data-bench-clip-send="${escaped(name)}"><span>Send to Zaisma</span></button>` : `<span class="bp-note">Send it with: <code>${escaped(answer.send_command)}</code></span>`),
        );
      })
      .catch(() => showClip('<span class="bp-error">The bench didn\'t answer.</span>'));
  const recordClip = (durationSec, requestId) => {
    const game = frame.contentDocument?.getElementById("game");
    clipRequestId = requestId || `clip_request_${Date.now()}`;
    if (!game?.contentWindow || !game.getAttribute("src")) return keepClip({ request_id: clipRequestId, error_code: "game_not_playing", message: "The game isn't playing yet." });
    showClip(`<span class="bp-note">Recording ${durationSec} seconds…</span>`);
    game.contentWindow.postMessage({ kind: "zaisma-bench-record", requestId: clipRequestId, durationSec }, new URL(game.getAttribute("src"), frame.contentWindow.location.href).origin);
  };
  addEventListener("message", (event) => {
    const game = frame.contentDocument?.getElementById("game");
    if (!event.data || event.data.kind !== "zaisma-bench-clip" || event.data.requestId !== clipRequestId || event.source !== game?.contentWindow) return;
    const given = event.data;
    clipRequestId = null;
    showClip('<span class="bp-note">Checking it…</span>');
    keepClip(given.errorCode ? { request_id: given.requestId, error_code: given.errorCode, message: given.message } : { request_id: given.requestId, clip_base64: base64Of(given.clip), still_base64: base64Of(given.still) });
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const recorder = target?.closest("[data-bench-clip]");
    if (recorder) return recordClip(Number(recorder.dataset.benchClip), null);
    const sender = target?.closest("[data-bench-clip-send]");
    if (!sender) return;
    sender.disabled = true;
    fetch("/bench/clips/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clip_file: sender.dataset.benchClipSend }) })
      .then((response) => response.json())
      .then((answer) => sender.replaceWith(Object.assign(document.createElement("span"), { className: answer.error ? "bp-error" : "bp-note", textContent: answer.error ? `${answer.error.message} ${answer.error.fix ?? ""}` : answer.review_message })))
      .catch(() => (sender.disabled = false));
  });

  // About once a second: the player is still here, a game file changed (reload the game), and the room they're in (Add a player joins it).
  const check = () =>
    fetch(`/bench/state?player=${playerNumber}`)
      .then((response) => response.json())
      .then((answer) => {
        if (reloadNumber !== null && answer.reloadNumber !== reloadNumber) frame.contentWindow?.location.reload();
        reloadNumber = answer.reloadNumber;
        // The developer's AI asked for a clip (POST /bench/api/clips): this tab records it.
        if (answer.clipRequest && answer.clipRequest.requestId !== lastAskedClipRequestId) {
          lastAskedClipRequestId = answer.clipRequest.requestId;
          recordClip(answer.clipRequest.durationSec, answer.clipRequest.requestId);
        }
        if (answer.roomCode !== roomCode) {
          roomCode = answer.roomCode;
          // A new tab is a new player (a link to a new tab starts with nothing of this one's), into this room.
          addTab.href = roomCode ? `/?room=${roomCode}` : "/";
        }
      })
      .catch(() => {});
  check();
  setInterval(check, 1000);
  addEventListener("pagehide", () => navigator.sendBeacon(`/bench/leave?player=${playerNumber}`));
  if (new URLSearchParams(location.search).get("panel") === "players") showPanel(true);
}
