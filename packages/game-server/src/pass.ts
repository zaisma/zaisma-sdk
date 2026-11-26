/**
 * Player passes: standard JWTs signed with Ed25519 (EdDSA). Our rooms check them,
 * and so can any developer's own server, using its game's keys, published at
 * /v1/pass-keys/<gameSlug>. Any JWT library that supports EdDSA works.
 */

/**
 * What a pass proves: who the player is, for which game, until when. Nothing more; anything else
 * about an account (its name) comes from its public profile, <issuer>/v1/players/<id>. A game that
 * needs accounts gives guests no pass at all. Fields can be added within v1; none is removed.
 */
export interface PassClaims {
  /** Player ID. An account's is the same in every game; a guest's is random and only valid for this pass. */
  sub: string;
  /** A guest's generated name. Account passes carry none. */
  name?: string;
  /** The game's slug: a pass only works for the game it was issued for. */
  aud: string;
  /** Who made it: https://rooms.zaisma.com (PASS_ISSUER_URL) on zaisma.com. */
  iss: string;
  /** The pass contract it follows: 1. verifyPass refuses a number it doesn't know (wrong_version). */
  pass_version_number: number;
  /** guest or account, or a kind added later: treat one your server doesn't know as a guest. */
  kind: PlayerKind | (string & {});
  /**
   * v1's chat setting, still sent for servers that don't read who_reads_my_chat: a stricter stand-in for it
   * (nobody when the account's chat is stopped or it reads no chat, friends for Friends, anyone otherwise),
   * read by canChat only on a pass without who_reads_my_chat. Guests' passes have none: guests don't chat.
   */
  who_can_chat?: WhoCanChat | (string & {});
  /**
   * Who reads what this account types: its friends in its chat group, anyone in its chat group, everyone, or
   * nobody while its chat is stopped; a choice added later reaches nobody. Guests' passes have none.
   */
  who_reads_my_chat?: WhoReadsMyChat | "nobody" | (string & {});
  /** Whether this account reads others' chat at all: false when the player turned it off. Guests' passes have none. */
  chat_reading_enabled?: boolean;
  /**
   * Who hears this account talk, in games with voice: the same choices and the same narrowing as who_reads_my_chat
   * (nobody while its chat is stopped). A pass without it is heard as far as it's read (canVoiceChat). Guests' passes have none.
   */
  who_hears_my_voice?: WhoReadsMyChat | "nobody" | (string & {});
  /** Whether this account hears others talk at all: false when the player turned it off. Guests' passes have none. */
  voice_hearing_enabled?: boolean;
  /**
   * The player's network, sealed for Zaisma alone with a fresh nonce on every pass: it says nothing to your
   * server, and two seals of one network look nothing alike. Zaisma's chat check opens it for the witness rule
   * (anyone under 18 types only where two independent players read it). Pass it on as it is, in the pass.
   */
  network_seal?: string;
  /**
   * An account's chat group (chat_group_…): Friends and My age band reach only the same group, and only a
   * sender who chose Everyone crosses it. Opaque and different in every game, so it never says an age; a game
   * could guess which group is the younger one from its size.
   */
  chat_group_id?: string;
  /**
   * An account's own player tag in this game (player_tag_…): opaque, and different in every game, so
   * it says nothing outside it. Other passes list it to say they're friends (friend_player_tag_ids) or
   * have a block (block_player_tag_ids). Guests' passes have none.
   */
  player_tag_id?: string;
  /**
   * The player tags of an account's friends, up to 200, as they were when the pass was made: never
   * their player IDs, so a game learns only which of its own players are friends, by their passes
   * (passesAreFriends). Friends are always two-way, so passesAreFriends asks both passes. Guests'
   * passes have none.
   */
  friend_player_tag_ids?: string[];
  /**
   * The player tags of the accounts this one has a block with, either way, newest first and up to 100,
   * as they were when the pass was made. Never says who made a block, and means nothing without the
   * other player's pass: two players have a block between them when either pass lists the other's
   * player_tag_id (passesHaveBlockBetween).
   */
  block_player_tag_ids?: string[];
  /**
   * The permanent items an account owns in this game (bought or granted, not refunded), by item_name, as
   * they were when the pass was made: [] for guests and when the player owns nothing here. Consumables are
   * never listed: they're delivered once and then they're the game's to count.
   */
  owned_item_names: string[];
  iat: number;
  exp: number;
}

/**
 * A signed-in Zaisma account, a guest, or a player from outside Zaisma (outside_zaisma): one your own server let
 * in without a Zaisma pass, by its identifyPlayer (signed in with Zaisma, or your game's own accounts) or as a
 * guest from elsewhere (outsideGuestsEnabled). Zaisma's rooms and passes never give outside_zaisma.
 */
export type PlayerKind = "guest" | "account" | "outside_zaisma";

/** v1's chat setting: no chat, friends only, or anyone in the same chat group, both ways. who_reads_my_chat replaces it. */
export type WhoCanChat = "nobody" | "friends" | "anyone";

/** Who reads what a player types: friends in their chat group, anyone in it, or everyone (the only choice that crosses chat groups). */
export type WhoReadsMyChat = "friends" | "my_age_band" | "everyone";

/** How far one side of chat reaches: a sender's who_reads_my_chat, or whose chat a reader reads. */
export type ChatReach = "nobody" | "friends" | "my_age_band" | "everyone";

/**
 * How far a pass's chat reaches, sending and reading. A pass with who_reads_my_chat says so directly (and reads
 * everyone's chat unless chat_reading_enabled is false); a v1 pass's who_can_chat counts for both sides, as v1's
 * two-way rule did (friends: friends; anyone: the chat group). Guests and unknown choices reach nobody.
 */
export function chatReachOf(claims: Pick<PassClaims, "kind" | "who_can_chat" | "who_reads_my_chat" | "chat_reading_enabled">): { sending: ChatReach; reading: ChatReach } {
  if (claims.kind !== "account") return { sending: "nobody", reading: "nobody" };
  if (claims.who_reads_my_chat !== undefined) {
    const sending = (["friends", "my_age_band", "everyone"] as const).find((reach) => reach === claims.who_reads_my_chat) ?? "nobody";
    return { sending, reading: claims.chat_reading_enabled === false ? "nobody" : "everyone" };
  }
  const reach: ChatReach = claims.who_can_chat === "friends" ? "friends" : claims.who_can_chat === "anyone" ? "my_age_band" : "nobody";
  return { sending: reach, reading: reach };
}

/** Whether one side's reach takes in the other player: everyone; the same chat group; or a friend in it. */
export function isWithinChatReach(reach: ChatReach, other: { isSameChatGroup: boolean; isFriend: boolean }): boolean {
  if (reach === "everyone") return true;
  if (reach === "my_age_band") return other.isSameChatGroup;
  return reach === "friends" && other.isSameChatGroup && other.isFriend;
}

/** A pass's JWS header typ (RFC 8725 explicit typing): verifyPass refuses any other token (wrong_kind). */
export const PASS_TOKEN_TYPE = "pass+jwt";

/** The pass contract this copy reads: verifyPass refuses any other pass_version_number (wrong_version). */
export const PASS_VERSION_NUMBER = 1;

/** Zaisma's pass issuer: verifyPass expects it unless told another (a local preview of Zaisma). */
export const PASS_ISSUER_URL = "https://rooms.zaisma.com";

/** The pass helpers take passes verifyPass checked: anything else is a mistake in the server's code, not a player's. */
function mustBePasses(first: PassClaims, second: PassClaims, helper: string): void {
  for (const pass of [first, second]) {
    if (!pass || typeof pass !== "object" || typeof pass.sub !== "string") throw new TypeError(`${helper} takes two passes' claims, as verifyPass answered them.`);
  }
}

/**
 * Whether two players have a block between them, by the passes your server checked (verifyPass): either
 * one blocked the other, which neither pass says. A block is a wall both ways: deliver nothing from one
 * to the other (chat, voice, emotes) and don't match them together when you can help it, but never keep
 * either out of a room. A new block reaches your server with the blocker's next pass, and the blocker's
 * game also tells the room ({ type: "block", playerId }), which room.hasBlockBetween covers.
 */
export function passesHaveBlockBetween(first: PassClaims, second: PassClaims): boolean {
  mustBePasses(first, second, "passesHaveBlockBetween");
  if (first.sub === second.sub) return false;
  const lists = (pass: PassClaims, other: PassClaims) => typeof other.player_tag_id === "string" && Array.isArray(pass.block_player_tag_ids) && pass.block_player_tag_ids.includes(other.player_tag_id);
  return lists(first, second) || lists(second, first);
}

/**
 * Whether two players are Zaisma friends, by the passes your server checked (verifyPass): both accounts,
 * each pass listing the other's player_tag_id, so removing a friend holds as soon as either side has a
 * new pass. It works across rooms too: any two passes for the game. Use it for friends-only chat (canChat
 * does), parties, or showing a player their friends; guests are never anyone's friend.
 */
export function passesAreFriends(first: PassClaims, second: PassClaims): boolean {
  mustBePasses(first, second, "passesAreFriends");
  if (first.kind !== "account" || second.kind !== "account" || first.sub === second.sub) return false;
  const lists = (pass: PassClaims, other: PassClaims) => typeof other.player_tag_id === "string" && Array.isArray(pass.friend_player_tag_ids) && pass.friend_player_tag_ids.includes(other.player_tag_id);
  return lists(first, second) && lists(second, first);
}

/**
 * Whether the first player's chat may reach the second: first is the sender, second the reader, and the order
 * matters (ask both ways for a two-way check, like voice between two players). Both accounts, no block between
 * them, the reader reads chat, and the sender's choice takes the reader in: everyone; anyone in the same chat
 * group (My age band); or a friend in it (passesAreFriends). Guests never chat. Use it on every message your own
 * server delivers, text or voice; Zaisma's chat check (checkChat) applies the same rule, and the witness rule on
 * top (anyone under 18 types only where two independent players read it), and so do rooms (room.chat).
 */
export function canChat(first: PassClaims, second: PassClaims): boolean {
  mustBePasses(first, second, "canChat");
  if (first.kind !== "account" || second.kind !== "account" || first.sub === second.sub) return false;
  if (passesHaveBlockBetween(first, second)) return false;
  if (typeof first.chat_group_id !== "string" || typeof second.chat_group_id !== "string") return false;
  const other = { isSameChatGroup: first.chat_group_id === second.chat_group_id, isFriend: passesAreFriends(first, second) };
  return isWithinChatReach(chatReachOf(first).sending, other) && isWithinChatReach(chatReachOf(second).reading, other);
}

/**
 * Whether the first player's voice may reach the second: first is the speaker, second the listener, and the order
 * matters. canChat's rule over the voice choices: both accounts, no block between them, the listener hears voice, and
 * the speaker's who_hears_my_voice takes the listener in (everyone; the same chat group; or a friend in it). A pass
 * from before voice is heard as far as it's read. Zaisma's rooms apply it, and the witness rule on top (anyone under
 * 18 is heard only where two independent players hear them too); use it on any voice your own server passes on.
 */
export function canVoiceChat(first: PassClaims, second: PassClaims): boolean {
  mustBePasses(first, second, "canVoiceChat");
  const voiceSide = (claims: PassClaims): PassClaims => ({
    ...claims,
    who_reads_my_chat: claims.who_hears_my_voice ?? claims.who_reads_my_chat,
    chat_reading_enabled: claims.voice_hearing_enabled ?? claims.chat_reading_enabled,
  });
  return canChat(voiceSide(first), voiceSide(second));
}

export type PublicKey = JsonWebKey & { kid: string };

/** Why verifyPass refused a pass. wrong_kind: a receipt, or another token. wrong_version: a pass_version_number this copy doesn't know. */
export type PassErrorCode = "malformed" | "unknown_key" | "bad_signature" | "expired" | "wrong_game" | "wrong_issuer" | "wrong_kind" | "wrong_version";

// Plain class fields (no TypeScript-only syntax) so Node can run this file directly.
export class PassError extends Error {
  readonly code: PassErrorCode;
  constructor(code: PassErrorCode) {
    super(`Player pass rejected: ${code}`);
    this.code = code;
  }
}

/** Why verifyReceipt refused a receipt. wrong_kind: it's a pass, or another token. wrong_version: a receipt_version_number this copy doesn't know. */
export type ReceiptErrorCode = "malformed" | "unknown_key" | "bad_signature" | "expired" | "wrong_game" | "wrong_issuer" | "wrong_kind" | "wrong_version";

export class ReceiptError extends Error {
  readonly code: ReceiptErrorCode;
  constructor(code: ReceiptErrorCode) {
    super(`Receipt rejected: ${code}`);
    this.name = "ReceiptError";
    this.code = code;
  }
}

/** A receipt's JWS header typ (RFC 8725 explicit typing): verifyReceipt refuses any other token (wrong_kind). */
export const RECEIPT_TOKEN_TYPE = "receipt+jwt";

/** Who signs receipts on zaisma.com: a receipt's iss, apart from a pass's (PASS_ISSUER_URL). */
export const RECEIPT_ISSUER_URL = "https://rooms.zaisma.com/receipts";

/** The receipt contract this copy reads: verifyReceipt refuses any other receipt_version_number (wrong_version). */
export const RECEIPT_VERSION_NUMBER = 1;

const ED25519 = { name: "Ed25519" } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function keyId(publicKeyBase64Url: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(publicKeyBase64Url)));
  return toBase64Url(digest).slice(0, 16);
}

/** Make a new signing key, as a JWK string for a signing secret (the rooms Worker's PASS_SIGNING_KEY and RECEIPT_SIGNING_KEY). */
export async function generateSigningKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d });
}

export interface SigningKey {
  key: CryptoKey;
  publicKey: PublicKey;
}

export async function loadSigningKey(secret: string): Promise<SigningKey> {
  const jwk = JSON.parse(secret) as JsonWebKey;
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x || !jwk.d) throw new Error("A signing key must be an Ed25519 private JWK");
  const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x, d: jwk.d }, ED25519, false, ["sign"]);
  const publicKey: PublicKey = { kty: "OKP", crv: "Ed25519", x: jwk.x, kid: await keyId(jwk.x), alg: "EdDSA", use: "sig" } as PublicKey;
  return { key, publicKey };
}

/** A pass to sign: Zaisma always lists owned_item_names, and verifyPass reads a pass without them as owning nothing. */
export async function signPass(signing: SigningKey, claims: Omit<PassClaims, "owned_item_names"> & { owned_item_names?: string[] }): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "EdDSA", typ: PASS_TOKEN_TYPE, kid: signing.publicKey.kid })));
  const body = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign(ED25519, signing.key, encoder.encode(`${header}.${body}`)));
  return `${header}.${body}.${toBase64Url(signature)}`;
}

export function jwks(keys: PublicKey[]): { keys: PublicKey[] } {
  return { keys };
}

/**
 * A token's claims once its signature checks out against one of the keys, for verifyPass and verifyReceipt, which
 * say how to refuse. isKind checks the header's typ before any key is looked up, so a token of the other kind is
 * wrong_kind wherever it's checked, whichever keys are at hand; it only ever refuses, so an unsigned header is enough.
 */
async function signedToken(
  token: string,
  keys: PublicKey[],
  isKind: (typ: unknown) => boolean,
  refuse: (code: "malformed" | "unknown_key" | "bad_signature" | "wrong_kind") => Error,
): Promise<{ claims: Record<string, unknown> }> {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) throw refuse("malformed");
  let header: { alg?: string; kid?: string; typ?: unknown };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(decoder.decode(fromBase64Url(parts[0]!)));
    claims = JSON.parse(decoder.decode(fromBase64Url(parts[1]!)));
  } catch {
    throw refuse("malformed");
  }
  if (!header || header.alg !== "EdDSA" || !claims || typeof claims !== "object") throw refuse("malformed");
  if (!isKind(header.typ)) throw refuse("wrong_kind");
  const jwk = keys.find((publicKey) => publicKey.kid === header.kid);
  if (!jwk) throw refuse("unknown_key");
  const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, ED25519, false, ["verify"]);
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = fromBase64Url(parts[2]!);
  } catch {
    throw refuse("malformed");
  }
  if (!(await crypto.subtle.verify(ED25519, key, signature, encoder.encode(`${parts[0]}.${parts[1]}`)))) throw refuse("bad_signature");
  return { claims };
}

const isStringList = (given: unknown) => Array.isArray(given) && given.every((entry) => typeof entry === "string");

/** What verifyPass checks a pass against: the game it's for, and who made it (PASS_ISSUER_URL unless a local preview of Zaisma). */
export interface PassExpectations {
  gameSlug: string;
  issuerUrl?: string;
  /** The time to check exp against, in epoch milliseconds: now unless a test says otherwise. */
  nowMs?: number;
}

/** Check a pass. Throws PassError if it's forged, expired, for another game, not a pass, or a version this copy doesn't know. */
export async function verifyPass(token: string, keys: PublicKey[], expect: PassExpectations): Promise<PassClaims> {
  // A receipt, or any other token, never stands in for a pass, whichever keys it's checked against.
  const { claims: signed } = await signedToken(token, keys, (typ) => typ === PASS_TOKEN_TYPE, (code) => new PassError(code));
  const claims = signed as unknown as PassClaims;
  if (claims.pass_version_number !== PASS_VERSION_NUMBER) throw new PassError("wrong_version");
  const nowSec = Math.floor((expect.nowMs ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSec) throw new PassError("expired");
  if (claims.iss !== (expect.issuerUrl ?? PASS_ISSUER_URL)) throw new PassError("wrong_issuer");
  if (claims.aud !== expect.gameSlug) throw new PassError("wrong_game");
  if (typeof claims.sub !== "string" || typeof claims.kind !== "string") throw new PassError("malformed");
  if (claims.kind === "guest" && typeof claims.name !== "string") throw new PassError("malformed");
  if (claims.who_can_chat !== undefined && typeof claims.who_can_chat !== "string") throw new PassError("malformed");
  if (claims.chat_group_id !== undefined && typeof claims.chat_group_id !== "string") throw new PassError("malformed");
  if (claims.who_reads_my_chat !== undefined && typeof claims.who_reads_my_chat !== "string") throw new PassError("malformed");
  if (claims.chat_reading_enabled !== undefined && typeof claims.chat_reading_enabled !== "boolean") throw new PassError("malformed");
  if (claims.network_seal !== undefined && typeof claims.network_seal !== "string") throw new PassError("malformed");
  if (claims.player_tag_id !== undefined && typeof claims.player_tag_id !== "string") throw new PassError("malformed");
  if (claims.friend_player_tag_ids !== undefined && !isStringList(claims.friend_player_tag_ids)) throw new PassError("malformed");
  if (claims.block_player_tag_ids !== undefined && !isStringList(claims.block_player_tag_ids)) throw new PassError("malformed");
  if (claims.owned_item_names === undefined) claims.owned_item_names = [];
  if (!isStringList(claims.owned_item_names)) throw new PassError("malformed");
  return claims;
}

/**
 * What a receipt proves: that this player bought or was granted this item in this game, and the purchase's
 * status when the receipt was signed. Signed with Zaisma's receipt key, published for good at its own address
 * (/.well-known/receipt-jwks.json), apart from the pass key, so a receipt never expires and a receipt key never
 * signs a pass anyone takes. Its typ is receipt+jwt and its issuer
 * <pass issuer>/receipts (https://rooms.zaisma.com/receipts), so no JWT library takes it for a pass.
 *
 * Deliver once per purchase_id, and only when purchase_status is completed; never compare receipt strings,
 * since the same purchase signs again with a new iat. item_kind, purchase_source and purchase_status may gain
 * values within v1: a value your server doesn't know means don't deliver.
 */
export interface ReceiptClaims {
  /** The player's ID. */
  sub: string;
  /** The game's slug: a receipt is for the game it was issued for. */
  aud: string;
  /** https://rooms.zaisma.com/receipts on zaisma.com: the pass issuer with /receipts. */
  iss: string;
  /** The purchase's ID, as purchase_id, for JWT tools. */
  jti: string;
  /** The receipt contract it follows: 1. verifyReceipt refuses a number it doesn't know. */
  receipt_version_number: number;
  /** The purchase's ID (purchase_…): one purchase, one delivery. */
  purchase_id: string;
  /** When it was bought or granted, as an ISO date. */
  purchased_at: string;
  /** completed, refunded or charged_back when it was signed; deliver only on completed. */
  purchase_status: "completed" | "refunded" | "charged_back" | (string & {});
  item_name: string;
  item_kind: "permanent" | "consumable" | (string & {});
  /** How many of the item: 1 for a permanent item. */
  item_count: number;
  /** sale: paid through the buy sheet. grant: the developer gave it, with no money. */
  purchase_source: "sale" | "grant" | (string & {});
  /** What the whole purchase paid, in the currency's minor units; null for a grant. */
  paid_minor_units: number | null;
  currency_code: string | null;
  /** The game's own ID for the player's account in its own system, as the game gave it; null when it gave none. */
  game_account_id: string | null;
  /** When the receipt was signed, in epoch seconds (not when it was bought: that's purchased_at). */
  iat: number;
  /** No receipt expires today; verifyReceipt refuses one past its exp if one ever does. */
  exp?: number;
}

/** What verifyReceipt checks a receipt against: the game it's for, and who made it (RECEIPT_ISSUER_URL unless a local preview of Zaisma). */
export interface ReceiptExpectations {
  gameSlug: string;
  issuerUrl?: string;
  /** The time to check exp against, in epoch milliseconds: now unless a test says otherwise. */
  nowMs?: number;
}

/** Check a receipt. Throws ReceiptError if it's forged, for another game, a pass (wrong_kind), past its exp, or a version this copy doesn't know. */
export async function verifyReceipt(token: string, keys: PublicKey[], expect: ReceiptExpectations): Promise<ReceiptClaims> {
  const { claims: signed } = await signedToken(token, keys, (typ) => typ === RECEIPT_TOKEN_TYPE, (code) => new ReceiptError(code));
  const claims = signed as unknown as ReceiptClaims;
  if (claims.receipt_version_number !== RECEIPT_VERSION_NUMBER) throw new ReceiptError(Number.isInteger(claims.receipt_version_number) ? "wrong_version" : "malformed");
  if (claims.exp !== undefined && (typeof claims.exp !== "number" || claims.exp <= Math.floor((expect.nowMs ?? Date.now()) / 1000))) throw new ReceiptError("expired");
  if (claims.iss !== (expect.issuerUrl ?? RECEIPT_ISSUER_URL)) throw new ReceiptError("wrong_issuer");
  if (claims.aud !== expect.gameSlug) throw new ReceiptError("wrong_game");
  const isText = (given: unknown) => typeof given === "string" && given.length > 0;
  const isNullOr = (given: unknown, type: string) => given === null || typeof given === type;
  if (
    !isText(claims.sub) ||
    !isText(claims.jti) ||
    !isText(claims.purchase_id) ||
    !isText(claims.purchased_at) ||
    !isText(claims.purchase_status) ||
    !isText(claims.item_name) ||
    !isText(claims.item_kind) ||
    !Number.isInteger(claims.item_count) ||
    !isText(claims.purchase_source) ||
    !isNullOr(claims.paid_minor_units, "number") ||
    !isNullOr(claims.currency_code, "string") ||
    !isNullOr(claims.game_account_id, "string") ||
    typeof claims.iat !== "number"
  ) {
    throw new ReceiptError("malformed");
  }
  return claims;
}
