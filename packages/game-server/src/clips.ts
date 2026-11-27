/**
 * A game's clip, as files: the rules a clip keeps (up to 6 seconds, silent, H.264, fitting the 1200 by 630 share card) and the reader that
 * checks them from an MP4's own boxes, with no decoder. Zaisma's developer API checks every clip with it, and play-locally's bench checks
 * what it recorded before writing it, so both say the same.
 */

/** A clip's limits: what iMessage, Discord and Telegram all play, fitted inside the 1200 by 630 share card. */
export const CLIP_LIMITS = {
  maximumDurationMs: 6000,
  maximumWidthPx: 1200,
  maximumHeightPx: 630,
  /** The least a clip takes on its long and short sides, as a share picture. */
  minimumLongSidePx: 600,
  minimumShortSidePx: 315,
  /** About 3 MB is usual: 6 seconds at 1200 by 630 and 4 megabits a second. */
  maximumSizeBytes: 6 * 1024 * 1024,
  maximumStillSizeBytes: 2 * 1024 * 1024,
  /** The developer API's JSON body: the clip and its still in base64 (a third larger), with room for the field names. */
  maximumBodySizeBytes: 11 * 1024 * 1024,
} as const;

/** What a clip file is, read from its boxes. */
export interface Mp4Facts {
  widthPx: number;
  heightPx: number;
  durationMs: number;
  /** The video track's sample format, like avc1 (H.264) or hvc1 (HEVC). */
  videoFormat: string;
  videoTrackCount: number;
  soundTrackCount: number;
  /** Fragmented MP4s (as a browser's recorder writes) keep their length in fragments, not in the index. */
  isFragmented: boolean;
}

/** Why a file isn't a clip, in the developer API's error codes. */
export type ClipProblemCode = "not_a_clip" | "clip_has_sound" | "clip_too_long" | "bad_clip_dimensions" | "clip_too_big";
export interface ClipProblem {
  code: ClipProblemCode;
  message: string;
  fix: string;
}

/** The sample formats that are H.264. */
const H264_FORMATS = ["avc1", "avc3"];
/** How deep boxes may nest inside a track: a clip's go about four deep. */
const MAXIMUM_BOX_DEPTH_COUNT = 12;
const CONTAINER_BOXES = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "mvex"]);

interface Mp4Box {
  type: string;
  /** Where its contents start and end in the file. */
  bodyStartIndex: number;
  endIndex: number;
}

/** The boxes between two places in the file, in order; null when one runs past its parent or is too short to be a box. */
function boxesIn(bytes: Uint8Array, startIndex: number, endIndex: number): Mp4Box[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Mp4Box[] = [];
  let atIndex = startIndex;
  while (atIndex + 8 <= endIndex) {
    let sizeBytes = view.getUint32(atIndex);
    const type = String.fromCharCode(bytes[atIndex + 4]!, bytes[atIndex + 5]!, bytes[atIndex + 6]!, bytes[atIndex + 7]!);
    let headerBytes = 8;
    if (sizeBytes === 1) {
      if (atIndex + 16 > endIndex) return null;
      const highNumber = view.getUint32(atIndex + 8), lowNumber = view.getUint32(atIndex + 12);
      sizeBytes = highNumber * 2 ** 32 + lowNumber;
      headerBytes = 16;
    } else if (sizeBytes === 0) {
      sizeBytes = endIndex - atIndex;
    }
    if (sizeBytes < headerBytes || atIndex + sizeBytes > endIndex) return null;
    boxes.push({ type, bodyStartIndex: atIndex + headerBytes, endIndex: atIndex + sizeBytes });
    atIndex += sizeBytes;
  }
  return boxes;
}

/** A track's facts from its boxes, or null when its boxes are broken. */
function trackFacts(bytes: Uint8Array, trak: Mp4Box): { handler: string; format: string; widthPx: number; heightPx: number; durationMs: number | null } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let handler = "", format = "", widthPx = 0, heightPx = 0, durationMs: number | null = null;
  // A real clip nests a handful of boxes deep; a file nesting deeper is broken (and can't run the reader out of stack).
  const visit = (box: Mp4Box, depthNumber: number): boolean => {
    if (CONTAINER_BOXES.has(box.type)) {
      if (depthNumber >= MAXIMUM_BOX_DEPTH_COUNT) return false;
      const children = boxesIn(bytes, box.bodyStartIndex, box.endIndex);
      return children !== null && children.every((child) => visit(child, depthNumber + 1));
    }
    const bodyIndex = box.bodyStartIndex, bodyBytes = box.endIndex - box.bodyStartIndex;
    if (box.type === "tkhd") {
      // Width and height are the last 8 bytes, 16.16 fixed point, whatever the version.
      if (bodyBytes < 84) return false;
      widthPx = Math.round(view.getUint32(box.endIndex - 8) / 65536);
      heightPx = Math.round(view.getUint32(box.endIndex - 4) / 65536);
    } else if (box.type === "mdhd") {
      const boxVersionNumber = bytes[bodyIndex]!;
      if (bodyBytes < (boxVersionNumber === 1 ? 32 : 20)) return false;
      const timescaleNumber = view.getUint32(bodyIndex + (boxVersionNumber === 1 ? 20 : 12));
      const durationNumber = boxVersionNumber === 1 ? view.getUint32(bodyIndex + 24) * 2 ** 32 + view.getUint32(bodyIndex + 28) : view.getUint32(bodyIndex + 16);
      if (timescaleNumber > 0) durationMs = Math.round((durationNumber / timescaleNumber) * 1000);
    } else if (box.type === "hdlr") {
      if (bodyBytes < 12) return false;
      handler = String.fromCharCode(...bytes.subarray(bodyIndex + 8, bodyIndex + 12));
    } else if (box.type === "stsd") {
      // Version and flags, the entry count, then the first entry: its size and its format.
      if (bodyBytes < 16) return false;
      format = String.fromCharCode(...bytes.subarray(bodyIndex + 12, bodyIndex + 16));
    }
    return true;
  };
  const children = boxesIn(bytes, trak.bodyStartIndex, trak.endIndex);
  if (!children || !children.every((child) => visit(child, 1))) return null;
  return { handler, format, widthPx, heightPx, durationMs };
}

/** An MP4's facts from its boxes, or null when it isn't an MP4 this can read. */
export function readMp4(bytes: Uint8Array): Mp4Facts | null {
  const top = boxesIn(bytes, 0, bytes.byteLength);
  if (!top || top[0]?.type !== "ftyp") return null;
  const brand = String.fromCharCode(...bytes.subarray(top[0].bodyStartIndex, top[0].bodyStartIndex + 4));
  if (brand === "qt  " || /^M4[ABP] /.test(brand)) return null;
  const moov = top.find((box) => box.type === "moov");
  if (!moov) return null;
  const moovChildren = boxesIn(bytes, moov.bodyStartIndex, moov.endIndex);
  if (!moovChildren) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let movieDurationMs: number | null = null;
  const mvhd = moovChildren.find((box) => box.type === "mvhd");
  if (mvhd) {
    const boxVersionNumber = bytes[mvhd.bodyStartIndex]!;
    if (mvhd.endIndex - mvhd.bodyStartIndex >= (boxVersionNumber === 1 ? 32 : 20)) {
      const timescaleNumber = view.getUint32(mvhd.bodyStartIndex + (boxVersionNumber === 1 ? 20 : 12));
      const durationNumber = boxVersionNumber === 1 ? view.getUint32(mvhd.bodyStartIndex + 24) * 2 ** 32 + view.getUint32(mvhd.bodyStartIndex + 28) : view.getUint32(mvhd.bodyStartIndex + 16);
      if (timescaleNumber > 0) movieDurationMs = Math.round((durationNumber / timescaleNumber) * 1000);
    }
  }
  const tracks = [];
  for (const trak of moovChildren.filter((box) => box.type === "trak")) {
    const facts = trackFacts(bytes, trak);
    if (!facts) return null;
    tracks.push(facts);
  }
  const videoTracks = tracks.filter((track) => track.handler === "vide");
  const video = videoTracks[0];
  if (!video) return null;
  const isFragmented = moovChildren.some((box) => box.type === "mvex") || top.some((box) => box.type === "moof");
  return {
    widthPx: video.widthPx,
    heightPx: video.heightPx,
    durationMs: Math.max(video.durationMs ?? 0, movieDurationMs ?? 0),
    videoFormat: video.format,
    videoTrackCount: videoTracks.length,
    soundTrackCount: tracks.filter((track) => track.handler === "soun").length,
    isFragmented,
  };
}

/** Whether a clip's size fits the share card: inside 1200 by 630, and at least 600 by 315 on its long and short sides. */
export function isClipSizeFitting(widthPx: number, heightPx: number): boolean {
  return (
    widthPx <= CLIP_LIMITS.maximumWidthPx &&
    heightPx <= CLIP_LIMITS.maximumHeightPx &&
    Math.max(widthPx, heightPx) >= CLIP_LIMITS.minimumLongSidePx &&
    Math.min(widthPx, heightPx) >= CLIP_LIMITS.minimumShortSidePx
  );
}

/** The one ffmpeg line that makes any video into a clip, for fixes: its first 6 seconds, fitted inside the card, silent, H.264. */
export const CLIP_FFMPEG_LINE = `ffmpeg -i in.mp4 -t 6 -an -vf "scale=1200:630:force_original_aspect_ratio=decrease:force_divisible_by=2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart clip.mp4`;

/** A clip file's facts, or the first rule it breaks. */
export function checkClip(bytes: Uint8Array): { facts: Mp4Facts } | { problem: ClipProblem } {
  if (bytes.byteLength > CLIP_LIMITS.maximumSizeBytes) {
    return { problem: { code: "clip_too_big", message: `The clip is ${(bytes.byteLength / 1048576).toFixed(1)} MB, over ${CLIP_LIMITS.maximumSizeBytes / 1048576} MB.`, fix: `Save it at a lower bitrate (about 4 megabits a second is plenty), like: ${CLIP_FFMPEG_LINE.replace("-pix_fmt", "-b:v 4M -pix_fmt")}` } };
  }
  const facts = readMp4(bytes);
  if (!facts) return { problem: { code: "not_a_clip", message: "That isn't an MP4 video with a picture track.", fix: `Send an MP4 (H.264), like the bench's Record a clip makes, or make one: ${CLIP_FFMPEG_LINE}` } };
  if (facts.isFragmented) return { problem: { code: "not_a_clip", message: "The MP4 is fragmented (as a browser's recorder saves it), so its length can't be read.", fix: `Save it as a plain MP4: ${CLIP_FFMPEG_LINE}` } };
  if (facts.videoTrackCount > 1) return { problem: { code: "not_a_clip", message: `The MP4 has ${facts.videoTrackCount} picture tracks.`, fix: `Send one picture track: ${CLIP_FFMPEG_LINE}` } };
  if (!H264_FORMATS.includes(facts.videoFormat)) {
    return { problem: { code: "not_a_clip", message: `The clip's video is ${JSON.stringify(facts.videoFormat)}, not H.264, which every app that plays a link's video plays.`, fix: `Save it as H.264: ${CLIP_FFMPEG_LINE}` } };
  }
  if (facts.soundTrackCount) return { problem: { code: "clip_has_sound", message: "The clip has a sound track; a clip is silent.", fix: `Take the sound out (ffmpeg's -an): ${CLIP_FFMPEG_LINE}` } };
  if (facts.durationMs > CLIP_LIMITS.maximumDurationMs) {
    return { problem: { code: "clip_too_long", message: `The clip runs ${(facts.durationMs / 1000).toFixed(1)} seconds, over ${CLIP_LIMITS.maximumDurationMs / 1000}.`, fix: `Cut it to at most 6 seconds that loop well (ffmpeg's -t 6): ${CLIP_FFMPEG_LINE}` } };
  }
  if (facts.durationMs <= 0) return { problem: { code: "not_a_clip", message: "The clip's length can't be read: it says 0 seconds.", fix: `Save it again: ${CLIP_FFMPEG_LINE}` } };
  if (!isClipSizeFitting(facts.widthPx, facts.heightPx)) {
    return {
      problem: {
        code: "bad_clip_dimensions",
        message: `The clip is ${facts.widthPx} by ${facts.heightPx} px.`,
        fix: `Fit it inside ${CLIP_LIMITS.maximumWidthPx} by ${CLIP_LIMITS.maximumHeightPx} px, at least ${CLIP_LIMITS.minimumLongSidePx} by ${CLIP_LIMITS.minimumShortSidePx}: ${CLIP_FFMPEG_LINE}`,
      },
    };
  }
  return { facts };
}

