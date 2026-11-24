// Zaisma's fixed checks: what every upload passes before it can go live, the same answer every time. The upload's scan,
// the API's check_game and `zaisma check` all run this one list. MIT licensed.
//
// The checks are a list that grows: a new check is one more entry in FIXED_CHECKS, and changing one touches no other.
// A refusal ("reject") is something a game can't do and the sandbox can't stop while it runs; a note ("info") is
// something the sandbox already stops, so the game only bumps into it and is told how to fix it.
import { tokenizer } from "acorn";

/** Words only crypto-mining code carries: miner scripts and services, pool addresses, the CryptoNight hash. */
export const MINER_PATTERN = /coinhive|coin-hive|cryptonight|cryptoloot|webminepool|deepminer|coinimp|minero\.cc|stratum\+(tcp|ssl):\/\/|xmr-?stak|monero[-_ ]?miner|webmr\.js|crypta\.js/i;

/** Function names only a cryptocurrency miner's WebAssembly has (CryptoNight, RandomX). No \b: Emscripten prefixes C names with "_". */
const MINER_MODULE_PATTERN = /(?<![A-Za-z0-9])(?:randomx_(?:alloc_cache|init_cache|create_vm|calculate_hash(?:_first|_next)?)|cn_slow_hash|cn_fast_hash|cryptonight_hash)(?![A-Za-z0-9])/i;

const HTML = /\.(html?|svg)$/i;
const SCRIPT = /\.(m?js|cjs)$/i;

/** Hosts that appear in nearly every file and never load anything. */
export const IGNORED_HOSTS = new Set(["www.w3.org", "w3.org", "schemas.xmlsoap.org", "ns.adobe.com", "purl.org", "xmlns.com", "localhost", "127.0.0.1"]);
/** Hosts a game may connect to without listing them. */
const ROOMS_HOST = "rooms.zaisma.com";
const URL_PATTERN = /(?:https?:|wss?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?=[/"'`?#\s)]|$)/gi;
/** A link opened with window.open or a new-tab link; the registered way is Zaisma.links.open. */
const UNREGISTERED_LINK_PATTERN =
  /\bwindow\.open\(\s*["'`](?:https?:)?\/\/[a-z0-9]|<a\b[^>]*\btarget\s*=\s*["']?_blank[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\/[a-z0-9]|<a\b[^>]*\bhref\s*=\s*["']?(?:https?:)?\/\/[a-z0-9][^>]*\btarget\s*=\s*["']?_blank/i;
/** A connection written out in full: fetch, WebSocket, EventSource, sendBeacon or XMLHttpRequest to an absolute address. */
const LITERAL_CONNECTION_PATTERN = /(?:\bfetch|new\s+WebSocket|new\s+EventSource|\bsendBeacon)\(\s*["'`](?:https?|wss?):\/\/([a-z0-9.-]+)|\.open\(\s*["'`][A-Za-z]{3,7}["'`]\s*,\s*["'`]https?:\/\/([a-z0-9.-]+)/gi;

// ---- Scripts as tokens -------------------------------------------------------------------------------------------

/**
 * The longest script read as tokens; a longer one is read only by the text checks (the packer's shape, a password
 * field in HTML). 5 MB of minified code reads in under half a second within 100 MB of memory; 11 MB doesn't fit a
 * Worker's 128. Engines split their code across files well under this.
 */
const MAXIMUM_TOKENIZED_CHARACTER_COUNT = 5_000_000;
const TOKENIZER_OPTIONS = { ecmaVersion: "latest", allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true };

/** The scripts in a file: the whole file for a script, each inline <script> for a page. */
function scriptsOf(file) {
  if (SCRIPT.test(file.path)) return [{ text: file.text, offset: 0 }];
  if (!/\.html?$/i.test(file.path)) return [];
  return [...file.text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => ({ text: match[1], offset: match.index + match[0].indexOf(match[1]) }));
}

/** A script's tokens, or null when acorn can't read it or it's very long. Kept per file, since two checks read them. */
const tokenCache = new WeakMap();
/**
 * A script's tokens, kept compact: a label number, a start and (for names and strings) a value each, so a minified
 * bundle's hundreds of thousands of tokens take a few megabytes, not hundreds, in a Worker's 128.
 */
class CompactTokens {
  constructor(text) {
    const labelNumbers = [];
    const starts = [];
    this.values = [];
    this.labels = [];
    const labelIndexes = new Map();
    for (const token of tokenizer(text, TOKENIZER_OPTIONS)) {
      const tokenLabel = token.type.label;
      if (!labelIndexes.has(tokenLabel)) {
        labelIndexes.set(tokenLabel, this.labels.length);
        this.labels.push(tokenLabel);
      }
      const index = labelNumbers.length;
      labelNumbers.push(labelIndexes.get(tokenLabel));
      starts.push(token.start);
      if (tokenLabel === "name" || tokenLabel === "string" || tokenLabel === "template" || tokenLabel === "+/-") this.values[index] = token.value;
    }
    this.labelNumbers = Uint16Array.from(labelNumbers);
    this.starts = Int32Array.from(starts);
    this.length = this.labelNumbers.length;
  }
  labelAt(index) {
    return index >= 0 && index < this.length ? this.labels[this.labelNumbers[index]] : undefined;
  }
  valueAt(index) {
    return this.values[index];
  }
  startAt(index) {
    return this.starts[index];
  }
}
function tokensOf(script) {
  if (script.text.length > MAXIMUM_TOKENIZED_CHARACTER_COUNT) return null;
  try {
    return new CompactTokens(script.text);
  } catch {
    return null;
  }
}
function scriptTokens(file) {
  if (!tokenCache.has(file)) tokenCache.set(file, scriptsOf(file).map((script) => ({ ...script, tokens: tokensOf(script) })));
  return tokenCache.get(file);
}

/** What turns text back into something else: base64, character codes, bytes, escapes. */
const DECODERS = new Set(["atob", "fromCharCode", "fromCodePoint", "TextDecoder", "unescape", "decodeURIComponent", "decodeURI"]);
const DECODER_WORD_PATTERN = /\b(atob|fromCharCode|fromCodePoint|TextDecoder|unescape|decodeURIComponent|decodeURI)\b/;
/** What runs text as code. */
const RUNNERS = new Set(["eval", "Function"]);

/**
 * Where a script runs text it decoded: eval, an indirect eval or the Function constructor (or a name given either)
 * called on a decoder's output, directly or through a name whose latest assignment in scope holds one. Decoders
 * inside a nested block (a function's body, an object) don't count, so a library's decoding helpers never taint the
 * names around them. Answers the token index of the runner, or -1. Engines run code they load as files (Godot's
 * JavaScript bridge, Phaser's scene files): that's code in the upload, checked like the rest, and never flagged.
 */
function decodedRunIndex(tokens) {
  const label = (index) => tokens.labelAt(index);
  const nestingLevels = new Int32Array(tokens.length + 1);
  // Where the block each token is in ends, found in one pass: a minified bundle has hundreds of thousands of tokens.
  const blockEnds = new Int32Array(tokens.length + 1).fill(tokens.length);
  const openBlocks = [];
  const openedAt = new Int32Array(tokens.length + 1).fill(-1);
  for (let index = 0, nestingLevel = 0; index < tokens.length; index++) {
    nestingLevels[index] = nestingLevel;
    openedAt[index] = openBlocks.length ? openBlocks[openBlocks.length - 1] : -1;
    const tokenLabel = label(index);
    if (tokenLabel === "{" || tokenLabel === "${") {
      nestingLevel++;
      openBlocks.push(index);
    } else if (tokenLabel === "}") {
      nestingLevel--;
      const openIndex = openBlocks.pop();
      if (openIndex !== undefined) blockEnds[openIndex] = index;
    }
  }
  /** Where the expression starting at startIndex ends: at a , ; or closing bracket on its own level. */
  const expressionEnd = (startIndex) => {
    let nestingLevel = 0;
    for (let index = startIndex; index < tokens.length; index++) {
      const tokenLabel = label(index);
      if (tokenLabel === "(" || tokenLabel === "[" || tokenLabel === "{" || tokenLabel === "${") nestingLevel++;
      else if (tokenLabel === ")" || tokenLabel === "]" || tokenLabel === "}") {
        if (nestingLevel === 0) return index;
        nestingLevel--;
      } else if ((tokenLabel === ";" || tokenLabel === ",") && nestingLevel === 0) return index;
    }
    return tokens.length;
  };
  const blockEnd = (index) => (openedAt[index] === -1 ? tokens.length : blockEnds[openedAt[index]]);
  /** Each name's assignments in order: what it holds ("runner", "decoded", "plain") and where that holds. */
  const assignmentsByName = new Map();
  /** Names ever given a runner or decoded text: only these are looked up, so a minified bundle's thousands of one-letter names cost nothing. */
  const taintedNames = new Set();
  const holds = (name, kind, atIndex) => {
    if (!taintedNames.has(name)) return false;
    const assignments = assignmentsByName.get(name) ?? [];
    // Assignments are in token order: the last before atIndex, then back over ones whose block has ended, a few at most.
    let lowIndex = 0;
    let highIndex = assignments.length;
    while (lowIndex < highIndex) {
      const middleIndex = (lowIndex + highIndex) >> 1;
      if (assignments[middleIndex].fromIndex < atIndex) lowIndex = middleIndex + 1;
      else highIndex = middleIndex;
    }
    for (let index = lowIndex - 1, lookedCount = 0; index >= 0 && lookedCount < 64; index--, lookedCount++) {
      if (atIndex < assignments[index].untilIndex) return assignments[index].kind === kind;
    }
    return false;
  };
  const hasDecoded = (startIndex, endIndex) => {
    for (let index = startIndex; index < endIndex; index++) {
      if (nestingLevels[index] !== nestingLevels[startIndex] || label(index) !== "name") continue;
      if (DECODERS.has(tokens.valueAt(index)) || holds(tokens.valueAt(index), "decoded", index)) return true;
    }
    return false;
  };
  for (let index = 0; index < tokens.length; index++) {
    if (label(index) !== "name" || label(index + 1) !== "=" || label(index - 1) === ".") continue;
    const endIndex = expressionEnd(index + 2);
    const kind = endIndex === index + 3 && label(index + 2) === "name" && RUNNERS.has(tokens.valueAt(index + 2)) ? "runner" : hasDecoded(index + 2, endIndex) ? "decoded" : "plain";
    const name = tokens.valueAt(index);
    if (kind !== "plain") taintedNames.add(name);
    if (!assignmentsByName.has(name)) assignmentsByName.set(name, []);
    assignmentsByName.get(name).push({ kind, fromIndex: index, untilIndex: blockEnd(index) });
  }
  for (let index = 0; index < tokens.length; index++) {
    if (label(index) !== "name") continue;
    const name = tokens.valueAt(index);
    if (!RUNNERS.has(name) && !holds(name, "runner", index)) continue;
    if (label(index - 1) === "." && name !== "eval") continue;
    // (0, eval)(text) closes its group before the call.
    const callIndex = label(index + 1) === ")" ? index + 2 : index + 1;
    if (label(callIndex) !== "(") continue;
    if (hasDecoded(callIndex + 1, expressionEnd(callIndex + 1))) return index;
  }
  return -1;
}

/** The packer's own shape (eval(function(p,a,c,k,e,…)) and eval of a decoder's output written in one go. */
const PACKED_PATTERN = /eval\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,|\beval\(\s*(atob|unescape|decodeURIComponent|String\.fromCharCode)\s*\(|new\s+Function\(\s*atob\s*\(/;

/** A script's string literals joined where it adds them up ("pass" + "word"), with where each joined run starts. */
function joinedStrings(tokens) {
  const joined = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens.labelAt(index) !== "string" && tokens.labelAt(index) !== "template") continue;
    let text = String(tokens.valueAt(index) ?? "");
    const startIndex = index;
    while (tokens.labelAt(index + 1) === "+/-" && tokens.valueAt(index + 1) === "+" && tokens.labelAt(index + 2) === "string") {
      text += tokens.valueAt(index + 2);
      index += 2;
    }
    joined.push({ text, tokenIndex: startIndex });
  }
  return joined;
}

// ---- WebAssembly -------------------------------------------------------------------------------------------------

/** A module as embedded in a script: base64 starting with "\0asm" version 1, or a list of its byte values. */
const EMBEDDED_WASM_PATTERN = /AGFzbQEAAAA[A-Za-z0-9+/]{8,}={0,2}/g;
const EMBEDDED_WASM_BYTE_LIST_PATTERN = /\b0\s*,\s*97\s*,\s*115\s*,\s*109\s*,\s*1\s*,\s*0\s*,\s*0\s*,\s*0(?:\s*,\s*\d{1,3})+/g;
/** Bytes searched for miner words at a time, and how much each piece repeats from the one before so no word is cut in half. */
export const MINER_SEARCH_PIECE_SIZE_BYTES = 1_048_576;
export const MINER_SEARCH_OVERLAP_SIZE_BYTES = 256;

/** Whether a piece of a module's bytes (or a whole small module) carries what a miner carries: its names, its strings. */
export function isMinerPiece(bytes) {
  let pieceText = "";
  for (let index = 0; index < bytes.length; index += 0x8000) pieceText += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return MINER_PATTERN.test(pieceText) || MINER_MODULE_PATTERN.test(pieceText);
}

/** Whether a whole module's bytes carry a miner, searched a piece at a time so a big module never becomes one big string. */
export function isMinerModule(bytes) {
  for (let startIndex = 0; startIndex < bytes.length; startIndex += MINER_SEARCH_PIECE_SIZE_BYTES) {
    if (isMinerPiece(bytes.subarray(Math.max(0, startIndex - MINER_SEARCH_OVERLAP_SIZE_BYTES), startIndex + MINER_SEARCH_PIECE_SIZE_BYTES))) return true;
  }
  return false;
}

class ByteReader {
  constructor(bytes, byteIndex) {
    this.bytes = bytes;
    this.byteIndex = byteIndex;
  }
  byte() {
    if (this.byteIndex >= this.bytes.length) throw new RangeError("past the end");
    return this.bytes[this.byteIndex++];
  }
  unsignedNumber() {
    let valueNumber = 0;
    let shiftBitCount = 0;
    for (;;) {
      const nextByteNumber = this.byte();
      valueNumber += (nextByteNumber & 0x7f) * 2 ** shiftBitCount;
      if ((nextByteNumber & 0x80) === 0) return valueNumber;
      shiftBitCount += 7;
      if (shiftBitCount > 63) throw new RangeError("number too long");
    }
  }
  skipName() {
    const nameLengthBytes = this.unsignedNumber();
    if (this.byteIndex + nameLengthBytes > this.bytes.length) throw new RangeError("past the end");
    this.byteIndex += nameLengthBytes;
  }
  limits() {
    const limitsFlagNumber = this.byte();
    this.unsignedNumber();
    if (limitsFlagNumber & 0x01) this.unsignedNumber();
  }
}

/**
 * Whether bytes are a well-formed module with code: the "\0asm" version 1 header, known sections only, each standard
 * one once and in order, imports and exports read to exactly their section's end, and a code section.
 */
export function isWasmModule(bytes) {
  if (bytes.length < 8 || [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00].some((byteNumber, byteIndex) => bytes[byteIndex] !== byteNumber)) return false;
  let lastSectionOrderNumber = 0;
  let hasCode = false;
  const reader = new ByteReader(bytes, 8);
  try {
    while (reader.byteIndex < bytes.length) {
      const sectionIdNumber = reader.byte();
      const sectionSizeBytes = reader.unsignedNumber();
      const sectionEndIndex = reader.byteIndex + sectionSizeBytes;
      if (sectionEndIndex > bytes.length || sectionIdNumber > 13) return false;
      if (sectionIdNumber !== 0) {
        // The data count section (12) comes just before code (10), the tag section (13) between memory (5) and globals (6).
        const sectionOrderNumber = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 11, 6][sectionIdNumber];
        if (sectionOrderNumber <= lastSectionOrderNumber) return false;
        lastSectionOrderNumber = sectionOrderNumber;
      }
      if (sectionIdNumber === 0) {
        reader.skipName();
        if (reader.byteIndex > sectionEndIndex) return false;
      } else if (sectionIdNumber === 2) {
        const importCount = reader.unsignedNumber();
        for (let importIndex = 0; importIndex < importCount; importIndex++) {
          reader.skipName();
          reader.skipName();
          const importKindNumber = reader.byte();
          if (importKindNumber === 0x00) reader.unsignedNumber();
          else if (importKindNumber === 0x01) {
            reader.byte();
            reader.limits();
          } else if (importKindNumber === 0x02) reader.limits();
          else if (importKindNumber === 0x03) {
            reader.byte();
            reader.byte();
          } else if (importKindNumber === 0x04) {
            reader.byte();
            reader.unsignedNumber();
          } else return false;
        }
        if (reader.byteIndex !== sectionEndIndex) return false;
      } else if (sectionIdNumber === 7) {
        const exportCount = reader.unsignedNumber();
        for (let exportIndex = 0; exportIndex < exportCount; exportIndex++) {
          reader.skipName();
          reader.byte();
          reader.unsignedNumber();
        }
        if (reader.byteIndex !== sectionEndIndex) return false;
      } else if (sectionIdNumber === 10) {
        hasCode = reader.unsignedNumber() > 0;
      }
      reader.byteIndex = sectionEndIndex;
    }
  } catch {
    return false;
  }
  return hasCode;
}

const decodeBase64 = (text) => {
  try {
    const binary = atob(text.endsWith("=") ? text : text.slice(0, text.length - (text.length % 4)));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
};
const decodeByteList = (text) => {
  const byteNumbers = text.split(",").map((part) => Number(part.trim()));
  return byteNumbers.every((byteNumber) => byteNumber <= 255) ? Uint8Array.from(byteNumbers) : undefined;
};

/** Every WebAssembly module embedded in a file's text that decodes to a well-formed module, each with where it starts and whether it's a miner's. */
export function embeddedWasmModules(text) {
  const modules = [];
  const read = (match, bytes) => {
    if (bytes && isWasmModule(bytes)) modules.push({ index: match.index, isMinerLike: isMinerModule(bytes) });
  };
  for (const match of text.matchAll(EMBEDDED_WASM_PATTERN)) read(match, decodeBase64(match[0]));
  for (const match of text.matchAll(EMBEDDED_WASM_BYTE_LIST_PATTERN)) read(match, decodeByteList(match[0]));
  return modules;
}

// ---- The checks --------------------------------------------------------------------------------------------------

/** A text field a player types into: in a page, or made by script. */
const TEXT_FIELD_PATTERN = /<(?:input|textarea)\b|createElement\(\s*["'`](?:input|textarea)["'`]|\bprompt\(/i;
/** Asking for what opens a crypto wallet: its seed or recovery phrase, or a private key. */
const WALLET_SECRET_PATTERN = /\b(?:seed|recovery|mnemonic)[ -](?:phrase|words)\b|\b(?:12|24)[ -]word (?:seed|recovery|phrase|backup)\b|\bprivate key\b/gi;
/** How near a text field has to be to the words that ask for a wallet's secret: the same form, not anywhere in a bundle. */
const WALLET_FIELD_NEARBY_CHARACTER_COUNT = 600;
/** Asking a browser wallet other than Bitcoin's for access (Ethereum's, Solana's, WalletConnect). */
const WALLET_ACCESS_PATTERN = /\bethereum\.(?:request|enable|send(?:Async)?)\s*\(|["'`]eth_(?:requestAccounts|sendTransaction|sign(?:TypedData(?:_v\d)?)?)["'`]|\bpersonal_sign\b|\bsolana\.(?:connect|signTransaction|signAllTransactions|signAndSendTransaction)\s*\(|@walletconnect\/|\bWalletConnect(?:Modal|Provider|Connector)\b/;
/** A password field set by script, once added-up strings are joined. */
const SCRIPT_PASSWORD_PATTERN = /^password$/i;

/**
 * The fixed checks, one entry each. Each reads the files whose path matches `only` (every text file when it has none)
 * and answers where in the file it found what it looks for, or null. A finding's severity is the entry's.
 */
export const FIXED_CHECKS = [
  {
    code: "crypto_miner",
    severity: "reject",
    message: "Contains crypto-mining code.",
    find: (file) => MINER_PATTERN.exec(file.text)?.index ?? null,
  },
  {
    code: "crypto_miner",
    severity: "reject",
    message: "Embeds a WebAssembly module with crypto-mining code.",
    find: (file) => embeddedWasmModules(file.text).find((embedded) => embedded.isMinerLike)?.index ?? null,
  },
  {
    code: "disguised_code",
    severity: "reject",
    message: "Runs code it decodes from other text (base64, character codes or bytes), which hides what it runs.",
    find: (file) => {
      const packed = PACKED_PATTERN.exec(file.text);
      if (packed) return packed.index;
      // Only a file with both a runner and a decoder in it is read token by token.
      if (!/\b(eval|Function)\b/.test(file.text) || !DECODER_WORD_PATTERN.test(file.text)) return null;
      for (const script of scriptTokens(file)) {
        if (!script.tokens) continue;
        const runIndex = decodedRunIndex(script.tokens);
        if (runIndex !== -1) return script.offset + script.tokens.startAt(runIndex);
      }
      return null;
    },
  },
  {
    code: "password_field",
    severity: "reject",
    message: "Has a password field. Games don't need one, and phishing pages do.",
    find: (file) => {
      if (HTML.test(file.path)) {
        const field = /<input[^>]*type\s*=\s*["']?password/i.exec(file.text);
        if (field) return field.index;
      }
      // Only a file that says password, or adds up short strings that could spell it, is read token by token.
      if (!/password|["'`][a-z]{0,7}["'`]\s*\+\s*["'`]/i.test(file.text)) return null;
      for (const script of scriptTokens(file)) {
        if (!script.tokens) continue;
        // Every input type the script sets, and where it sets a password one: .type = "password",
        // setAttribute("type", "password"), { type: "password" }.
        const setTypes = new Set();
        let typeSetAtIndex = -1;
        for (const { text, tokenIndex } of joinedStrings(script.tokens)) {
          const before = Array.from({ length: Math.min(4, tokenIndex) }, (_, offsetIndex) => tokenIndex - Math.min(4, tokenIndex) + offsetIndex).map((index) => String(script.tokens.valueAt(index) ?? script.tokens.labelAt(index))).join(" ");
          if (!/\btype\s+=$|\btype\s+:$|setAttribute\s+\(\s+type\s+,$/.test(before)) continue;
          setTypes.add(text.toLowerCase());
          if (SCRIPT_PASSWORD_PATTERN.test(text) && typeSetAtIndex === -1) typeSetAtIndex = tokenIndex;
        }
        // An engine's text input that takes whatever kind its game's field asks for (Godot's keyboard sets text, email,
        // tel, url and password in turn) is the engine's, not a field the game shows.
        const isInputTypeMapper = ["email", "tel", "url", "number", "search"].filter((type) => setTypes.has(type)).length >= 2;
        if (typeSetAtIndex !== -1 && !isInputTypeMapper) return script.offset + script.tokens.startAt(typeSetAtIndex);
      }
      return null;
    },
  },
  {
    code: "wallet_request",
    severity: "reject",
    message: "Asks players for a crypto wallet's seed phrase or private key, or for access to a wallet other than Bitcoin's.",
    find: (file) => {
      const access = WALLET_ACCESS_PATTERN.exec(file.text);
      if (access) return access.index;
      for (const secret of file.text.matchAll(WALLET_SECRET_PATTERN)) {
        const nearby = file.text.slice(Math.max(0, secret.index - WALLET_FIELD_NEARBY_CHARACTER_COUNT), secret.index + WALLET_FIELD_NEARBY_CHARACTER_COUNT);
        if (TEXT_FIELD_PATTERN.test(nearby)) return secret.index;
      }
      return null;
    },
  },
  // Notes: the sandbox stops these while the game runs, so the game only bumps into them.
  {
    code: "top_navigation",
    severity: "info",
    message: "Tries to change the page outside the game (top or parent window location), which the game's frame stops.",
    find: (file) => /\b(window\.)?(top|parent)\.location(\.href)?\s*=(?!=)|\b(window\.)?(top|parent)\.location\.(replace|assign)\s*\(/.exec(file.text)?.index ?? null,
  },
  {
    code: "relay_bypass",
    severity: "info",
    message: "Makes a WebRTC connection from a frame of its own; Zaisma's relay still carries it, so players never see each other's internet address.",
    find: (file) =>
      /(\bcontentWindow|\bdefaultView|\b(window|self|top|parent|globalThis|frames)\s*\[\s*\d+\s*\])\s*(\.\s*|\[\s*["'`])(webkit)?RTCPeerConnection|\bsrcdoc\b[\s\S]{0,2000}RTCPeerConnection|RTCPeerConnection[\s\S]{0,2000}\bsrcdoc\b/.exec(file.text)?.index ?? null,
  },
  {
    code: "external_form",
    severity: "info",
    message: "Has a form that would send to another site, which the game's security policy stops.",
    only: HTML,
    find: (file) => /<form[^>]*action\s*=\s*["']?(https?:)?\/\//i.exec(file.text)?.index ?? null,
  },
  {
    code: "svg_script",
    severity: "info",
    message: "An SVG image contains script.",
    only: /\.svg$/i,
    find: (file) => /<script/i.exec(file.text)?.index ?? null,
  },
];

/**
 * Every fixed check on a game's text files ({ path, text }), plus the notes about links and addresses (once per
 * version, at the first file that has each). `ownServerHosts`: the game's own servers' hosts, lowercase. Answers
 * { findings: [{ stage: "static", severity, code, message, path, quote }], outsideHosts }.
 */
export function runFixedChecks(files, ownServerHosts = []) {
  const findings = [];
  const hosts = new Set();
  const quoteAt = (text, index) => text.slice(Math.max(0, index - 60), index + 140).replace(/\s+/g, " ").trim();
  for (const file of files) {
    for (const check of FIXED_CHECKS) {
      if (check.only && !check.only.test(file.path)) continue;
      if (findings.some((finding) => finding.code === check.code && finding.path === file.path)) continue;
      const index = check.find(file);
      if (index !== null) findings.push({ stage: "static", severity: check.severity, code: check.code, message: check.message, path: file.path, quote: quoteAt(file.text, index) });
    }
    if (!findings.some((finding) => finding.code === "unregistered_link") && UNREGISTERED_LINK_PATTERN.test(file.text)) {
      findings.push({ stage: "static", severity: "info", code: "unregistered_link", message: "Opens a site with window.open or a new-tab link.", path: file.path });
    }
    const unlistedHost = findings.some((finding) => finding.code === "unlisted_address")
      ? undefined
      : [...file.text.matchAll(LITERAL_CONNECTION_PATTERN)].map((match) => (match[1] ?? match[2]).toLowerCase()).find((host) => host !== ROOMS_HOST && !IGNORED_HOSTS.has(host) && !ownServerHosts.includes(host));
    if (unlistedHost) findings.push({ stage: "static", severity: "info", code: "unlisted_address", message: `Connects to ${unlistedHost}, which isn't Zaisma rooms or one of the game's own servers.`, path: file.path });
    for (const match of file.text.matchAll(URL_PATTERN)) {
      const host = match[1].toLowerCase();
      // Skip version-like numbers and file names that look like hosts ("three.min.js").
      if (/^[\d.]+$/.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;
      if (/\.(js|mjs|css|png|jpg|json|html|wasm|map)$/i.test(host) || IGNORED_HOSTS.has(host)) continue;
      hosts.add(host);
    }
  }
  const outsideHosts = [...hosts].sort().slice(0, 100);
  if (outsideHosts.length > 0) {
    findings.push({
      stage: "static",
      severity: "info",
      code: "outside_hosts",
      message: `Names ${outsideHosts.length} outside site(s), in its code or comments. A game on Zaisma loads only its own files and connects only to Zaisma rooms and its own servers; zaisma check lists anything that won't work.`,
    });
  }
  return { findings, outsideHosts };
}

/** The fixed checks on a WebAssembly file's bytes (or a piece of them, searched with overlap by the caller): a miner's module is refused. */
export function wasmFileFindings(path, bytes) {
  return isMinerModule(bytes) ? [{ stage: "static", severity: "reject", code: "crypto_miner", message: "A WebAssembly file carries crypto-mining code.", path }] : [];
}

/** The codes a fixed check can refuse a version for. */
export const REFUSING_CHECK_CODES = [...new Set(FIXED_CHECKS.filter((check) => check.severity === "reject").map((check) => check.code))];
