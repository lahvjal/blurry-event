import { NewParticipantInput } from '@/state/types';

/**
 * Minimal RFC-4180-ish CSV reader. Handles quoted fields containing commas,
 * escaped quotes (""), and CRLF or LF line endings — which covers what Excel,
 * Numbers, and Google Sheets produce.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  // Strip a UTF-8 BOM; Excel loves adding one.
  const input = text.replace(/^﻿/, '');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // Swallow the \n of a \r\n pair.
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  // Trailing field / row when the file doesn't end in a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

const NAME_KEYS = ['name', 'full name', 'fullname', 'player', 'participant'];
const FIRST_KEYS = ['first', 'first name', 'firstname', 'given name'];
const LAST_KEYS = ['last', 'last name', 'lastname', 'surname', 'family name'];
const EMAIL_KEYS = ['email', 'e-mail', 'email address', 'mail'];
const HANDICAP_KEYS = ['handicap', 'hcp', 'index', 'handicap index', 'hdcp'];
const ADMIN_KEYS = ['admin', 'is admin', 'organizer', 'organiser'];

function findColumn(header: string[], keys: string[]): number {
  return header.findIndex((h) => keys.includes(h.trim().toLowerCase()));
}

function looksLikeHeader(row: string[]): boolean {
  const cells = row.map((c) => c.trim().toLowerCase());
  return cells.some((c) =>
    [...NAME_KEYS, ...FIRST_KEYS, ...EMAIL_KEYS, ...HANDICAP_KEYS].includes(c),
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CsvImportResult = {
  rows: NewParticipantInput[];
  /** Human-readable reasons rows were dropped, for the preview screen. */
  skipped: { line: number; reason: string }[];
  /** Column mapping actually used, so the admin can sanity-check it. */
  mapping: string;
};

/**
 * Turns raw CSV text into roster rows.
 *
 * Accepts either a `name` column or separate `first`/`last` columns, and is
 * case-insensitive about headers. With no recognisable header it falls back to
 * positional order: name, email, handicap.
 */
export function parseRoster(text: string): CsvImportResult {
  const table = parseCsv(text);
  const skipped: { line: number; reason: string }[] = [];

  if (table.length === 0) {
    return { rows: [], skipped: [{ line: 0, reason: 'File is empty' }], mapping: '' };
  }

  const hasHeader = looksLikeHeader(table[0]);
  const header = hasHeader ? table[0] : [];
  const body = hasHeader ? table.slice(1) : table;

  const nameIdx = hasHeader ? findColumn(header, NAME_KEYS) : 0;
  const firstIdx = hasHeader ? findColumn(header, FIRST_KEYS) : -1;
  const lastIdx = hasHeader ? findColumn(header, LAST_KEYS) : -1;
  const emailIdx = hasHeader ? findColumn(header, EMAIL_KEYS) : 1;
  const handicapIdx = hasHeader ? findColumn(header, HANDICAP_KEYS) : 2;
  const adminIdx = hasHeader ? findColumn(header, ADMIN_KEYS) : -1;

  const mapping = hasHeader
    ? [
        nameIdx >= 0
          ? `name=${header[nameIdx]}`
          : firstIdx >= 0
            ? `name=${header[firstIdx]}+${lastIdx >= 0 ? header[lastIdx] : '?'}`
            : 'name=?',
        emailIdx >= 0 ? `email=${header[emailIdx]}` : null,
        handicapIdx >= 0 ? `handicap=${header[handicapIdx]}` : null,
        adminIdx >= 0 ? `admin=${header[adminIdx]}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'No header found — using column order: name, email, handicap';

  const rows: NewParticipantInput[] = [];
  const seenNames = new Set<string>();
  const seenEmails = new Set<string>();

  body.forEach((cells, i) => {
    // +1 for the header we consumed, +1 because humans count from 1.
    const line = i + (hasHeader ? 2 : 1);
    const cell = (idx: number) => (idx >= 0 ? (cells[idx] ?? '').trim() : '');

    let fullName = cell(nameIdx);
    if (!fullName && firstIdx >= 0) {
      fullName = [cell(firstIdx), cell(lastIdx)].filter(Boolean).join(' ');
    }
    if (!fullName) {
      skipped.push({ line, reason: 'No name' });
      return;
    }

    const emailRaw = cell(emailIdx).toLowerCase();
    let email: string | null = null;
    if (emailRaw) {
      if (!EMAIL_PATTERN.test(emailRaw)) {
        skipped.push({ line, reason: `Invalid email "${emailRaw}"` });
        return;
      }
      if (seenEmails.has(emailRaw)) {
        skipped.push({ line, reason: `Duplicate email "${emailRaw}"` });
        return;
      }
      seenEmails.add(emailRaw);
      email = emailRaw;
    }

    const nameKey = fullName.toLowerCase();
    if (!email && seenNames.has(nameKey)) {
      skipped.push({ line, reason: `Duplicate name "${fullName}"` });
      return;
    }
    seenNames.add(nameKey);

    const handicapRaw = cell(handicapIdx);
    let handicap: number | null = null;
    if (handicapRaw) {
      const parsed = Number(handicapRaw.replace('+', ''));
      handicap = Number.isNaN(parsed) ? null : parsed;
    }

    const adminRaw = cell(adminIdx).toLowerCase();
    const isAdmin = ['true', 'yes', 'y', '1', 'admin'].includes(adminRaw);

    rows.push({ fullName, email, handicap, isAdmin });
  });

  return { rows, skipped, mapping };
}

/** Sample file contents offered to the admin as a starting point. */
export const CSV_TEMPLATE = `name,email,handicap,admin
Jordan Reed,jordan@example.com,4.2,false
Maya Gomez,maya@example.com,8.4,false
Vel Monroe,vel@example.com,4.7,true
`;
