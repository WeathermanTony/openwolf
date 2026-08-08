import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import { auditProjectLedgers, repairLedger, type LedgerAudit, type RepairResult } from "../ledger/ledger-integrity.js";
import { getRegisteredProjects } from "./registry.js";

export interface LedgerCommandOptions {
  project?: string;
  fleet?: boolean;
  apply?: boolean;
  json?: boolean;
}

interface ProjectReport {
  project: string;
  ledgers: Array<LedgerAudit | RepairResult>;
}

function roots(options: LedgerCommandOptions): string[] {
  if (options.fleet) return getRegisteredProjects(false).map((project) => project.root);
  return [path.resolve(options.project ?? findProjectRoot())];
}

function aggregate(reports: ProjectReport[]): Record<string, number> {
  const counts: Record<string, number> = { projects: reports.length, clean: 0, repairable: 0, malformed: 0, unreadable: 0, "lock-blocked": 0, repaired: 0, verified: 0, incomplete_receipts: 0, records_preserved: 0, ids_rekeyed: 0, ambiguous_references_retained: 0 };
  for (const report of reports) for (const ledger of report.ledgers) {
    counts[ledger.classification] = (counts[ledger.classification] ?? 0) + 1;
    if ("applied" in ledger) {
      if (ledger.applied) counts.repaired++;
      if (ledger.applied && ledger.verified) counts.verified++;
      if (ledger.incompleteReceipt) counts.incomplete_receipts++;
      if (ledger.applied && ledger.verified) counts.records_preserved += ledger.recordCount;
      counts.ids_rekeyed += ledger.mappings.length;
    }
    if ("ambiguousReferences" in ledger) counts.ambiguous_references_retained += ledger.ambiguousReferences.reduce((sum, item) => sum + item.count, 0);
  }
  return counts;
}

function print(report: { mode: string; apply: boolean; reports: ProjectReport[]; counts: Record<string, number> }, json?: boolean): void {
  if (json) return void console.log(JSON.stringify(report, null, 2));
  console.log(`Wolfpack ledger ${report.mode}${report.apply ? " (apply)" : " (dry-run)"}`);
  for (const project of report.reports) {
    console.log(`  ${project.project}`);
    for (const ledger of project.ledgers) console.log(`    ${ledger.kind}: ${ledger.classification}${"mappings" in ledger && ledger.mappings.length ? ` (${ledger.mappings.length} rekeyed)` : ""}`);
  }
  console.log(`Projects: ${report.counts.projects}; repaired: ${report.counts.repaired}; verified: ${report.counts.verified}; IDs rekeyed: ${report.counts.ids_rekeyed}; ambiguous references retained: ${report.counts.ambiguous_references_retained}`);
}

export function ledgerAudit(options: LedgerCommandOptions = {}): void {
  const reports = roots(options).map((project) => ({ project, ledgers: auditProjectLedgers(project) }));
  print({ mode: "audit", apply: false, reports, counts: aggregate(reports) }, options.json);
}

export function ledgerRepair(options: LedgerCommandOptions = {}): void {
  const reports: ProjectReport[] = [];
  for (const project of roots(options)) {
    if (!fs.existsSync(path.join(project, ".wolf"))) {
      reports.push({ project, ledgers: ["bug", "review"].map((kind) => ({ kind, classification: "unreadable", applied: false, verified: false, incompleteReceipt: false, recordCount: 0, mappings: [], ambiguousReferences: [], error: "missing .wolf directory" } as RepairResult)) });
      continue;
    }
    reports.push({ project, ledgers: [repairLedger(project, "bug", Boolean(options.apply)), repairLedger(project, "review", Boolean(options.apply))] });
  }
  print({ mode: "repair", apply: Boolean(options.apply), reports, counts: aggregate(reports) }, options.json);
}
