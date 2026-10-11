import * as os from "node:os";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { buildRecurrenceReport } from "../buglog/recurrence-report.js";

export interface BugRecurrenceOptions {
  transcripts?: string;
  bug?: string;
  match?: string;
  maxFiles?: string;
  maxFileBytes?: string;
  maxTotalBytes?: string;
  excludeSession?: string;
  json?: boolean;
}

export function bugRecurrence(opts: BugRecurrenceOptions): void {
  try {
    const root = findProjectRoot();
    const report = buildRecurrenceReport({
      projectRoot: root,
      transcriptDir: opts.transcripts ?? path.join(os.homedir(), ".claude", "projects", root.replace(/[^a-zA-Z0-9]/g, "-")),
      bugId: opts.bug, match: opts.match, excludeSession: opts.excludeSession,
      maxFiles: opts.maxFiles === undefined ? undefined : Number(opts.maxFiles),
      maxFileBytes: opts.maxFileBytes === undefined ? undefined : Number(opts.maxFileBytes),
      maxTotalBytes: opts.maxTotalBytes === undefined ? undefined : Number(opts.maxTotalBytes),
    });
    if (opts.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Recurrence evidence for ${report.project_root}`);
      console.log(`Coverage: ${report.complete ? "complete within supported scope" : "INCOMPLETE"}; ${report.coverage.files_scanned}/${report.coverage.files_discovered} files, ${report.coverage.bytes_read} bytes, ${report.coverage.explicit_failures} observed explicit failure results.`);
      console.log(`${report.summary.bugs_considered} bugs, ${report.summary.evaluable_fixes} recorded fix watermarks, ${report.summary.distinct_incidents} matching distinct incidents across ${report.summary.distinct_sessions} sessions; ${report.summary.post_fix_possible} possible post-fix matches.`);
      for (const bug of report.bugs) {
        console.log(`${bug.id}: ${bug.counts.distinct_incidents} matches; ${bug.counts.pre_fix} pre-fix, ${bug.counts.post_fix_possible} possible post-fix, ${bug.counts.undated} undated, ${bug.counts.unverified_fix} unverified fix. Fix: ${bug.fix.status} (${bug.fix.reason}; reduction ${bug.fix.reduction_status}).`);
        for (const incident of bug.incidents) console.log(`  ${incident.classification} ${incident.occurred_at ?? "unknown time"} ${incident.source.path}@${incident.source.byte_offset}+${incident.source.byte_length} sha256:${incident.source.record_sha256}`);
      }
      for (const diagnostic of report.diagnostics) console.log(`Coverage diagnostic: ${diagnostic.code}${diagnostic.path ? ` (${diagnostic.path})` : ""}`);
      if (report.diagnostics_omitted) console.log(`${report.diagnostics_omitted} additional diagnostics omitted.`);
      for (const limitation of report.limitations) console.log(`Limit: ${limitation}`);
    }
    if (!report.complete) process.exitCode = 2;
  } catch {
    // Filesystem/parser exceptions can embed raw paths or source data. The
    // machine-readable failure contract deliberately exposes neither.
    console.error("Recurrence report failed: check source directories, bug ledger integrity, selected ID and positive integer limits; --match requires --bug and at least eight characters.");
    process.exitCode = 1;
  }
}
