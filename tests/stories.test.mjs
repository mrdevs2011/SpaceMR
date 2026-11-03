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
assert.ok(source.includes("border-radius: 50%;"), "Reaction containers must be perfectly circular");
assert.ok(source.includes("backdrop-filter: blur(18px)"), "Story bottom panel must use a blurred glass surface");
assert.ok(source.includes("position: absolute; right: 6px; top: 50%; transform: translateY(-50%);"), "Send plane must sit inside the reply input");
assert.ok(!source.includes("svDelBtn") && !source.includes("sv-del-btn"), "Story viewer must not show a delete button");
assert.ok(source.includes("sv-own-bar"), "Story views row must remain available below the reply area");
assert.ok(source.includes('replyInp.disabled = isMine;'), "Own-story reply input must remain visible but disabled");
assert.ok(source.includes("if (reactions) reactions.hidden = false;"), "Reaction row must stay visible in the shared bottom layout");
console.log("STORIES REGRESSION: all checks passed");

const reactionMigration = readFileSync(new URL("../supabase/migrations/107_story_reactions.sql", import.meta.url), "utf8");
const reactionPrivacyMigration = readFileSync(new URL("../supabase/migrations/109_story_reactions_private_reads.sql", import.meta.url), "utf8");
assert.match(source, /from\('story_reactions'\)\.upsert\(/, "Story reactions must persist to their own table");
assert.match(source, /from\('story_reactions'\)\.delete\(/, "Tapping the selected reaction again must remove it");
assert.match(source, /is-selected/, "Selected reaction must have visible feedback");
assert.match(source, /spawnFlyingEmoji\(next\)/, "New reaction must animate");
assert.match(source, /aria-pressed/, "Reaction selection must be accessible");
assert.match(reactionMigration, /primary key \(story_id, user_id\)/i);
assert.match(reactionMigration, /enable row level security/i);
assert.match(reactionMigration, /user_id = auth\.uid\(\)/i);
assert.match(reactionMigration, /supabase_realtime/i);
console.log("STORY REACTION UX + MIGRATION: all checks passed");
assert.match(reactionPrivacyMigration, /user_id = auth\.uid\(\)/i);
assert.match(reactionPrivacyMigration, /s\.user_id = auth\.uid\(\)/i);
