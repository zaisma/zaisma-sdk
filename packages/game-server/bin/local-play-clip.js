// Record a clip on the bench: the script the game's site puts in the game's pages (/_zaisma/clip.js, only on the bench; Zaisma's games
// Worker has no such file). It does nothing until the bench's own page asks, by a message from the bench's origin: then it captures the
// game's largest canvas as it plays (canvas.captureStream), draws each frame fitted inside the 1200 by 630 share card, writes them into an
// H.264 MP4 with the browser's own encoder (clip-encoder.js), takes the first frame as the still, and hands both back to the bench's page.
// A game with no canvas, or a browser with no H.264 encoder (Firefox), gets an error code with its fix instead.
import { MP4_ENCODER_SOURCE } from "./clip-encoder.js";

/** Frames a second a clip is recorded at, and its bitrate: about 3 MB for 6 seconds. */
export const CLIP_FRAMES_PER_SEC = 30;
export const CLIP_BITS_PER_SEC = 4_000_000;
/** The seconds a recording may run, and the card it fits inside. */
export const CLIP_RECORDING = { minimumDurationSec: 2, maximumDurationSec: 6, widthPx: 1200, heightPx: 630 };

/** The script, with the bench's origin handed in so only the bench's page can start it. */
export const clipScriptSource = (benchOrigin) => `(function (setup) {
${MP4_ENCODER_SOURCE}
  var encoder = window.zaismaMp4Encoder;
  try { delete window.zaismaMp4Encoder; } catch (error) {}
  var isRecording = false;
  function largestCanvas() {
    var best = null, bestArea = 0;
    document.querySelectorAll("canvas").forEach(function (canvas) {
      var box = canvas.getBoundingClientRect(), area = box.width * box.height;
      if (canvas.width > 0 && canvas.height > 0 && area > bestArea) { best = canvas; bestArea = area; }
    });
    return best;
  }
  addEventListener("message", async function (event) {
    if (event.origin !== setup.bench || !event.data || event.data.kind !== "zaisma-bench-record") return;
    var requestId = String(event.data.requestId || "");
    function reply(answer, transfer) { event.source.postMessage(Object.assign({ kind: "zaisma-bench-clip", requestId: requestId }, answer), event.origin, transfer || []); }
    if (isRecording) return reply({ errorCode: "already_recording", message: "A clip is being recorded already." });
    var source = largestCanvas();
    if (!source) return reply({ errorCode: "no_canvas", message: "The game draws no canvas the bench can record." });
    var durationSec = Math.min(setup.maximumDurationSec, Math.max(setup.minimumDurationSec, Number(event.data.durationSec) || setup.maximumDurationSec));
    var scale = Math.min(setup.widthPx / source.width, setup.heightPx / source.height);
    var widthPx = Math.max(2, Math.min(setup.widthPx, Math.round((source.width * scale) / 2) * 2)), heightPx = Math.max(2, Math.min(setup.heightPx, Math.round((source.height * scale) / 2) * 2));
    if (!(await encoder.isSupported(widthPx, heightPx))) return reply({ errorCode: "recording_unsupported", message: "This browser has no H.264 encoder." });
    var stream;
    try { stream = source.captureStream(setup.framesPerSec); } catch (error) { return reply({ errorCode: "canvas_not_readable", message: "The game's canvas can't be read: it draws a picture from another site that doesn't allow it." }); }
    isRecording = true;
    try {
      var video = document.createElement("video");
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      var out = document.createElement("canvas"); out.width = widthPx; out.height = heightPx;
      var context = out.getContext("2d");
      var first = document.createElement("canvas"); first.width = widthPx; first.height = heightPx;
      await encoder.start(widthPx, heightPx, setup.framesPerSec, setup.bitsPerSec);
      var frameCount = Math.round(durationSec * setup.framesPerSec), frameIndex = 0, startMs = performance.now();
      await new Promise(function (done) {
        function tick() {
          var dueIndex = Math.floor((performance.now() - startMs) / (1000 / setup.framesPerSec));
          while (frameIndex <= dueIndex && frameIndex < frameCount) {
            context.drawImage(video, 0, 0, widthPx, heightPx);
            if (frameIndex === 0) first.getContext("2d").drawImage(out, 0, 0);
            encoder.addFrame(out, frameIndex);
            frameIndex++;
          }
          if (frameIndex >= frameCount) return done();
          requestAnimationFrame(tick);
        }
        tick();
      });
      stream.getTracks().forEach(function (track) { track.stop(); });
      var clip = await encoder.finish();
      var still = await new Promise(function (done) { first.toBlob(done, "image/jpeg", 0.9); });
      var stillBytes = await still.arrayBuffer();
      reply({ clip: clip.buffer, still: stillBytes, widthPx: widthPx, heightPx: heightPx, durationMs: Math.round((frameCount * 1000) / setup.framesPerSec) }, [clip.buffer, stillBytes]);
    } catch (error) {
      reply({ errorCode: "recording_failed", message: String((error && error.message) || error) });
    } finally {
      isRecording = false;
    }
  });
})(${JSON.stringify({ bench: benchOrigin, framesPerSec: CLIP_FRAMES_PER_SEC, bitsPerSec: CLIP_BITS_PER_SEC, ...CLIP_RECORDING })});
`;
