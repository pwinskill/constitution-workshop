// Matching what someone types on the join page to the people who have joined.

import { sameName, slugify } from './util.js';

// `people`: everyone who could be meant (anyone listed in participants.json,
// then people who joined by typing their name); `rosterCodes`: the listed codes.
// A code (as in a personal link) or a listed name matches directly. A name that
// matches people who typed it themselves needs confirming, because two people
// can share a name, so every such match is returned, oldest first.
export function matchPerson(query, people, rosterCodes = new Set()) {
  const q = String(query ?? '').trim();
  if (!q) return { person: null, matches: [] };
  const code = slugify(q);
  const byCode = people.find((p) => p.code === code);
  if (byCode && (rosterCodes.has(byCode.code) || code === q.toLowerCase())) return { person: byCode, matches: [] };
  const listed = people.find((p) => rosterCodes.has(p.code) && sameName(p.name, q));
  if (listed) return { person: listed, matches: [] };
  const matches = people
    .filter((p) => !rosterCodes.has(p.code) && sameName(p.name, q))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return { person: null, matches };
}
