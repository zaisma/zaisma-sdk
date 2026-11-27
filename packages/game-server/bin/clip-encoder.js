// A small MP4 writer that runs in a browser page: frames through the browser's own H.264 encoder (WebCodecs), then into one MP4 file
// with its index first, so it starts at once. Nothing needs an encoder installed. H.264 because every browser, phone and chat app
// plays it. The bench's Record a clip uses it (local-play.js serves it inside the game's clip script), and so do Zaisma's own brand
// videos (scripts/guild-seal.mjs, scripts/brand.mjs). Chrome, Edge and Safari have the encoder; Firefox has none (isSupported says).

/** The page script: it sets window.zaismaMp4Encoder. */
export const MP4_ENCODER_SOURCE = `window.zaismaMp4Encoder = (function () {
  var samples = [], encoder = null, failure = null, W = 0, H = 0, FPS = 30, avcC = null;
  // High, then Main, then Baseline: the first the browser's encoder takes.
  var CODECS = ["avc1.640028", "avc1.4D4028", "avc1.42E028"];
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }
  function ascii(s) { return Array.from(s).map(function (c) { return c.charCodeAt(0); }); }
  function concat(parts) { var size = 0, at = 0; parts.forEach(function (p) { size += p.length; }); var out = new Uint8Array(size); parts.forEach(function (p) { out.set(p, at); at += p.length; }); return out; }
  function box(type) { var body = concat([].slice.call(arguments, 1).map(function (p) { return p instanceof Uint8Array ? p : new Uint8Array(p); })); return concat([new Uint8Array(u32(body.length + 8).concat(ascii(type))), body]); }
  var IDENTITY = [].concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
  function zeros(n) { return new Array(n).fill(0); }
  function moov(offset) {
    var TIMESCALE = FPS * 1000, count = samples.length, duration = count * 1000;
    var keys = []; samples.forEach(function (s, i) { if (s.key) keys.push(i + 1); });
    var avc1 = box("avc1", zeros(6), u16(1), zeros(16), u16(W), u16(H), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(24), u16(0xFFFF), box("avcC", avcC));
    var stbl = box("stbl", box("stsd", u32(0), u32(1), avc1), box("stts", u32(0), u32(1), u32(count), u32(1000)), box("stss", u32(0), u32(keys.length), [].concat.apply([], keys.map(u32))), box("stsc", u32(0), u32(1), u32(1), u32(count), u32(1)), box("stsz", u32(0), u32(0), u32(count), [].concat.apply([], samples.map(function (s) { return u32(s.data.length); }))), box("stco", u32(0), u32(1), u32(offset)));
    var minf = box("minf", box("vmhd", u32(1), zeros(8)), box("dinf", box("dref", u32(0), u32(1), box("url ", u32(1)))), stbl);
    var mdia = box("mdia", box("mdhd", u32(0), u32(0), u32(0), u32(TIMESCALE), u32(duration), u16(0x55C4), u16(0)), box("hdlr", u32(0), u32(0), ascii("vide"), zeros(12), ascii("VideoHandler"), [0]), minf);
    var trak = box("trak", box("tkhd", u32(3), u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(0), u16(0), IDENTITY, u32(W * 65536), u32(H * 65536)), mdia);
    return box("moov", box("mvhd", u32(0), u32(0), u32(0), u32(TIMESCALE), u32(duration), u32(0x10000), u16(0x100), zeros(10), IDENTITY, zeros(24), u32(2)), trak);
  }
  async function configFor(width, height, fps, bitrate) {
    if (typeof VideoEncoder === "undefined") return null;
    for (var i = 0; i < CODECS.length; i++) {
      var config = { codec: CODECS[i], width: width, height: height, bitrate: bitrate, framerate: fps, avc: { format: "avc" } };
      try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch (error) {}
    }
    return null;
  }
  function toBase64(bytes) { var s = ""; for (var k = 0; k < bytes.length; k += 32768) s += String.fromCharCode.apply(null, bytes.subarray(k, k + 32768)); return btoa(s); }
  var api = {
    /** Whether this browser can write an H.264 MP4 of this size. */
    isSupported: async function (width, height) { return Boolean(await configFor(width || 1200, height || 630, 30, 4000000)); },
    /** Starts a file: width and height even, frames a second, bits a second. */
    start: async function (width, height, fps, bitrate) {
      samples = []; avcC = null; failure = null; W = width; H = height; FPS = fps;
      var config = await configFor(width, height, fps, bitrate);
      if (!config) throw new Error("This browser has no H.264 encoder: use Chrome, Edge or Safari.");
      encoder = new VideoEncoder({ output: function (chunk, metadata) { if (metadata && metadata.decoderConfig && metadata.decoderConfig.description) avcC = new Uint8Array(metadata.decoderConfig.description.slice ? metadata.decoderConfig.description.slice(0) : metadata.decoderConfig.description.buffer); var data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); samples.push({ key: chunk.type === "key", at: chunk.timestamp, data: data }); }, error: function (e) { failure = e; } });
      encoder.configure(config);
    },
    /** Adds the next frame from a canvas, an image or a bitmap the file's size. */
    addFrame: function (source, index) {
      var frame = new VideoFrame(source, { timestamp: Math.round(index * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: index % (FPS * 2) === 0 });
      frame.close();
    },
    /** Adds the next frame from a PNG, base64. */
    addPng: async function (base64, index) { var bitmap = await createImageBitmap(await (await fetch("data:image/png;base64," + base64)).blob()); api.addFrame(bitmap, index); bitmap.close(); },
    /** Ends the file: its bytes. */
    finish: async function () {
      await encoder.flush(); encoder.close(); encoder = null;
      if (failure) throw failure;
      if (!samples.length || !avcC) throw new Error("The encoder made no frames.");
      for (var i = 1; i < samples.length; i++) if (samples[i].at <= samples[i - 1].at) throw new Error("The encoder reordered its frames: this file writer doesn't handle that.");
      var ftyp = box("ftyp", ascii("isom"), u32(512), ascii("isomiso2avc1mp41"));
      var offset = ftyp.length + moov(0).length + 8;
      return concat([ftyp, moov(offset), box("mdat", concat(samples.map(function (s) { return s.data; })))]);
    },
    /** The same, base64, for a script driving the page. */
    finishBase64: async function () { return toBase64(await api.finish()); },
    toBase64: toBase64
  };
  return api;
})();`;
