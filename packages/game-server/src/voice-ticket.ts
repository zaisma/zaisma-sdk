import { VOICE_ROOM_LIMITS } from "./chat.ts";
import { fromBase64Url, type PassClaims } from "./pass.ts";

/**
 * Voice for a game's own server (PL39). Zaisma's rooms decide who hears whom in their voice themselves; a game on its own
 * server joins its players to a voice channel on Zaisma with a ticket its server signs with the game's ticket secret
 * (create_ticket_secret): which player, which channel, and the server's rules for them (their voice group, whom they
 * hear, how many at once). The channel applies Zaisma's rules on top: who each player lets hear them, blocks, and anyone
 * under 18 only where two independent players hear them too. A new ticket, sent on the open channel, updates the rules,
 * so a team switch needs no reconnect.
 */

/** What a voice ticket says, signed: kept short, so it rides in any message. */
export interface VoiceTicketClaims {
  /** voice: a ticket for something else signed with the same secret (a channel's, later) is never a voice ticket. */
  ticket_kind: "voice";
  /** The game's slug, as the player's pass names it. */
  aud: string;
  /** The player, as their pass names them. */
  sub: string;
  channel_name: string;
  /** The player's voice group (a team), or null for none: a player in a group hears and is heard only within it. */
  voice_group_name: string | null;
  /** Whom the player hears, or null for everyone voice allows (proximity: only those near). */
  heard_speaker_ids: string[] | null;
  /** Voices the player hears at once, 1 to 32. */
  heard_speaker_count: number;
  /** When the ticket stops working, in seconds since 1970: it's for joining or updating, not for staying. */
  exp: number;
}

/** What voiceTicket takes beside the player and channel: the server's rules for this player now. */
export interface VoiceTicketOptions {
  voiceGroupName?: string | null;
  heardSpeakerPlayerIds?: readonly string[] | null;
  heardSpeakerCount?: number;
}

/** A channel's name: 1 to 40 of a-z, 0-9, -, _ and :. */
export const VOICE_CHANNEL_NAME_PATTERN = /^[a-z0-9_:-]{1,40}$/;

/** Why a voice ticket was refused. */
export type VoiceTicketErrorCode = "malformed" | "bad_signature" | "expired" | "wrong_game" | "wrong_player" | "wrong_channel" | "wrong_kind";

export class VoiceTicketError extends Error {
  readonly code: VoiceTicketErrorCode;
  constructor(code: VoiceTicketErrorCode) {
    super(`Voice ticket refused: ${code}`);
    this.name = "VoiceTicketError";
    this.code = code;
  }
}

const encoder = new TextEncoder();
const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const macKey = (ticketSecret: string) => crypto.subtle.importKey("raw", encoder.encode(ticketSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/**
 * Sign a voice ticket for a player whose pass your server checked (verifyPass), for a channel your server names, like
 * "match-12" or "team-red-12". Hand it to the player's game, which joins with room.voice.join({ ticket }), and send a new
 * one when their team or range changes (room.voice.updateTicket). It lasts 5 minutes: enough to join or update.
 */
export async function voiceTicket(playerPass: PassClaims, channelName: string, ticketSecret: string, voiceTicketOptions: VoiceTicketOptions = {}): Promise<string> {
  if (!playerPass || typeof playerPass.sub !== "string" || typeof playerPass.aud !== "string") throw new TypeError("voiceTicket takes a pass's claims, as verifyPass answered them.");
  if (!VOICE_CHANNEL_NAME_PATTERN.test(channelName)) throw new TypeError("voiceTicket's channelName is 1 to 40 of a-z, 0-9, -, _ and :.");
  if (typeof ticketSecret !== "string" || ticketSecret.length < 32) throw new TypeError("voiceTicket needs the game's ticket secret (create_ticket_secret).");
  const groupName = voiceTicketOptions.voiceGroupName ?? null;
  if (groupName !== null && (typeof groupName !== "string" || !groupName || groupName.length > VOICE_ROOM_LIMITS.maximumVoiceGroupNameCharacterCount)) throw new TypeError(`voiceGroupName is 1 to ${VOICE_ROOM_LIMITS.maximumVoiceGroupNameCharacterCount} characters, or null.`);
  const heardSpeakerCount = voiceTicketOptions.heardSpeakerCount ?? VOICE_ROOM_LIMITS.defaultHeardSpeakerCount;
  if (!Number.isInteger(heardSpeakerCount) || heardSpeakerCount < 1 || heardSpeakerCount > VOICE_ROOM_LIMITS.maximumHeardSpeakerCount) throw new TypeError(`heardSpeakerCount is a whole number from 1 to ${VOICE_ROOM_LIMITS.maximumHeardSpeakerCount}.`);
  const heard = voiceTicketOptions.heardSpeakerPlayerIds ?? null;
  if (heard !== null && (!Array.isArray(heard) || heard.length > 100 || heard.some((playerId) => typeof playerId !== "string"))) throw new TypeError("heardSpeakerPlayerIds is up to 100 player IDs, or null.");
  const claims: VoiceTicketClaims = {
    ticket_kind: "voice",
    aud: playerPass.aud,
    sub: playerPass.sub,
    channel_name: channelName,
    voice_group_name: groupName,
    heard_speaker_ids: heard ? [...new Set(heard)] : null,
    heard_speaker_count: heardSpeakerCount,
    exp: Math.floor(Date.now() / 1000) + VOICE_ROOM_LIMITS.voiceTicketDurationSec,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await macKey(ticketSecret), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** The channel a ticket names, unchecked: for the SDK to know where to connect. Null for anything else. */
export function voiceTicketChannelName(ticket: unknown): string | null {
  if (typeof ticket !== "string" || ticket.length > 8000) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromBase64Url(ticket.split(".")[0]!))) as Partial<VoiceTicketClaims>;
    return typeof claims.channel_name === "string" && VOICE_CHANNEL_NAME_PATTERN.test(claims.channel_name) ? claims.channel_name : null;
  } catch {
    return null;
  }
}

/** Check a voice ticket (Zaisma's voice channels do): its signature with the game's ticket secret, then what it's for. */
export async function verifyVoiceTicket(ticket: unknown, ticketSecret: string, expectations: { gameSlug: string; playerId: string; channelName: string; nowSec?: number }): Promise<VoiceTicketClaims> {
  if (typeof ticket !== "string" || ticket.length > 8000) throw new VoiceTicketError("malformed");
  const [body, signature, extra] = ticket.split(".");
  if (!body || !signature || extra !== undefined) throw new VoiceTicketError("malformed");
  let isSigned: boolean;
  try {
    isSigned = await crypto.subtle.verify("HMAC", await macKey(ticketSecret), fromBase64Url(signature), encoder.encode(body));
  } catch {
    throw new VoiceTicketError("malformed");
  }
  if (!isSigned) throw new VoiceTicketError("bad_signature");
  let claims: VoiceTicketClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    throw new VoiceTicketError("malformed");
  }
  if (!claims || typeof claims !== "object" || claims.ticket_kind !== "voice") throw new VoiceTicketError("wrong_kind");
  const isShaped =
    (claims.voice_group_name === null || (typeof claims.voice_group_name === "string" && claims.voice_group_name.length >= 1 && claims.voice_group_name.length <= VOICE_ROOM_LIMITS.maximumVoiceGroupNameCharacterCount)) &&
    (claims.heard_speaker_ids === null || (Array.isArray(claims.heard_speaker_ids) && claims.heard_speaker_ids.length <= 100 && claims.heard_speaker_ids.every((playerId) => typeof playerId === "string"))) &&
    Number.isInteger(claims.heard_speaker_count) && claims.heard_speaker_count >= 1 && claims.heard_speaker_count <= VOICE_ROOM_LIMITS.maximumHeardSpeakerCount;
  if (!isShaped) throw new VoiceTicketError("malformed");
  if (typeof claims.exp !== "number" || claims.exp <= (expectations.nowSec ?? Math.floor(Date.now() / 1000))) throw new VoiceTicketError("expired");
  if (claims.aud !== expectations.gameSlug) throw new VoiceTicketError("wrong_game");
  if (claims.sub !== expectations.playerId) throw new VoiceTicketError("wrong_player");
  if (claims.channel_name !== expectations.channelName) throw new VoiceTicketError("wrong_channel");
  return claims;
}
