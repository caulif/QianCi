import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { extname, join, resolve } from 'node:path';
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

function extractLemmaForms(row: DictionarySourceRow): string[] {
  const forms = new Set<string>([row.word.trim().toLowerCase()]);
  const lemma = row.lemma?.trim();
  if (lemma && !lemma.includes(':')) {
    for (const part of lemma.split(/[\/;,|]/)) {
      const normalized = part.trim().toLowerCase();
      if (normalized) {
        forms.add(normalized);
      }
    }
  }

  const exchange = row.exchange?.trim();
  if (exchange) {
    for (const part of exchange.split('/')) {
      const [, value = ''] = part.split(':', 2);
      const normalized = value.trim().toLowerCase();
      if (normalized) {
        forms.add(normalized);
      }
    }
  }

  return Array.from(forms);
}

export function buildDictionaryPack(rows: DictionarySourceRow[], options: BuildDictionaryOptions = {}): DictionaryPack {
  const limit = options.limit ?? 50_000;
  const sorted = rows
    .map((row) => ({
      ...row,
      word: row.word.trim().toLowerCase(),
      phonetic: row.phonetic.trim(),
      translation: normalizeTranslation(row.translation)
    }))
    .filter((row) => row.word && row.translation)
    .map((row) => ({ row, rank: normalizeRank(row) }))
    .filter((item): item is { row: DictionarySourceRow; rank: number } => item.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.row.word.localeCompare(right.row.word));

  const filtered: Array<{ row: DictionarySourceRow; rank: number }> = [];
  const seenWords = new Set<string>();
  for (const item of sorted) {
    if (seenWords.has(item.row.word)) {
      continue;
    }
    seenWords.add(item.row.word);
    filtered.push(item);
    if (filtered.length >= limit) {
      break;
    }
  }

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

    for (const form of extractLemmaForms(item.row)) {
      const existing = Array.isArray(lemma[form]) ? lemma[form] : [];
      if (!existing.includes(item.row.word)) {
        lemma[form] = [...existing, item.row.word];
      }
    }
  }

  return { dictionary, rank, lemma };
}

interface CsvColumnMap {
  word: number;
  phonetic: number;
  definition: number;
  translation: number;
  frq: number;
  bnc: number;
  exchange: number;
  lemma: number;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
        continue;
      }

      field += char;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function pickColumn(header: string[], name: string, fallback = -1): number {
  const index = header.findIndex((column) => column.trim().toLowerCase() === name);
  return index >= 0 ? index : fallback;
}

export function parseDictionaryRowsFromCsv(text: string): DictionarySourceRow[] {
  const [header, ...records] = parseCsv(text).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (!header) {
    return [];
  }

  const columns: CsvColumnMap = {
    word: pickColumn(header, 'word'),
    phonetic: pickColumn(header, 'phonetic'),
    definition: pickColumn(header, 'definition'),
    translation: pickColumn(header, 'translation'),
    frq: pickColumn(header, 'frq'),
    bnc: pickColumn(header, 'bnc'),
    exchange: pickColumn(header, 'exchange'),
    lemma: pickColumn(header, 'lemma')
  };

  return records
    .map((row) => ({
      word: row[columns.word] ?? '',
      phonetic: row[columns.phonetic] ?? '',
      translation: row[columns.translation] || row[columns.definition] || '',
      frq: Number(row[columns.frq] ?? 0),
      bnc: Number(row[columns.bnc] ?? 0),
      exchange: row[columns.exchange] ?? '',
      lemma: row[columns.lemma] || row[columns.exchange] || ''
    }))
    .filter((row) => row.word.trim().length > 0);
}

function parseDictionaryRowsFromJson(text: string): DictionarySourceRow[] {
  return JSON.parse(text) as DictionarySourceRow[];
}

function shouldTreatAsCsv(pathname: string): boolean {
  return extname(pathname).toLowerCase() === '.csv';
}

async function fileExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadSourceRows(inputPath: string): Promise<DictionarySourceRow[]> {
  const text = await readFile(inputPath, 'utf8');
  return shouldTreatAsCsv(inputPath) ? parseDictionaryRowsFromCsv(text) : parseDictionaryRowsFromJson(text);
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

  const inputPath = args.get('input') ? resolve(process.cwd(), args.get('input')!) : undefined;
  const outputDir = resolve(process.cwd(), args.get('output-dir') ?? 'src/data');
  const limit = Number(args.get('limit') ?? '60000');
  const sourcePath = inputPath ?? resolve(process.cwd(), '.cache/ecdict.csv');
  const dictionaryPath = join(outputDir, 'dictionary.generated.json');
  const rankPath = join(outputDir, 'rank.generated.json');

  if (!(await fileExists(sourcePath))) {
    const outputsExist = (await fileExists(dictionaryPath)) && (await fileExists(rankPath));
    if (outputsExist) {
      console.log(`Dictionary source not found at ${sourcePath}, reusing generated pack.`);
      return;
    }
    throw new Error(
      `Dictionary source not found at ${sourcePath}. Download ECDICT CSV there or run with --input <path>.`
    );
  }

  const rows = await loadSourceRows(sourcePath);
  const pack = buildDictionaryPack(rows, { limit });
  await mkdir(outputDir, { recursive: true });
  await writeFile(dictionaryPath, JSON.stringify({ dictionary: pack.dictionary, lemma: pack.lemma }, null, 2), 'utf8');
  await writeFile(rankPath, JSON.stringify(pack.rank, null, 2), 'utf8');
  console.log(`Dictionary pack written to ${outputDir} (${Object.keys(pack.dictionary).length} entries).`);
}

const entryPoint = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (entryPoint) {
  void main();
}
