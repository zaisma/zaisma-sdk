// This piece's statement, piece.json, as a module for its own code to read. "zaisma pieces check --fix" writes it: never edit it.
export default {
  "statement_version_number": 1,
  "name": "@zaisma/save",
  "piece_version": "1.0.0",
  "kind": "foundation",
  "standard": "@zaisma/standard",
  "summary": "Save and load: a game's progress and what each of its pieces keeps of its own (the player's controls), written at the right moments, upgraded from older saves, never written over when it changed elsewhere, and kept in the browser (on Zaisma it follows the player's account) or on the game's own game server, on Zaisma or a developer's own.",
  "license": "MIT",
  "entry_path": "index.js",
  "server_entry_path": "server.js",
  "file_paths": [
    "index.js",
    "index.d.ts",
    "stores.js",
    "stores.d.ts",
    "envelope.js",
    "piece.json.js",
    "README.md",
    "LICENSE.txt"
  ],
  "server_file_paths": [
    "server.js",
    "server.d.ts",
    "envelope.js"
  ],
  "needs": [
    {
      "name": "@zaisma/piece",
      "version_range": "^1.1.0",
      "kind": "piece"
    }
  ],
  "settings": [
    {
      "name": "write_delay_ms",
      "value_kind": "number",
      "default_value": 500,
      "minimum_number": 0,
      "maximum_number": 60000,
      "maximum_character_count": null,
      "choices": null,
      "summary": "How long after a change the save is written, in milliseconds, so many changes close together are one write. The save is always written at once when the game is hidden or closed."
    },
    {
      "name": "writing_enabled",
      "value_kind": "boolean",
      "default_value": true,
      "minimum_number": null,
      "maximum_number": null,
      "maximum_character_count": null,
      "choices": null,
      "summary": "Whether changes are written. Off (a replay, a tutorial that mustn't count), progress still changes in the game and nothing is written; turned on again, what's waiting is written."
    }
  ],
  "hooks": [
    {
      "name": "problem",
      "hook_kind": "event",
      "summary": "Told when the stored save couldn't be used or a write or a send failed, with { code, message, fix }. Without a handler, it's printed as a warning."
    },
    {
      "name": "changed_outside",
      "hook_kind": "event",
      "summary": "Told when the stored save was changed elsewhere (another tab, another device through the game server, an earlier copy put back, the developer) and is now the one in use, with the progress: redraw from it."
    },
    {
      "name": "conflict",
      "hook_kind": "event",
      "summary": "Told when two progresses met (this device played offline while another played on): the one saved last is in use, and this gets the other, { otherProgress, otherPlace } with otherPlace this_device or elsewhere, to offer the player."
    },
    {
      "name": "written",
      "hook_kind": "event",
      "summary": "Told after each write, with { savedAt }: show a saved mark here."
    },
    {
      "name": "sent",
      "hook_kind": "event",
      "summary": "Told when a store that keeps the save on a server has it there, with { savedAt }."
    }
  ]
};
