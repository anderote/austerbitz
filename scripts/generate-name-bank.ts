// Generate the name bank for soldier identity.
// Run with: npx tsx scripts/generate-name-bank.ts
//
// If XAI_API_KEY is set, calls the xAI Grok API once per (theme, pool-kind)
// to fetch period-appropriate names. Otherwise writes a hand-curated inline
// fallback bank. Always writes src/data/name-bank.json (overwrite).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type PoolKind = 'firstNames' | 'lastNames' | 'hometowns';
type ThemeName = 'english' | 'french';

interface ThemePools {
  firstNames: string[];
  lastNames: string[];
  hometowns: string[];
}

interface NameBank {
  version: number;
  themes: Record<string, ThemePools>;
}

// ---------------------------------------------------------------------------
// Inline fallback bank (≈40/40/30 per theme, hand-curated, period-appropriate).
// ---------------------------------------------------------------------------

const FALLBACK: Record<ThemeName, ThemePools> = {
  english: {
    firstNames: [
      'John', 'William', 'James', 'Thomas', 'Henry', 'George', 'Charles', 'Robert',
      'Edward', 'Richard', 'Joseph', 'Samuel', 'Daniel', 'Benjamin', 'Matthew',
      'Andrew', 'David', 'Patrick', 'Michael', 'Hugh', 'Alexander', 'Donald',
      'Angus', 'Owen', 'Rhys', 'Llewellyn', 'Conor', 'Seamus', 'Aidan', 'Francis',
      'Walter', 'Roger', 'Simon', 'Peter', 'Jacob', 'Nathaniel', 'Stephen',
      'Oliver', 'Albert', 'Frederick',
    ],
    lastNames: [
      'Smith', 'Jones', 'Brown', 'Williams', 'Taylor', 'Davies', 'Wilson',
      'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Robinson', 'Thompson',
      'White', 'Hughes', 'Green', 'Hall', 'Wood', 'Harris', 'Clarke', 'Cooper',
      'Edwards', 'Murphy', "O'Brien", 'MacDonald', 'Campbell', 'Stewart',
      'MacGregor', 'Fletcher', 'Carter', 'Morgan', 'Reid', 'Henderson',
      'Sinclair', 'Doyle', 'Quinn', 'Morris', 'Bennett', 'Foster',
    ],
    hometowns: [
      'London', 'Bristol', 'Liverpool', 'Manchester', 'Birmingham', 'Sheffield',
      'Leeds', 'Nottingham', 'Norwich', 'Plymouth', 'Portsmouth', 'York',
      'Newcastle', 'Edinburgh', 'Glasgow', 'Aberdeen', 'Inverness', 'Stirling',
      'Cardiff', 'Swansea', 'Caernarfon', 'Wrexham', 'Dublin', 'Cork', 'Belfast',
      'Limerick', 'Galway', 'Bath', 'Oxford', 'Cambridge',
    ],
  },
  french: {
    firstNames: [
      'Jean', 'Pierre', 'Louis', 'Jacques', 'François', 'Henri', 'Antoine',
      'Étienne', 'Charles', 'Joseph', 'Michel', 'André', 'Claude', 'Bernard',
      'Philippe', 'Alexandre', 'Nicolas', 'Gilles', 'Marc', 'Auguste', 'Honoré',
      'Émile', 'René', 'Hugues', 'Vincent', 'Olivier', 'Damien', 'Mathieu',
      'Lucien', 'Édouard', 'Maurice', 'Adrien', 'Théodore', 'Sébastien',
      'Augustin', 'Frédéric', 'Bertrand', 'Roland', 'Gérard', 'Léon',
    ],
    lastNames: [
      'Martin', 'Dubois', 'Lefebvre', 'Moreau', 'Laurent', 'Simon', 'Michel',
      'Lefèvre', 'Leroy', 'Roux', 'David', 'Bertrand', 'Morel', 'Fournier',
      'Girard', 'Bonnet', 'Dupont', 'Lambert', 'Fontaine', 'Rousseau', 'Vincent',
      'Muller', 'Mercier', 'Dupuis', 'Lemoine', 'Faure', 'André', 'Blanc',
      'Guérin', 'Bouvier', 'Brun', 'Marchand', 'Carpentier', 'Robin',
      'Boulanger', 'Renard', 'Gauthier', 'Perrot', 'Chevalier', 'Garnier',
    ],
    hometowns: [
      'Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse', 'Nantes',
      'Strasbourg', 'Lille', 'Rouen', 'Reims', 'Nice', 'Montpellier', 'Rennes',
      'Grenoble', 'Dijon', 'Angers', 'Le Havre', 'Toulon', 'Brest', 'Nîmes',
      'Limoges', 'Tours', 'Amiens', 'Metz', 'Besançon', 'Orléans', 'Caen',
      'Avignon', 'Poitiers', 'Versailles',
    ],
  },
};

// ---------------------------------------------------------------------------
// Prompts.
// ---------------------------------------------------------------------------

const PROMPTS: Record<ThemeName, Record<PoolKind, string>> = {
  english: {
    firstNames:
      'Return JSON {"items": [...]} with 400 unique masculine given names typical of British, Scottish, Welsh, and Irish soldiers c.1800–1815. Plain ASCII, no diacritics, no titles, just the given name.',
    lastNames:
      'Return JSON {"items": [...]} with 400 unique surnames common in the British Isles c.1800. Plain ASCII, no diacritics.',
    hometowns:
      'Return JSON {"items": [...]} with 200 unique real towns and cities in England, Scotland, Wales, or Ireland that existed c.1805. Plain ASCII; use anglicized spellings.',
  },
  french: {
    firstNames:
      'Return JSON {"items": [...]} with 400 unique masculine given names typical of French soldiers under Napoleon c.1800–1815. Use French spellings with diacritics where natural.',
    lastNames:
      'Return JSON {"items": [...]} with 400 unique surnames common in France c.1800. Use French spellings with diacritics where natural.',
    hometowns:
      'Return JSON {"items": [...]} with 200 unique real towns and cities in France (within Napoleonic-era borders) that existed c.1805. Use French spellings with diacritics.',
  },
};

const MAX_POOL = 65535;
const MIN_VALID = 20;

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function dedupeAndClean(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of items) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_POOL) break;
  }
  return out;
}

async function callGrok(apiKey: string, prompt: string): Promise<string[]> {
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-4',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    throw new Error(`xAI API error ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('xAI response missing message content');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`xAI response is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('xAI response JSON is not an object');
  }
  const items = (parsed as { items?: unknown }).items;
  return dedupeAndClean(items);
}

async function buildThemePool(
  apiKey: string | undefined,
  theme: ThemeName,
  kind: PoolKind,
): Promise<string[]> {
  const fallback = FALLBACK[theme][kind];
  if (!apiKey) return fallback;
  try {
    const items = await callGrok(apiKey, PROMPTS[theme][kind]);
    if (items.length < MIN_VALID) {
      console.warn(
        `[name-bank] ${theme}/${kind}: only ${items.length} valid items returned (< ${MIN_VALID}); falling back to inline pool.`,
      );
      return fallback;
    }
    return items;
  } catch (err) {
    console.warn(
      `[name-bank] ${theme}/${kind}: API call failed (${(err as Error).message}); falling back to inline pool.`,
    );
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = process.env['XAI_API_KEY'];
  const themes: ThemeName[] = ['english', 'french'];
  const bank: NameBank = { version: 1, themes: {} };

  if (!apiKey) {
    console.warn(
      '[name-bank] XAI_API_KEY not set — writing hand-curated inline fallback bank.',
    );
  } else {
    console.log('[name-bank] XAI_API_KEY set — calling xAI Grok API for each pool.');
  }

  for (const theme of themes) {
    const [firstNames, lastNames, hometowns] = await Promise.all([
      buildThemePool(apiKey, theme, 'firstNames'),
      buildThemePool(apiKey, theme, 'lastNames'),
      buildThemePool(apiKey, theme, 'hometowns'),
    ]);
    bank.themes[theme] = { firstNames, lastNames, hometowns };
  }

  // Resolve output path relative to this script.
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, '..', 'src', 'data', 'name-bank.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(bank, null, 2) + '\n', 'utf8');

  const summary = themes
    .map((t) => {
      const p = bank.themes[t]!;
      return `${t}: ${p.firstNames.length}/${p.lastNames.length}/${p.hometowns.length}`;
    })
    .join(', ');
  console.log(`[name-bank] wrote ${outPath}`);
  console.log(`[name-bank] ${summary}`);
}

main().catch((err) => {
  console.error('[name-bank] fatal:', err);
  process.exit(1);
});
