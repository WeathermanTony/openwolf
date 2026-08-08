import * as path from "node:path";
import { readJSON } from "../utils/fs-safe.js";
import { acquireFileLock, atomicWriteJson } from "../utils/size-discipline.js";

interface BugEntry {
  id: string;
  timestamp: string;
  error_message: string;
  file: string;
  line?: number;
  root_cause: string;
  fix: string;
  tags: string[];
  related_bugs: string[];
  occurrences: number;
  last_seen: string;
  commit: string | null;
  reduction: string | null;
}

interface BugLog {
  version: number;
  bugs: BugEntry[];
}

export function getBugLogPath(wolfDir: string): string {
  return path.join(wolfDir, "buglog.json");
}

export function readBugLog(wolfDir: string): BugLog {
  const bugLog = readJSON<BugLog>(getBugLogPath(wolfDir), { version: 1, bugs: [] });
  for (const entry of bugLog.bugs || []) {
    if (!Object.prototype.hasOwnProperty.call(entry, "commit")) entry.commit = null;
    if (!Object.prototype.hasOwnProperty.call(entry, "reduction")) entry.reduction = null;
  }
  return bugLog;
}

export function logBug(
  wolfDir: string,
  bug: {
    error_message: string;
    file: string;
    line?: number;
    root_cause: string;
    fix: string;
    tags: string[];
    commit?: string | null;
    reduction?: string | null;
  }
): void {
  const bugLogPath = getBugLogPath(wolfDir);
  const release = acquireFileLock(bugLogPath);
  if (!release) throw new Error(`could not lock ${bugLogPath}`);

  try {
    // Reread after lock acquisition so similarity, allocation, and persistence
    // all operate on one current snapshot.
    const bugLog = readBugLog(wolfDir);
    const now = new Date().toISOString();
    for (const entry of bugLog.bugs) {
      if (!Object.prototype.hasOwnProperty.call(entry, "commit")) entry.commit = null;
      if (!Object.prototype.hasOwnProperty.call(entry, "reduction")) entry.reduction = null;
    }

    const similar = findSimilarBugsInLog(bugLog, bug.error_message);
    if (similar.length > 0 && similar[0].score > 0.8) {
      // ScoredBug carries the exact array object, avoiding ambiguous ID lookup
      // in historical logs where one ID may occur more than once.
      const existing = similar[0].bug;
      existing.occurrences++;
      existing.last_seen = now;
      if (bug.commit) existing.commit = bug.commit;
      if (bug.reduction) existing.reduction = bug.reduction;
      if (!atomicWriteJson(bugLogPath, bugLog)) throw new Error(`could not atomically write ${bugLogPath}`);
      return;
    }

    const maxId = bugLog.bugs.reduce((max, entry) => {
      const match = /^bug-(\d+)$/.exec(entry.id);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    const id = `bug-${String(maxId + 1).padStart(3, "0")}`;
    bugLog.bugs.push({
      id,
      timestamp: now,
      error_message: bug.error_message,
      file: bug.file,
      line: bug.line,
      root_cause: bug.root_cause,
      fix: bug.fix,
      tags: bug.tags,
      related_bugs: [],
      occurrences: 1,
      last_seen: now,
      commit: bug.commit ?? null,
      reduction: bug.reduction ?? null,
    });

    if (!atomicWriteJson(bugLogPath, bugLog)) throw new Error(`could not atomically write ${bugLogPath}`);
  } finally {
    release();
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "N").replace(/[^\w\s]/g, " ").trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalize(text).split(/\s+/).filter((w) => w.length > 2));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

interface ScoredBug {
  bug: BugEntry;
  score: number;
}

function findSimilarBugsInLog(bugLog: BugLog, errorMessage: string): ScoredBug[] {
  const normalizedInput = normalize(errorMessage);
  const inputTokens = tokenize(errorMessage);
  const results: ScoredBug[] = [];

  for (const bug of bugLog.bugs) {
    let score = 0;

    // Exact substring match
    if (
      normalize(bug.error_message).includes(normalizedInput) ||
      normalizedInput.includes(normalize(bug.error_message))
    ) {
      score += 1.0;
    }

    // Word overlap (jaccard)
    const bugTokens = tokenize(bug.error_message);
    score += jaccardSimilarity(inputTokens, bugTokens) * 0.5;

    if (score > 0.3) {
      results.push({ bug, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export function findSimilarBugs(wolfDir: string, errorMessage: string): ScoredBug[] {
  return findSimilarBugsInLog(readBugLog(wolfDir), errorMessage);
}

export function searchBugs(wolfDir: string, term: string): BugEntry[] {
  const bugLog = readBugLog(wolfDir);
  const lower = term.toLowerCase();
  return bugLog.bugs.filter(
    (b) =>
      b.error_message.toLowerCase().includes(lower) ||
      b.root_cause.toLowerCase().includes(lower) ||
      b.fix.toLowerCase().includes(lower) ||
      b.tags.some((t) => t.toLowerCase().includes(lower)) ||
      b.file.toLowerCase().includes(lower)
  );
}
