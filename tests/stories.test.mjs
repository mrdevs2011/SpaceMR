import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const source = readFileSync(new URL("../modules/feed/stories.js", import.meta.url), "utf8");
assert.ok(existsSync(new URL("../emoji/2d/1f4f8.png", import.meta.url)), "Story camera PNG must exist");
assert.ok(source.includes("select('story_id'"), "View count must select an existing story_views column");
assert.ok(!source.includes("from('story_views').select('id'"), "story_views has no id column");
assert.ok(source.includes("from('story_views').insert("), "View writes must use INSERT under current RLS");
assert.ok(!source.includes("svReactions") && !source.includes("sv-reactions"), "Story viewer must not render reactions");
assert.ok(!source.includes("sv-react-chip") && !source.includes("sv-reaction-emoji"), "Story viewer must not include reaction buttons or images");
assert.ok(!source.includes("from('story_reactions')"), "Story viewer must not read or write story reactions");
assert.ok(!source.includes("replyToStory") && !source.includes("Hikoyaga munosabat"), "Story reactions must not send chat messages");
assert.ok(source.includes("sv-own-bar"), "Story views row must remain in the bottom panel");
assert.ok(!source.includes("from('story_views').upsert("), "Upsert requires an UPDATE policy");
assert.ok(source.includes("Hikoyani yuklab bo‘lmadi"));
assert.ok(source.includes("Qayta urinish"));
console.log("STORIES REGRESSION: all checks passed");
