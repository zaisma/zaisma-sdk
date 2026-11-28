// A shape: what a kind of sync shares, declared field by field (a character's place and facing, a player's
// input), never how. From the declaration the core knows how to check a value that came from someone else, put
// it in a few bytes, blend two of them, and measure and fade a correction. The same in a player's game and on a
// game server. The reference is index.d.ts ("Shapes").
import { refuse } from "./wire.js";

const VALUE_KINDS = ["number", "integer", "angle", "boolean", "choice", "press"];
const FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,39}$/;
const FIELD_KEYS = ["name", "valueKind", "minimumNumber", "maximumNumber", "stepSizeNumber", "choices", "defaultValue", "snapAboveNumber"];
const RADIAN_COUNT_PER_TURN = Math.PI * 2;
const ANGLE_STEP_COUNT = 65536;
/** A number with a step size is sent as a whole count of steps: at most this many, so it fits in four bytes. */
const MAXIMUM_STEP_COUNT = 2 ** 32 - 1;

const isPlainObject = (given) => given !== null && typeof given === "object" && !Array.isArray(given);
const isFiniteNumber = (given) => typeof given === "number" && Number.isFinite(given);

/** An angle in radians, wrapped into -PI up to PI. */
export function wrapAngle(angleRad) {
  const wrappedNumber = (((angleRad + Math.PI) % RADIAN_COUNT_PER_TURN) + RADIAN_COUNT_PER_TURN) % RADIAN_COUNT_PER_TURN;
  return wrappedNumber - Math.PI;
}

/** How many bytes hold a whole count from 0 to maximumCount. */
const byteCountFor = (maximumCount) => (maximumCount <= 0xff ? 1 : maximumCount <= 0xffff ? 2 : 4);

/**
 * Checks a declared list of fields and answers the shape the rest of the core works from. what names the
 * declaration in errors ("stateFields"); isPressAllowed says whether "press" fields may be in it (inputs only).
 */
export function defineShape(fields, { what, isPressAllowed }) {
  if (!Array.isArray(fields) || !fields.length || fields.length > 64) refuse("bad_fields", `${what} is a list of 1 to 64 fields.`, what, 'Give fields like [{ name: "x", valueKind: "number", minimumNumber: -500, maximumNumber: 500, stepSizeNumber: 0.01 }].');
  const names = new Set();
  const shapeFields = fields.map((field, index) => {
    const fieldPath = `${what}[${index}]`;
    if (!isPlainObject(field)) refuse("bad_fields", `${fieldPath} isn't a field.`, fieldPath, "Give { name, valueKind, ... } for each field.");
    for (const key of Object.keys(field)) if (!FIELD_KEYS.includes(key)) refuse("bad_fields", `${fieldPath} has no "${key}".`, fieldPath, `A field takes: ${FIELD_KEYS.join(", ")}.`);
    const { name, valueKind } = field;
    if (typeof name !== "string" || !FIELD_NAME_PATTERN.test(name)) refuse("bad_fields", `${fieldPath}'s name "${name}" isn't a field's name.`, fieldPath, 'Give a name in JavaScript\'s style, up to 40 characters, like "x" or "isGrounded".');
    if (names.has(name)) refuse("bad_fields", `${what} names "${name}" twice.`, fieldPath, "Give each field once.");
    names.add(name);
    if (!VALUE_KINDS.includes(valueKind) || (valueKind === "press" && !isPressAllowed)) {
      const kinds = VALUE_KINDS.filter((kind) => kind !== "press" || isPressAllowed);
      refuse("bad_fields", `${fieldPath}'s valueKind is "${valueKind}".`, fieldPath, `Use: ${kinds.join(", ")}.`);
    }
    const shaped = { name, valueKind, minimumNumber: null, maximumNumber: null, stepSizeNumber: null, choices: null, defaultValue: null, snapAboveNumber: null, byteCount: 0 };
    if (valueKind === "number" || valueKind === "integer") {
      const { minimumNumber, maximumNumber } = field;
      if (!isFiniteNumber(minimumNumber) || !isFiniteNumber(maximumNumber) || !(minimumNumber < maximumNumber)) refuse("bad_fields", `${fieldPath} ("${name}") needs minimumNumber below maximumNumber: every number has a range.`, fieldPath, "Give the smallest and largest it can be, like minimumNumber: -500, maximumNumber: 500.");
      if (valueKind === "integer" && !(Number.isInteger(minimumNumber) && Number.isInteger(maximumNumber))) refuse("bad_fields", `${fieldPath} ("${name}") is an integer with a range that isn't whole numbers.`, fieldPath, "Give whole numbers for minimumNumber and maximumNumber.");
      shaped.minimumNumber = minimumNumber;
      shaped.maximumNumber = maximumNumber;
    } else if (field.minimumNumber !== undefined || field.maximumNumber !== undefined) {
      refuse("bad_fields", `${fieldPath} ("${name}") is a ${valueKind}, which has no range.`, fieldPath, "Leave minimumNumber and maximumNumber out.");
    }
    if (valueKind === "number") {
      if (field.stepSizeNumber !== undefined) {
        if (!isFiniteNumber(field.stepSizeNumber) || field.stepSizeNumber <= 0) refuse("bad_fields", `${fieldPath} ("${name}")'s stepSizeNumber isn't a number above 0.`, fieldPath, "Give how fine it's sent, like 0.01 for a place to the centimetre, or leave it out to send it whole.");
        const stepCount = Math.ceil((shaped.maximumNumber - shaped.minimumNumber) / field.stepSizeNumber);
        if (stepCount > MAXIMUM_STEP_COUNT) refuse("bad_fields", `${fieldPath} ("${name}") has more than 4,294,967,295 steps in its range.`, fieldPath, "Give a larger stepSizeNumber or a smaller range.");
        shaped.stepSizeNumber = field.stepSizeNumber;
        shaped.byteCount = byteCountFor(stepCount);
      } else shaped.byteCount = 4;
    } else if (field.stepSizeNumber !== undefined) refuse("bad_fields", `${fieldPath} ("${name}") is a ${valueKind}, which has no stepSizeNumber.`, fieldPath, "Leave stepSizeNumber out.");
    if (valueKind === "integer") shaped.byteCount = byteCountFor(shaped.maximumNumber - shaped.minimumNumber);
    if (valueKind === "angle") shaped.byteCount = 2;
    if (valueKind === "choice") {
      const { choices } = field;
      if (!Array.isArray(choices) || choices.length < 2 || choices.length > 255 || choices.some((choice) => typeof choice !== "string" || !choice.length || choice.length > 40) || new Set(choices).size !== choices.length) {
        refuse("bad_fields", `${fieldPath} ("${name}") needs choices: 2 to 255 different words.`, fieldPath, 'Give the words it can be, like choices: ["idle", "run", "jump"].');
      }
      shaped.choices = [...choices];
      shaped.byteCount = 1;
    } else if (field.choices !== undefined) refuse("bad_fields", `${fieldPath} ("${name}") is a ${valueKind}, which has no choices.`, fieldPath, "Leave choices out.");
    if (field.snapAboveNumber !== undefined) {
      if (!(valueKind === "number" || valueKind === "angle") || !isFiniteNumber(field.snapAboveNumber) || field.snapAboveNumber <= 0) refuse("bad_fields", `${fieldPath} ("${name}")'s snapAboveNumber isn't a number above 0 on a number or an angle.`, fieldPath, "Give how big a correction jumps instead of easing, like snapAboveNumber: 2 for two metres.");
      shaped.snapAboveNumber = field.snapAboveNumber;
    }
    const fallback = { number: Math.min(Math.max(0, shaped.minimumNumber), shaped.maximumNumber), integer: Math.min(Math.max(0, shaped.minimumNumber), shaped.maximumNumber), angle: 0, boolean: false, press: false, choice: shaped.choices?.[0] }[valueKind];
    if (field.defaultValue === undefined) shaped.defaultValue = fallback;
    else if (!fits(shaped, field.defaultValue)) refuse("bad_fields", `${fieldPath} ("${name}")'s defaultValue ${JSON.stringify(field.defaultValue)} isn't one it can be.`, fieldPath, `Give ${describe(shaped)}.`);
    else shaped.defaultValue = field.defaultValue;
    return shaped;
  });
  const bitFields = shapeFields.filter((field) => field.valueKind === "boolean" || field.valueKind === "press");
  const byteFields = shapeFields.filter((field) => field.valueKind !== "boolean" && field.valueKind !== "press");
  return {
    what,
    fields: shapeFields,
    byName: new Map(shapeFields.map((field) => [field.name, field])),
    bitFields,
    byteFields,
    /** How many bytes one value takes. */
    byteCount: byteFields.reduce((total, field) => total + field.byteCount, 0) + Math.ceil(bitFields.length / 8),
  };
}

/** What a field takes, in words. */
function describe(field) {
  if (field.valueKind === "number") return `a number from ${field.minimumNumber} to ${field.maximumNumber}`;
  if (field.valueKind === "integer") return `a whole number from ${field.minimumNumber} to ${field.maximumNumber}`;
  if (field.valueKind === "angle") return "an angle in radians";
  if (field.valueKind === "choice") return `one of ${field.choices.map((choice) => `"${choice}"`).join(", ")}`;
  return "true or false";
}

/** Whether a field takes a value as it is. */
function fits(field, given) {
  if (field.valueKind === "number") return isFiniteNumber(given) && given >= field.minimumNumber && given <= field.maximumNumber;
  if (field.valueKind === "integer") return Number.isInteger(given) && given >= field.minimumNumber && given <= field.maximumNumber;
  if (field.valueKind === "angle") return isFiniteNumber(given);
  if (field.valueKind === "choice") return field.choices.includes(given);
  return typeof given === "boolean";
}

/** One field's value made one it can be: a number held in its range, anything else that doesn't fit its default. */
function settle(field, given) {
  if (field.valueKind === "number" || field.valueKind === "integer") {
    if (!isFiniteNumber(given)) return field.defaultValue;
    const heldNumber = Math.min(Math.max(given, field.minimumNumber), field.maximumNumber);
    return field.valueKind === "integer" ? Math.round(heldNumber) : heldNumber;
  }
  if (field.valueKind === "angle") return isFiniteNumber(given) ? wrapAngle(given) : field.defaultValue;
  return fits(field, given) ? given : field.defaultValue;
}

/** Every field at its default. */
export function defaultValueOf(shape) {
  const shapedValue = {};
  for (const field of shape.fields) shapedValue[field.name] = field.defaultValue;
  return shapedValue;
}

/**
 * A value from someone else (another player, or the game's own step answering), made one the shape can hold:
 * every field there, numbers held in range, anything unknown left out, anything that doesn't fit its default.
 * It never throws: what's sent by others is never trusted.
 */
export function settleValue(shape, given) {
  const source = isPlainObject(given) ? given : {};
  const shapedValue = {};
  for (const field of shape.fields) shapedValue[field.name] = settle(field, source[field.name]);
  return shapedValue;
}

/** Checks the game's own changes to a value, so a mistake is said at once: throws on a field it doesn't have or a value it can't hold. */
export function checkChanges(shape, changes, what) {
  if (!isPlainObject(changes)) refuse("bad_value", `${what} isn't an object of fields.`, what, `Give fields of ${shape.what}, like { ${shape.fields[0].name}: ${JSON.stringify(shape.fields[0].defaultValue)} }.`);
  for (const [name, given] of Object.entries(changes)) {
    const field = shape.byName.get(name);
    if (!field) refuse("bad_value", `${shape.what} has no field "${name}".`, `${what}.${name}`, `Its fields: ${shape.fields.map((each) => each.name).join(", ")}.`);
    if (!fits(field, given)) refuse("bad_value", `${what}.${name} is ${JSON.stringify(given)}.`, `${what}.${name}`, `Give ${describe(field)}.`);
  }
  return changes;
}

/** A value as a list in the shape's order, for JSON that's short. */
export function toList(shape, shapedValue) {
  return shape.fields.map((field) => shapedValue[field.name]);
}

/** A list from toList back as a value, settled: it may have come from anyone. */
export function fromList(shape, list) {
  const shapedValue = {};
  shape.fields.forEach((field, index) => {
    shapedValue[field.name] = settle(field, Array.isArray(list) ? list[index] : undefined);
  });
  return shapedValue;
}

// ---- Bytes ----

/** A growing run of bytes to write into. */
export function createWriter(initialByteCount = 256) {
  let bytes = new Uint8Array(initialByteCount);
  let view = new DataView(bytes.buffer);
  let writtenByteCount = 0;
  const room = (byteCount) => {
    if (writtenByteCount + byteCount <= bytes.length) return;
    const grown = new Uint8Array(Math.max(bytes.length * 2, writtenByteCount + byteCount));
    grown.set(bytes);
    bytes = grown;
    view = new DataView(bytes.buffer);
  };
  return {
    uint8(number) {
      room(1);
      view.setUint8(writtenByteCount, number);
      writtenByteCount += 1;
    },
    uint16(number) {
      room(2);
      view.setUint16(writtenByteCount, number);
      writtenByteCount += 2;
    },
    uint32(number) {
      room(4);
      view.setUint32(writtenByteCount, number);
      writtenByteCount += 4;
    },
    float32(number) {
      room(4);
      view.setFloat32(writtenByteCount, number);
      writtenByteCount += 4;
    },
    float64(number) {
      room(8);
      view.setFloat64(writtenByteCount, number);
      writtenByteCount += 8;
    },
    /** Short text: its length in one byte, then its UTF-8, up to 255 bytes. */
    text(text) {
      const encoded = new TextEncoder().encode(text);
      if (encoded.length > 255) throw new RangeError("Text over 255 bytes can't be written here.");
      this.uint8(encoded.length);
      room(encoded.length);
      bytes.set(encoded, writtenByteCount);
      writtenByteCount += encoded.length;
    },
    /** The bytes written so far. */
    done: () => bytes.slice(0, writtenByteCount),
  };
}

/** Reads a run of bytes from the front. Every read past the end answers null, so a short or broken run is noticed, never thrown. */
export function createReader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let readByteIndex = 0;
  const take = (byteCount, read) => {
    if (readByteIndex + byteCount > bytes.byteLength) {
      readByteIndex = bytes.byteLength + 1;
      return null;
    }
    const takenValue = read(readByteIndex);
    readByteIndex += byteCount;
    return takenValue;
  };
  return {
    uint8: () => take(1, (byteIndex) => view.getUint8(byteIndex)),
    uint16: () => take(2, (byteIndex) => view.getUint16(byteIndex)),
    uint32: () => take(4, (byteIndex) => view.getUint32(byteIndex)),
    float32: () => take(4, (byteIndex) => view.getFloat32(byteIndex)),
    float64: () => take(8, (byteIndex) => view.getFloat64(byteIndex)),
    text() {
      const textLength = this.uint8();
      if (textLength === null) return null;
      return take(textLength, (byteIndex) => new TextDecoder().decode(bytes.subarray(byteIndex, byteIndex + textLength)));
    },
    /** Whether every read so far was there. */
    get isWhole() {
      return readByteIndex <= bytes.byteLength;
    },
    get isAtEnd() {
      return readByteIndex === bytes.byteLength;
    },
  };
}

function writeCount(writer, byteCount, stepCount) {
  if (byteCount === 1) writer.uint8(stepCount);
  else if (byteCount === 2) writer.uint16(stepCount);
  else writer.uint32(stepCount);
}
function readCount(reader, byteCount) {
  return byteCount === 1 ? reader.uint8() : byteCount === 2 ? reader.uint16() : reader.uint32();
}

/** Writes a value (settled first) in the shape's few bytes: numbers as counts of their step, angles in two bytes, yes-or-no fields as bits. */
export function writeValue(shape, writer, given) {
  const shapedValue = settleValue(shape, given);
  for (const field of shape.byteFields) {
    const fieldValue = shapedValue[field.name];
    if (field.valueKind === "number") {
      if (field.stepSizeNumber === null) writer.float32(fieldValue);
      else writeCount(writer, field.byteCount, Math.round((fieldValue - field.minimumNumber) / field.stepSizeNumber));
    } else if (field.valueKind === "integer") writeCount(writer, field.byteCount, fieldValue - field.minimumNumber);
    else if (field.valueKind === "angle") writer.uint16(Math.round(((fieldValue + Math.PI) / RADIAN_COUNT_PER_TURN) * ANGLE_STEP_COUNT) % ANGLE_STEP_COUNT);
    else writer.uint8(field.choices.indexOf(fieldValue));
  }
  for (let firstBitIndex = 0; firstBitIndex < shape.bitFields.length; firstBitIndex += 8) {
    let packedNumber = 0;
    shape.bitFields.slice(firstBitIndex, firstBitIndex + 8).forEach((field, bitIndex) => {
      if (shapedValue[field.name]) packedNumber |= 1 << bitIndex;
    });
    writer.uint8(packedNumber);
  }
}

/** Reads a shapedValue writeValue wrote, settled: answers null when the bytes run out. */
export function readValue(shape, reader) {
  const shapedValue = {};
  for (const field of shape.byteFields) {
    if (field.valueKind === "number") {
      const read = field.stepSizeNumber === null ? reader.float32() : readCount(reader, field.byteCount);
      shapedValue[field.name] = read === null ? null : field.stepSizeNumber === null ? read : field.minimumNumber + read * field.stepSizeNumber;
    } else if (field.valueKind === "integer") {
      const read = readCount(reader, field.byteCount);
      shapedValue[field.name] = read === null ? null : field.minimumNumber + read;
    } else if (field.valueKind === "angle") {
      const read = reader.uint16();
      shapedValue[field.name] = read === null ? null : (read / ANGLE_STEP_COUNT) * RADIAN_COUNT_PER_TURN - Math.PI;
    } else {
      const read = reader.uint8();
      shapedValue[field.name] = read === null ? null : field.choices[read];
    }
  }
  for (let firstBitIndex = 0; firstBitIndex < shape.bitFields.length; firstBitIndex += 8) {
    const packedNumber = reader.uint8();
    shape.bitFields.slice(firstBitIndex, firstBitIndex + 8).forEach((field, bitIndex) => {
      shapedValue[field.name] = packedNumber === null ? null : Boolean(packedNumber & (1 << bitIndex));
    });
  }
  return reader.isWhole ? settleValue(shape, shapedValue) : null;
}

// ---- Blending and corrections ----

/**
 * Two values blended: fractionNumber 0 is earlier, 1 is later, and above 1 runs on past later (a short guess while the
 * next one is late). Numbers and angles move smoothly (an angle the short way round); whole numbers, choices
 * and yes-or-no fields stay at earlier until later is reached.
 */
export function blendValues(shape, earlier, later, fractionNumber) {
  const blendedValue = {};
  for (const field of shape.fields) {
    const from = earlier[field.name];
    const to = later[field.name];
    if (field.valueKind === "number") blendedValue[field.name] = Math.min(Math.max(from + (to - from) * fractionNumber, field.minimumNumber), field.maximumNumber);
    else if (field.valueKind === "angle") blendedValue[field.name] = wrapAngle(from + wrapAngle(to - from) * fractionNumber);
    else blendedValue[field.name] = fractionNumber >= 1 ? to : from;
  }
  return blendedValue;
}

/** How far apart two values are, field by field, for the fields that ease (numbers and angles): from minus to. */
export function valueDifference(shape, from, to) {
  const difference = {};
  for (const field of shape.fields) {
    if (field.valueKind === "number") difference[field.name] = from[field.name] - to[field.name];
    else if (field.valueKind === "angle") difference[field.name] = wrapAngle(from[field.name] - to[field.name]);
  }
  return difference;
}

/** A value moved by an offset (a difference, or a fading correction), kept in range. */
export function offsetValue(shape, shapedValue, offset) {
  const moved = { ...shapedValue };
  for (const field of shape.fields) {
    const by = offset[field.name];
    if (!by) continue;
    if (field.valueKind === "number") moved[field.name] = Math.min(Math.max(shapedValue[field.name] + by, field.minimumNumber), field.maximumNumber);
    else if (field.valueKind === "angle") moved[field.name] = wrapAngle(shapedValue[field.name] + by);
  }
  return moved;
}

/** Adds two offsets, and drops any field past its snapAboveNumber: a correction that big jumps instead of easing. */
export function addOffsets(shape, first, second) {
  const sum = {};
  for (const field of shape.fields) {
    if (field.valueKind !== "number" && field.valueKind !== "angle") continue;
    const total = (first[field.name] ?? 0) + (second[field.name] ?? 0);
    sum[field.name] = field.snapAboveNumber !== null && Math.abs(total) > field.snapAboveNumber ? 0 : total;
  }
  return sum;
}

/** An offset shrunk by a keptFractionNumber (a fading correction): fields that are tiny become 0. */
export function scaleOffset(offset, keptFractionNumber) {
  const scaled = {};
  for (const [name, by] of Object.entries(offset)) scaled[name] = Math.abs(by * keptFractionNumber) < 1e-6 ? 0 : by * keptFractionNumber;
  return scaled;
}

/** Whether an offset moves anything. */
export const isOffsetZero = (offset) => Object.values(offset).every((by) => by === 0);

/**
 * A value as it arrives after a trip through the room: settled and put on the shape's steps. Both sides keep a
 * simulated value this way after every step, so a game server and a player's game that ran the same inputs hold
 * the very same value, and nothing is corrected that wasn't really off.
 */
export function quantizeValue(shape, given) {
  const writer = createWriter(shape.byteCount);
  writeValue(shape, writer, given);
  return readValue(shape, createReader(writer.done()));
}
