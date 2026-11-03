import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const source = readFileSync(new URL("../modules/feed/stories.js", import.meta.url), "utf8");
const start = source.indexOf('<div class="sv-reactions"');
const end = source.indexOf("</div>", start);
const reactionBlock = start >= 0 && end > start ? source.slice(start, end) : "";
assert.ok(reactionBlock, "Story reaction row must exist");
for (const key of ["2764", "1f525", "1f602", "1f44f", "1f62e"]) {
  assert.ok(reactionBlock.includes("emoji/2d/" + key + ".png"), "Missing reaction PNG: " + key);
  assert.ok(existsSync(new URL("../emoji/2d/" + key + ".png", import.meta.url)), "Missing asset: " + key);
}
assert.ok(existsSync(new URL("../emoji/2d/1f4f8.png", import.meta.url)), "Story camera PNG must exist");
assert.ok(source.includes("select('story_id'"), "View count must select an existing story_views column");
assert.ok(!source.includes("from('story_views').select('id'"), "story_views has no id column");
assert.ok(source.includes("from('story_views').insert("), "View writes must use INSERT under current RLS");
assert.ok(!source.includes("from('story_views').upsert("), "Upsert requires an UPDATE policy");
assert.ok(source.includes("Hikoyani yuklab bo‘lmadi"));
assert.ok(source.includes("Qayta urinish"));
assert.ok(source.includes("encodeForSend(textOrEmoji)"));
console.log("STORIES REGRESSION: all checks passed");
