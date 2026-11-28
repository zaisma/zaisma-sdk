// What a pack or a preset holds, found by opening each file (docs/PIECES.md, "Packs and presets"). A file is what
// its name says only when its first bytes say so too: an image can only be an image, a sound only a sound. A pack
// whose every file is a kind that can't run is "files_only", a guarantee; one with any file that can run, that can
// point at a script already in the game, or that this check can't see through is "contains_code". Nothing here
// touches a disk or a network: `zaisma pieces check` and Zaisma's site mark a pack with exactly the same code.

/** What a pack or preset is marked as: nothing in it can run, or something can (or this check can't rule it out). */
export const CONTENTS_KINDS = ["files_only", "contains_code"];
/** How many of a file's first bytes the check reads; a file read whole is checked whole. */
export const CONTENT_HEAD_SIZE_BYTES = 4096;
/** An SVG is read whole to look for a script, up to this; a bigger one can't be ruled out. */
export const MAXIMUM_SVG_SIZE_BYTES = 2 * 1024 * 1024;
/** What a file can be: the first seven can't run. */
export const FILE_FAMILIES = ["image", "sound", "video", "model", "font", "text", "data", "code", "unknown"];

const startsWith = (bytes, signature, startIndex = 0) => bytes.length >= startIndex + signature.length && signature.every((byte, i) => byte === null || bytes[startIndex + i] === byte);
const ascii = (text) => [...text].map((letter) => letter.charCodeAt(0));
/** An ISO media file (mp4, m4a, mov, avif): a box named ftyp first. */
const isIsoMedia = (bytes) => startsWith(bytes, ascii("ftyp"), 4);
const isRiff = (bytes, form) => startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii(form), 8);
/** Whether a file's first bytes are text as people write it: UTF-8 (or UTF-16 with its mark) with no control bytes but tabs and line ends. */
export function isText(bytes) {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  for (const byte of bytes) if (byte < 9 || (byte > 13 && byte < 32 && byte !== 27)) return false;
  try {
    // A head cut in the middle of a letter is still text: only what's whole is judged.
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytes.length - 4 > 0 ? bytes.length - 4 : bytes.length));
    return true;
  } catch {
    return false;
  }
}
const textOf = (bytes) => new TextDecoder("utf-8").decode(bytes);

/**
 * Bytes that run, or that hold other files this check can't open, whatever the file is called: WebAssembly, a
 * program for Windows, macOS or Linux, a script that names its own interpreter, or an archive.
 */
const RUNNABLE_SIGNATURES = [
  { what: "WebAssembly", signature: [0x00, ...ascii("asm")] },
  { what: "a Linux program", signature: [0x7f, ...ascii("ELF")] },
  { what: "a Windows program", signature: ascii("MZ") },
  { what: "a macOS program", signature: [0xfe, 0xed, 0xfa, 0xce] },
  { what: "a macOS program", signature: [0xfe, 0xed, 0xfa, 0xcf] },
  { what: "a macOS program", signature: [0xcf, 0xfa, 0xed, 0xfe] },
  { what: "a macOS program", signature: [0xca, 0xfe, 0xba, 0xbe] },
  { what: "a script", signature: ascii("#!") },
  { what: "an archive", signature: [...ascii("PK"), 0x03, 0x04] },
  { what: "an archive", signature: [0x1f, 0x8b] },
  { what: "an archive", signature: [...ascii("7z"), 0xbc, 0xaf, 0x27, 0x1c] },
  { what: "an archive", signature: [...ascii("Rar!"), 0x1a, 0x07] },
];

/**
 * What Zaisma's storage takes in no game and no piece, whatever it's called, from a file's first bytes: a program for
 * Windows, macOS or Linux, a shell script, an archive or a PDF. Answers what it is in words, or null.
 */
export function refusedFileOf(headBytes) {
  if (startsWith(headBytes, ascii("MZ"))) return "a Windows program";
  if (startsWith(headBytes, [0x7f, ...ascii("ELF")])) return "a Linux program";
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some((signature) => startsWith(headBytes, signature))) return "a macOS or Java program";
  if (startsWith(headBytes, ascii("#!"))) return "a shell script";
  if (startsWith(headBytes, [...ascii("PK"), 0x03, 0x04]) || startsWith(headBytes, [...ascii("PK"), 0x05, 0x06]) || startsWith(headBytes, ascii("Rar!")) || startsWith(headBytes, [...ascii("7z"), 0xbc, 0xaf, 0x27, 0x1c]) || startsWith(headBytes, [0x1f, 0x8b])) return "an archive";
  if (startsWith(headBytes, ascii("%PDF"))) return "a PDF";
  return null;
}

/** Each extension this check can open: its family, and whether its first bytes are that format. A format with no mark of its own is judged as text or left as it is. */
const OPENED_FORMATS = {
  png: ["image", (bytes) => startsWith(bytes, [0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a])],
  jpg: ["image", (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff])],
  jpeg: ["image", (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff])],
  webp: ["image", (bytes) => isRiff(bytes, "WEBP")],
  gif: ["image", (bytes) => startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))],
  avif: ["image", isIsoMedia],
  bmp: ["image", (bytes) => startsWith(bytes, ascii("BM"))],
  ico: ["image", (bytes) => startsWith(bytes, [0, 0, 1, 0])],
  tif: ["image", (bytes) => startsWith(bytes, [...ascii("II"), 42, 0]) || startsWith(bytes, [...ascii("MM"), 0, 42])],
  tiff: ["image", (bytes) => startsWith(bytes, [...ascii("II"), 42, 0]) || startsWith(bytes, [...ascii("MM"), 0, 42])],
  psd: ["image", (bytes) => startsWith(bytes, ascii("8BPS"))],
  ktx2: ["image", (bytes) => startsWith(bytes, [0xab, ...ascii("KTX 20"), 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])],
  dds: ["image", (bytes) => startsWith(bytes, ascii("DDS "))],
  hdr: ["image", (bytes) => startsWith(bytes, ascii("#?RADIANCE")) || startsWith(bytes, ascii("#?RGBE"))],
  exr: ["image", (bytes) => startsWith(bytes, [0x76, 0x2f, 0x31, 0x01])],
  ogg: ["sound", (bytes) => startsWith(bytes, ascii("OggS"))],
  oga: ["sound", (bytes) => startsWith(bytes, ascii("OggS"))],
  opus: ["sound", (bytes) => startsWith(bytes, ascii("OggS"))],
  mp3: ["sound", (bytes) => startsWith(bytes, ascii("ID3")) || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)],
  wav: ["sound", (bytes) => isRiff(bytes, "WAVE")],
  flac: ["sound", (bytes) => startsWith(bytes, ascii("fLaC"))],
  m4a: ["sound", isIsoMedia],
  aac: ["sound", (bytes) => isIsoMedia(bytes) || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0)],
  aif: ["sound", (bytes) => startsWith(bytes, ascii("FORM")) && (startsWith(bytes, ascii("AIFF"), 8) || startsWith(bytes, ascii("AIFC"), 8))],
  aiff: ["sound", (bytes) => startsWith(bytes, ascii("FORM")) && (startsWith(bytes, ascii("AIFF"), 8) || startsWith(bytes, ascii("AIFC"), 8))],
  mid: ["sound", (bytes) => startsWith(bytes, ascii("MThd"))],
  midi: ["sound", (bytes) => startsWith(bytes, ascii("MThd"))],
  mp4: ["video", isIsoMedia],
  m4v: ["video", isIsoMedia],
  mov: ["video", isIsoMedia],
  webm: ["video", (bytes) => startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])],
  glb: ["model", (bytes) => startsWith(bytes, ascii("glTF"))],
  vrm: ["model", (bytes) => startsWith(bytes, ascii("glTF"))],
  gltf: ["model", (bytes) => isText(bytes) && textOf(bytes).trimStart().startsWith("{")],
  fbx: ["model", (bytes) => startsWith(bytes, ascii("Kaydara FBX Binary")) || (isText(bytes) && textOf(bytes).trimStart().startsWith(";"))],
  ply: ["model", (bytes) => startsWith(bytes, ascii("ply"))],
  obj: ["model", isText],
  mtl: ["model", isText],
  dae: ["model", (bytes) => isText(bytes) && textOf(bytes).trimStart().startsWith("<")],
  ttf: ["font", (bytes) => startsWith(bytes, [0, 1, 0, 0]) || startsWith(bytes, ascii("true"))],
  otf: ["font", (bytes) => startsWith(bytes, ascii("OTTO"))],
  woff: ["font", (bytes) => startsWith(bytes, ascii("wOFF"))],
  woff2: ["font", (bytes) => startsWith(bytes, ascii("wOF2"))],
  json: ["text", (bytes) => isText(bytes) && /^[\s﻿]*[[{"\-0-9tfn]/.test(textOf(bytes))],
  txt: ["text", isText],
  md: ["text", isText],
  csv: ["text", isText],
  tsv: ["text", isText],
  yaml: ["text", isText],
  yml: ["text", isText],
  toml: ["text", isText],
  ini: ["text", isText],
  xml: ["text", (bytes) => isText(bytes) && textOf(bytes).trimStart().startsWith("<")],
  atlas: ["text", isText],
  fnt: ["text", () => true],
  cube: ["text", isText],
  // Raw numbers a model or a sound bank reads: nothing marks them, and nothing runs them unless they're a program (checked first).
  bin: ["data", () => true],
  stl: ["model", () => true],
};

/** Extensions that are code, or that hold or point at code: scripts, shaders, pages, programs, and engines' own scenes and resources. */
const CODE_EXTENSIONS = {
  "a script": ["js", "mjs", "cjs", "ts", "mts", "jsx", "tsx", "py", "sh", "bash", "zsh", "bat", "cmd", "ps1", "lua", "gd", "cs", "rb", "php", "pl", "c", "h", "cpp", "hpp", "rs", "go", "java", "kt", "swift"],
  "a shader, which runs on the graphics card": ["glsl", "vert", "frag", "wgsl", "hlsl", "shader", "gdshader"],
  "a page or a style sheet, which a browser runs": ["html", "htm", "xhtml", "css"],
  "a program": ["wasm", "exe", "dll", "so", "dylib", "app", "jar", "apk", "msi", "swf"],
  "an engine's own scene or resource, which can point at a script already in the game": ["tscn", "tres", "scn", "res", "pck", "prefab", "unity", "asset", "controller", "unitypackage", "uasset", "umap", "blend"],
  "an archive, which this check can't open": ["zip", "tar", "gz", "tgz", "7z", "rar", "usdz"],
};
const CODE_REASON_BY_EXTENSION = Object.fromEntries(Object.entries(CODE_EXTENSIONS).flatMap(([reason, extensions]) => extensions.map((extension) => [extension, reason])));

const extensionOf = (path) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
};

/** What a file's name says it is, before anything opens it: its family by its extension alone. */
export function fileFamilyOf(path) {
  const extension = extensionOf(path);
  if (CODE_REASON_BY_EXTENSION[extension]) return "code";
  if (extension === "svg") return "image";
  return OPENED_FORMATS[extension]?.[0] ?? "unknown";
}

/** How many of a file's first bytes fileContentsOf needs to judge it: an SVG whole, anything else its head. */
export const neededHeadSizeBytes = (path) => (extensionOf(path) === "svg" ? MAXIMUM_SVG_SIZE_BYTES + 1 : CONTENT_HEAD_SIZE_BYTES);

/**
 * What one file is, from its path and its first bytes (neededHeadSizeBytes of them, or the whole file when it's
 * smaller). Answers { file_family, contents_kind, reason, is_mislabeled }: reason says why it's contains_code,
 * null otherwise; is_mislabeled is true when its bytes aren't what its name says, which no pack may hold.
 */
export function fileContentsOf(path, headBytes) {
  const extension = extensionOf(path);
  const code = (reason, fileFamily = "code") => ({ file_family: fileFamily, contents_kind: "contains_code", reason, is_mislabeled: false });
  const inert = (fileFamily) => ({ file_family: fileFamily, contents_kind: "files_only", reason: null, is_mislabeled: false });
  if (CODE_REASON_BY_EXTENSION[extension]) return code(`It's ${CODE_REASON_BY_EXTENSION[extension]}.`);
  const runnable = RUNNABLE_SIGNATURES.find(({ signature }) => startsWith(headBytes, signature));
  const opened = OPENED_FORMATS[extension];
  // A program or an archive under an inert name is a file that isn't what it says.
  if (runnable && opened) return { file_family: "code", contents_kind: "contains_code", reason: `It's named .${extension}, and it's ${runnable.what}.`, is_mislabeled: true };
  if (runnable) return code(`It's ${runnable.what}.`);
  if (extension === "svg") {
    if (headBytes.length > MAXIMUM_SVG_SIZE_BYTES) return code(`It's an SVG over ${MAXIMUM_SVG_SIZE_BYTES / 1024 / 1024} MB, too big to read for a script.`, "image");
    if (!isText(headBytes) || !/<svg[\s>]/i.test(textOf(headBytes))) return { file_family: "unknown", contents_kind: "contains_code", reason: "It's named .svg, and it isn't an SVG.", is_mislabeled: true };
    return /<script|<foreignObject|\son[a-z]+\s*=|javascript:/i.test(textOf(headBytes)) ? code("It's an SVG with a script in it.", "image") : inert("image");
  }
  if (!opened) return code(extension ? `Zaisma can't see through a .${extension} file.` : "It has no extension, so Zaisma can't tell what it is.", "unknown");
  const [fileFamily, isThatFormat] = opened;
  if (headBytes.length > 0 && !isThatFormat(headBytes)) return { file_family: "unknown", contents_kind: "contains_code", reason: `It's named .${extension}, and its bytes aren't ${/^[aeiou]/.test(fileFamily) ? "an" : "a"} ${fileFamily} of that format.`, is_mislabeled: true };
  return inert(fileFamily);
}

/** A pack's or a preset's mark, from its files' answers: files_only only when every one is. */
export const contentsKindOf = (fileAnswers) => (fileAnswers.every((answer) => answer.contents_kind === "files_only") ? "files_only" : "contains_code");
