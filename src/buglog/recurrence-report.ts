import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export interface RecurrenceOptions {
  projectRoot: string;
  transcriptDir: string;
  bugId?: string;
  match?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  excludeSession?: string;
}

type Json = Record<string, any>;
type Classification = "pre_fix" | "post_fix_possible" | "undated" | "unverified_fix";
interface Source { path: string; byte_offset: number; byte_length: number; record_sha256: string }
interface Failure {
  id: string; session_id: string; tool_use_id: string; occurred_at: string | null;
  text: string; fingerprint: string; source: Source; cwd: string;
}
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const normalize = (value: string) => value.replace(/\s+/gu, " ").trim();
const positive = (value: number | undefined, fallback: number, name: string) => {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive safe integer`);
  return number;
};
const contained = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const timestamp = (value: unknown): string | null => {
  // Require an explicit timezone; Date.parse's locale and numeric fallbacks are not evidence.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
};

function readLedger(file: string): Json[] {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error("Bug ledger is not a bounded regular file");
  let document;
  try { document = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error("Bug ledger could not be parsed"); }
  const entries = Array.isArray(document) ? document : document?.bugs;
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.id !== "string" || !/^bug-\d+$/.test(entry.id))) {
    throw new Error("Bug ledger has an unsupported record shape");
  }
  return entries;
}

function resolveGit(): string | null {
  const candidates = [process.env.WOLFPACK_GIT_BIN, "git"];
  if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe");
    if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "Programs", "Git", "cmd", "git.exe"));
  }
  for (const binary of candidates.filter((value): value is string => Boolean(value))) {
    try {
      execFileSync(binary, ["--version"], { timeout: 2000, stdio: "ignore" });
      return binary;
    } catch { /* Try the next explicitly supported location. */ }
  }
  return null;
}

function fixEvidence(bug: Json, root: string, git: string | null) {
  let commit: string | null = null;
  let committedAt: string | null = null;
  let reason = "missing-commit";
  if (typeof bug.commit === "string" && /^[a-fA-F0-9]{7,64}$/.test(bug.commit) && git) {
    try {
      // No transcript-derived command, shell, refs, pathspecs, or Git mutation.
      const output = execFileSync(git, ["--no-replace-objects", "show", "--no-patch", "--format=%H%n%cI", `${bug.commit}^{commit}`, "--"], {
        cwd: root, encoding: "utf8", timeout: 2000, maxBuffer: 4096,
        stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      }).trim().split(/\r?\n/);
      if (/^[a-fA-F0-9]{40,64}$/.test(output[0]) && timestamp(output[1])) {
        commit = output[0]; committedAt = timestamp(output[1]); reason = "recorded-commit-time";
      } else reason = "invalid-commit-time";
    } catch { reason = "commit-unresolvable"; }
  } else if (bug.commit) reason = git ? "invalid-commit" : "git-unavailable";
  let reductionStatus = "missing";
  if (typeof bug.reduction === "string" && bug.reduction.trim()) {
    const reduction = path.resolve(root, bug.reduction);
    if (!contained(root, reduction)) reductionStatus = "outside-project";
    else {
      try {
        const real = fs.realpathSync(reduction);
        reductionStatus = contained(root, real) && fs.statSync(real).isFile() ? "present-not-executed" : "outside-project-or-not-file";
      } catch { reductionStatus = "unavailable"; }
    }
  }
  const recorded = bug.status === "resolved" && commit !== null && reductionStatus === "present-not-executed";
  return { status: recorded ? "recorded" : "unverified", commit, committed_at: committedAt, reduction_status: reductionStatus, reason };
}

export function buildRecurrenceReport(options: RecurrenceOptions) {
  const limits = {
    max_files: positive(options.maxFiles, 200, "max-files"),
    max_file_bytes: positive(options.maxFileBytes, 8 * 1024 * 1024, "max-file-bytes"),
    max_total_bytes: positive(options.maxTotalBytes, 64 * 1024 * 1024, "max-total-bytes"),
  };
  if (options.match !== undefined && (!options.bugId || typeof options.match !== "string" || normalize(options.match).length < 8)) {
    throw new Error("match requires one selected bug and at least eight literal characters");
  }
  const root = fs.realpathSync(options.projectRoot);
  if (!fs.statSync(path.join(root, ".wolf")).isDirectory()) throw new Error("Project has no .wolf directory");
  const directory = fs.realpathSync(options.transcriptDir);
  if (!fs.statSync(directory).isDirectory()) throw new Error("Transcript source is not a directory");
  const diagnostics: { code: string; path?: string }[] = [];
  let diagnosticCount = 0;
  let complete = true;
  const diagnose = (code: string, source?: string) => {
    complete = false; diagnosticCount++;
    if (diagnostics.length < 100) diagnostics.push({ code, ...(source ? { path: source } : {}) });
  };
  const ledgerFiles = [path.join(root, ".wolf", "buglog.json")];
  const archive = path.join(root, ".wolf", "archive");
  if (fs.existsSync(archive)) {
    if (!fs.lstatSync(archive).isDirectory() || fs.lstatSync(archive).isSymbolicLink()) throw new Error("Bug archive is not a regular directory");
    ledgerFiles.push(...fs.readdirSync(archive).filter(name => /^buglog-\d{4}-\d{2}\.json$/.test(name)).sort().map(name => path.join(archive, name)));
  }
  const ledger: Json[] = ledgerFiles.flatMap(file => readLedger(file).map(bug => ({ ...bug, ledger_path: path.relative(root, file).replace(/\\/g, "/") })));
  const groups = new Map<string, Json[]>();
  for (const bug of ledger) groups.set(bug.id, [...(groups.get(bug.id) ?? []), bug]);
  if (options.bugId && !groups.has(options.bugId)) throw new Error("Selected bug ID was not found");
  const unique: Json[] = [];
  const ambiguousIds: string[] = [];
  let coalescedCopies = 0;
  for (const [id, copies] of groups) {
    const signatures = new Set(copies.map(bug => sha(JSON.stringify([
      bug.error_message, bug.file ?? null, bug.commit ?? null, bug.reduction ?? null, bug.status ?? "open",
    ]))));
    if (signatures.size !== 1) {
      ambiguousIds.push(id);
      if (!options.bugId || options.bugId === id) diagnose("ambiguous-bug-id");
      if (options.bugId === id) throw new Error("Selected bug ID has conflicting ledger records");
      continue;
    }
    coalescedCopies += copies.length - 1;
    unique.push(copies[0]);
  }
  const selected = unique.filter(bug => options.bugId ? bug.id === options.bugId : bug.status === "resolved");
  const git = selected.length ? resolveGit() : null;
  const bugs = selected.map(bug => {
    const literal = normalize(options.match ?? (typeof bug.error_message === "string" ? bug.error_message : ""));
    if (literal.length < 8) diagnose("unusable-error-signature", bug.ledger_path);
    return { bug, literal, fix: fixEvidence(bug, root, git) };
  });
  const coverage = {
    files_discovered: 0, files_scanned: 0, bytes_read: 0, truncated_files: 0,
    records: 0, malformed_records: 0, unsupported_records: 0, tool_calls: 0, tool_results: 0,
    explicit_failures: 0, successful_results: 0, unknown_results: 0, excluded_subagents: 0,
    excluded_sessions: 0, foreign_records: 0, unscoped_records: 0, unattributed_results: 0,
    ambiguous_calls: 0, missing_timestamps: 0, duplicate_incidents: 0, conflicting_incidents: 0,
  };
  const ownerCache = new Map<string, string | null>();
  const owner = (cwd: unknown): string | null => {
    if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return null;
    if (ownerCache.has(cwd)) return ownerCache.get(cwd)!;
    let found: string | null = null;
    try {
      let dir = fs.realpathSync(cwd);
      if (fs.statSync(dir).isDirectory()) {
        while (true) {
          if (fs.existsSync(path.join(dir, ".wolf"))) { found = dir; break; }
          const parent = path.dirname(dir);
          if (parent === dir) break;
          dir = parent;
        }
      }
    } catch { /* Missing cwd cannot be attributed from a transcript filename. */ }
    ownerCache.set(cwd, found);
    return found;
  };
  const calls = new Map<string, { name: string; cwd: string; fingerprint: string }>();
  const conflictedCalls = new Set<string>();
  const failures = new Map<string, Failure>();
  const conflictedResults = new Set<string>();
  const outcomes = new Map<string, string>();
  const key = (session: string, tool: string) => sha(JSON.stringify([session, tool]));
  const files = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.name.endsWith(".jsonl"));
  coverage.files_discovered = files.length;
  const regular: { file: string; size: number; mtime: number }[] = [];
  for (const entry of files) {
    const file = path.join(directory, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) { diagnose("non-regular-transcript", file); continue; }
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) { diagnose("non-regular-transcript", file); continue; }
      regular.push({ file, size: stat.size, mtime: stat.mtimeMs });
    } catch { diagnose("unreadable-transcript", file); }
  }
  regular.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file));
  if (regular.length > limits.max_files) diagnose("file-limit");
  for (const { file, size } of regular.slice(0, limits.max_files)) {
    const available = limits.max_total_bytes - coverage.bytes_read;
    if (available <= 0 && size > 0) { diagnose("total-byte-limit"); break; }
    const length = Math.min(size, limits.max_file_bytes, available);
    const start = size - length;
    let bytes: Buffer;
    let fd: number | undefined;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size !== size) { diagnose("source-changed", file); continue; }
      bytes = Buffer.alloc(length);
      const read = fs.readSync(fd, bytes, 0, length, start);
      if (read !== length) { diagnose("short-read", file); continue; }
      coverage.bytes_read += read; coverage.files_scanned++;
    } catch { diagnose("unreadable-transcript", file); continue; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    let offset = 0;
    if (start > 0) {
      coverage.truncated_files++; diagnose("tail-truncated", file);
      // Even when the cut happens to be on a boundary, discard the first row;
      // it cannot be shown to be complete without reading the preceding byte.
      const newline = bytes.indexOf(10);
      offset = newline < 0 ? bytes.length : newline + 1;
    }
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset);
      const end = newline < 0 ? bytes.length : newline;
      const raw = bytes.subarray(offset, end);
      const byteOffset = start + offset;
      offset = newline < 0 ? bytes.length : newline + 1;
      if (!raw.length) continue;
      coverage.records++;
      let row: Json;
      try {
        row = JSON.parse(raw.toString("utf8"));
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error();
      } catch { coverage.malformed_records++; diagnose("malformed-record", file); continue; }
      if (row.isSidechain === true || row.agentId) { coverage.excluded_subagents++; continue; }
      const session = row.sessionId ?? row.session_id;
      if (session === options.excludeSession) { coverage.excluded_sessions++; continue; }
      if (row.type !== "assistant" && row.type !== "user") continue;
      const blocks = row.message?.content;
      if (typeof blocks === "string") continue;
      const project = owner(row.cwd);
      // A foreign owner's unsupported records cannot degrade this report.
      // Check scope before diagnosing message or content-block structure.
      if (project && project !== root) { coverage.foreign_records++; continue; }
      if (!Array.isArray(blocks) || row.message?.role !== row.type) {
        coverage.unsupported_records++; diagnose("unsupported-message-shape", file); continue;
      }
      if (blocks.some(block => !block || typeof block !== "object" || typeof block.type !== "string" ||
          (block.type.includes("tool") && block.type !== "tool_use" && block.type !== "tool_result"))) {
        coverage.unsupported_records++; diagnose("unsupported-content-block", file);
      }
      const eventBlocks = blocks.filter(block => block && (block.type === "tool_use" || block.type === "tool_result"));
      if (!eventBlocks.length) continue;
      if (!project || typeof session !== "string" || !session || (row.sessionId && row.session_id && row.sessionId !== row.session_id)) {
        coverage.unscoped_records++; diagnose("unscoped-tool-record", file); continue;
      }
      for (const block of eventBlocks) {
        if (block.type === "tool_use" && row.type === "assistant") {
          coverage.tool_calls++;
          if (typeof block.id !== "string" || !block.id || typeof block.name !== "string" || !block.name) {
            coverage.unsupported_records++; diagnose("unsupported-tool-call", file); continue;
          }
          const id = key(session, block.id);
          // Shell target changes and explicit foreign file paths are not safe
          // project attribution. This is conservative, not a shell parser.
          const command = block.input?.command;
          const target = block.input?.file_path;
          if ((typeof command === "string" && /(?:^|[;&|\n])\s*(?:cd|pushd|popd)\b|(?:^|\s)(?:-C|--prefix|--cwd|--directory|--root)(?:\s|=)/.test(command)) ||
              (typeof target === "string" && (!contained(root, path.resolve(row.cwd, target)) || owner(path.dirname(path.resolve(row.cwd, target))) !== root))) {
            coverage.ambiguous_calls++; conflictedCalls.add(id); diagnose("ambiguous-tool-target", file); continue;
          }
          const fingerprint = sha(JSON.stringify([block.name, fs.realpathSync(row.cwd), block.input ?? null]));
          const previous = calls.get(id);
          if (previous && previous.fingerprint !== fingerprint) { conflictedCalls.add(id); diagnose("conflicting-tool-call", file); }
          else calls.set(id, { name: block.name, cwd: fs.realpathSync(row.cwd), fingerprint });
        } else if (block.type === "tool_result" && row.type === "user") {
          coverage.tool_results++;
          if (typeof block.tool_use_id !== "string" || !block.tool_use_id) {
            coverage.unsupported_records++; diagnose("unsupported-tool-result", file); continue;
          }
          const id = key(session, block.tool_use_id);
          const time = timestamp(row.timestamp);
          const fingerprint = sha(JSON.stringify([block.content, block.is_error ?? null, time, fs.realpathSync(row.cwd)]));
          const previous = outcomes.get(id);
          if (previous && previous !== fingerprint) {
            if (!conflictedResults.has(id)) coverage.conflicting_incidents++;
            conflictedResults.add(id); diagnose("conflicting-tool-result", file);
          } else if (previous) coverage.duplicate_incidents++;
          else outcomes.set(id, fingerprint);
          if (block.is_error !== true) {
            if (block.is_error === false) coverage.successful_results++; else coverage.unknown_results++;
            continue;
          }
          coverage.explicit_failures++;
          let text: string;
          if (typeof block.content === "string") text = block.content;
          else if (Array.isArray(block.content) && block.content.every((part: Json) => part?.type === "text" && typeof part.text === "string")) text = block.content.map((part: Json) => part.text).join("\n");
          else { coverage.unsupported_records++; diagnose("unsupported-error-content", file); continue; }
          if (!time) coverage.missing_timestamps++;
          if (!failures.has(id)) failures.set(id, {
            id, session_id: session, tool_use_id: block.tool_use_id, occurred_at: time,
            text: normalize(text), fingerprint, cwd: fs.realpathSync(row.cwd),
            source: { path: file, byte_offset: byteOffset, byte_length: raw.length, record_sha256: sha(raw) },
          });
        } else { coverage.unsupported_records++; diagnose("unsupported-tool-role", file); }
      }
    }
    try {
      const after = fs.lstatSync(file);
      if (!after.isFile() || after.size !== size || after.mtimeMs !== regular.find(source => source.file === file)!.mtime) diagnose("source-changed-during-scan", file);
    } catch { diagnose("source-changed-during-scan", file); }
  }
  const eligible: (Failure & { tool_name: string })[] = [];
  for (const failure of failures.values()) {
    const call = calls.get(failure.id);
    if (conflictedCalls.has(failure.id) || conflictedResults.has(failure.id)) continue;
    if (!call || call.cwd !== failure.cwd) { coverage.unattributed_results++; diagnose("unattributed-failure", failure.source.path); continue; }
    eligible.push({ ...failure, tool_name: call.name });
  }
  eligible.sort((a, b) => (a.occurred_at ?? "").localeCompare(b.occurred_at ?? "") || a.id.localeCompare(b.id));
  const matched = new Set<string>();
  const postFix = new Set<string>();
  const sessions = new Set<string>();
  const results = bugs.map(({ bug, literal, fix }) => {
    const counts = { distinct_incidents: 0, distinct_sessions: 0, pre_fix: 0, post_fix_possible: 0, undated: 0, unverified_fix: 0 };
    const bugSessions = new Set<string>();
    const incidents = eligible.filter(event => literal.length >= 8 && event.text.includes(literal)).map(event => {
      const classification: Classification = !event.occurred_at ? "undated" : fix.status !== "recorded" ? "unverified_fix" :
        Date.parse(event.occurred_at) <= Date.parse(fix.committed_at!) ? "pre_fix" : "post_fix_possible";
      counts[classification]++; matched.add(event.id); sessions.add(event.session_id); bugSessions.add(event.session_id);
      if (classification === "post_fix_possible") postFix.add(event.id);
      return { id: event.id, session_id: event.session_id, tool_use_id: event.tool_use_id, tool_name: event.tool_name,
        occurred_at: event.occurred_at, classification, source: event.source };
    });
    counts.distinct_incidents = incidents.length; counts.distinct_sessions = bugSessions.size;
    return { id: bug.id, ledger_path: bug.ledger_path, fix,
      signature: { kind: options.match === undefined ? "ledger-error" : "explicit-literal", sha256: sha(literal) }, counts, incidents };
  });
  return {
    schema_version: 1, project_root: root, transcript_directory: directory, source: "claude-code", complete, limits, coverage,
    diagnostics, diagnostics_omitted: diagnosticCount - diagnostics.length,
    ledger_coverage: { files: ledgerFiles.length, records: ledger.length, coalesced_copies: coalescedCopies, ambiguous_ids: ambiguousIds },
    summary: { bugs_considered: results.length, evaluable_fixes: results.filter(bug => bug.fix.status === "recorded").length,
      matched_bugs: results.filter(bug => bug.counts.distinct_incidents > 0).length, distinct_incidents: matched.size,
      post_fix_possible: postFix.size, distinct_sessions: sessions.size },
    bugs: results,
    limitations: [
      "Exact whitespace-normalized error association is not proof of a shared root cause; signatures may miss differently worded failures.",
      "Commit committer time is a declared-fix watermark, not proof the fixed revision or runtime was in use. Reduction existence is not passing validation.",
      "Only direct top-level Claude Code JSONL tool_use/tool_result records with explicit is_error:true and attributable cwd are considered. Subagents are excluded.",
      "Recorded cwd scopes the session, not every tool's actual execution target. Obvious shell target changes are excluded; shell commands are never executed or fully interpreted.",
      "File mtime selects bounded scan order only. Missing event timestamps stay undated; skipped, malformed, ambiguous or tail-limited evidence makes coverage incomplete.",
      "Results are local read-only evidence, not authenticated history. No bug status, learning, hook or persistent recurrence state is changed.",
    ],
  };
}
