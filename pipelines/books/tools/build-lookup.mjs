// take -> addons/SpokenBooksAudio/Data/Sounds.lua, by hand.
//
// The work is in lib/lookup.mjs because the site runs it too, when the regeneration queue
// drains. This is the command that does it after a batch generated somewhere else.

import { buildLookup } from "./lib/lookup.mjs";

const { clips, path } = await buildLookup();
console.log(`${clips} clips -> ${path}`);
