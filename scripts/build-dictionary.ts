import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export interface DictionarySourceRow {
  word: string;
  phonetic: string;
  translation: string;
  frq: number;
  bnc: number;
  exchange?: string;
  lemma?: string;
}

export interface DictionaryPackEntry {
  word: string;
  phonetic: string;
  translation: string;
  rank: number;
}

export interface DictionaryPack {
  dictionary: Record<string, DictionaryPackEntry>;
  rank: Record<string, number>;
  lemma: Record<string, string[]>;
}

export interface BuildDictionaryOptions {
  limit?: number;
}

function normalizeTranslation(translation: string): string {
  return translation
    .split(/\r?\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('；');
}

function normalizeRank(row: DictionarySourceRow): number | null {
  const candidates = [row.frq, row.bnc].filter((value) => Number.isFinite(value) && value > 0);
  if (!candidates.length) {
    return null;
  }
  return Math.min(...candidates);
}

function normalizeLemma(row: DictionarySourceRow): string[] {
  const lemma = row.lemma?.trim();
  if (lemma) {
    return [lemma.toLowerCase()];
  }
  return [row.word.trim().toLowerCase()];
}

export function buildDictionaryPack(rows: DictionarySourceRow[], options: BuildDictionaryOptions = {}): DictionaryPack {
  const limit = options.limit ?? 50_000;
  const filtered = rows
    .map((row) => ({
      ...row,
      word: row.word.trim().toLowerCase(),
      phonetic: row.phonetic.trim(),
      translation: normalizeTranslation(row.translation)
    }))
    .filter((row) => row.word && row.translation)
    .map((row) => ({ row, rank: normalizeRank(row) }))
    .filter((item): item is { row: DictionarySourceRow; rank: number } => item.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.row.word.localeCompare(right.row.word))
    .slice(0, limit);

  const dictionary: Record<string, DictionaryPackEntry> = {};
  const rank: Record<string, number> = {};
  const lemma: Record<string, string[]> = {};

  for (const item of filtered) {
    dictionary[item.row.word] = {
      word: item.row.word,
      phonetic: item.row.phonetic,
      translation: item.row.translation,
      rank: item.rank
    };
    rank[item.row.word] = item.rank;
    lemma[item.row.word] = normalizeLemma(item.row);
  }

  return { dictionary, rank, lemma };
}

async function main(): Promise<void> {
  const args = new Map<string, string>();
  const tokens = process.argv.slice(2);
  for (let i = 0; i < tokens.length; i += 2) {
    const key = tokens[i];
    const value = tokens[i + 1];
    if (key?.startsWith('--') && value) {
      args.set(key.slice(2), value);
    }
  }

  const inputPath = args.get('input');
  const outputPath = args.get('output');
  if (!inputPath || !outputPath) {
    throw new Error('Usage: tsx scripts/build-dictionary.ts --input source.json --output dist/dictionary.json');
  }

  const rows = JSON.parse(await readFile(inputPath, 'utf8')) as DictionarySourceRow[];
  const pack = buildDictionaryPack(rows);
  await writeFile(outputPath, JSON.stringify(pack, null, 2), 'utf8');
}

const entryPoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (entryPoint) {
  void main();
}
