// take -> addons/SpokenBooksAudio/Data/Sounds.lua, by hand.
//
// The work is in lib/lookup.mjs because the site runs it too, when the regeneration queue
// drains. This is the command that does it after a batch generated somewhere else.

import { loadEnv } from "../../lib/env.mjs";
import { buildLookup } from "./lib/lookup.mjs";

// The repo-root .env holds the shared credentials, this pipeline's .env whatever is its
// own; neither is read unless a command like this one asks for it, because lib/ is
// compiled into the site and its paths would be the build machine's.
await loadEnv("books");

const { clips, path } = await buildLookup();
console.log(`${clips} clips -> ${path}`);
