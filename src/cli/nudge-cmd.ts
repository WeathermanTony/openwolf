// @ts-nocheck
/**
 * `wolfpack nudge …` — explicit disposition commands.
 *
 * Dispositions must be COMMANDS, never inferred from the assistant's prose.
 * Parsing natural language for "I dismissed that" is exactly the fragility that
 * made the old gates non-convergent: the model says something the hook cannot
 * verify, and the hook keeps asking.
 *
 * Every disposition binds to an evidence fingerprint, so it suppresses that
 * exact state and nothing more — new evidence re-arms the rule.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectRoot } from "../scanner/project-root.js";
import {
    NUDGE_STATES,
    readState,
    setDisposition,
    nudgeStatePath,
} from "../hooks/nudges/state.js";

function wolfDir() {
    const root = findProjectRoot(process.cwd()) || process.cwd();
    return path.join(root, ".wolf");
}

/**
 * Resolve a user-typed short id (`cerebrum-1a2b3c4d`) to its full fingerprint.
 * Also accepts a full fingerprint or an unambiguous prefix of one.
 */
export function resolveNudgeFingerprint(dir, nudgeId) {
    const state = readState(dir);
    const pools = [state.emissions || {}, state.dispositions || {}, state.leases || {}];
    const matches = new Set();
    for (const pool of pools) {
        for (const fp of Object.keys(pool)) {
            if (fp === nudgeId || fp.startsWith(nudgeId)) matches.add(fp);
            const short = nudgeId.includes("-") ? nudgeId.split("-").pop() : null;
            if (short && fp.startsWith(short)) matches.add(fp);
        }
    }
    const list = [...matches];
    if (list.length === 1) return list[0];
    if (list.length > 1) {
        console.error(`Ambiguous nudge id "${nudgeId}" — matches ${list.length} fingerprints. Use a longer prefix.`);
        return null;
    }
    return null;
}

function ruleOf(state, fp) {
    return (state.emissions && state.emissions[fp] && state.emissions[fp].rule_id)
        || (state.dispositions && state.dispositions[fp] && state.dispositions[fp].rule_id)
        || "unknown";
}

function shortOf(fp, ruleId) {
    const slug = String(ruleId).split(".")[0].replace(/[^a-z0-9]/gi, "").slice(0, 10) || "nudge";
    return `${slug}-${fp.slice(0, 8)}`;
}

export function nudgeList() {
    const dir = wolfDir();
    const state = readState(dir);
    const rows = [];
    for (const [fp, e] of Object.entries(state.emissions || {})) {
        const disp = (state.dispositions || {})[fp];
        rows.push({
            id: shortOf(fp, e.rule_id),
            rule: e.rule_id,
            state: disp ? disp.state : NUDGE_STATES.EMITTED,
            owner: e.owner_root || "(unattributed)",
            at: e.emitted_at || "",
        });
    }
    for (const [fp, d] of Object.entries(state.dispositions || {})) {
        if ((state.emissions || {})[fp]) continue;
        rows.push({
            id: shortOf(fp, d.rule_id), rule: d.rule_id || "unknown",
            state: d.state, owner: "-", at: d.at || "",
        });
    }
    if (rows.length === 0) {
        console.log("No nudges recorded for this project.");
        return;
    }
    rows.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    console.log(`${"ID".padEnd(20)} ${"STATE".padEnd(11)} ${"RULE".padEnd(24)} OWNER`);
    for (const r of rows) {
        console.log(`${r.id.padEnd(20)} ${String(r.state).padEnd(11)} ${String(r.rule).padEnd(24)} ${path.basename(r.owner)}`);
    }
}

export function nudgeShow(nudgeId) {
    const dir = wolfDir();
    const fp = resolveNudgeFingerprint(dir, nudgeId);
    if (!fp) {
        console.error(`No nudge matching "${nudgeId}". Try: wolfpack nudge list`);
        process.exitCode = 1;
        return;
    }
    const state = readState(dir);
    const emission = (state.emissions || {})[fp];
    const disp = (state.dispositions || {})[fp];
    console.log(`Nudge:       ${shortOf(fp, ruleOf(state, fp))}`);
    console.log(`Fingerprint: ${fp}`);
    console.log(`Rule:        ${ruleOf(state, fp)}`);
    console.log(`State:       ${disp ? disp.state : (emission ? NUDGE_STATES.EMITTED : "unknown")}`);
    if (emission) {
        console.log(`Project:     ${emission.owner_root || "(unattributed)"}`);
        console.log(`Emitted:     ${emission.emitted_at}`);
        console.log(`Session:     ${emission.session_id || "-"}`);
        const detail = emission.detail;
        if (detail && detail.candidate_type === "learning") {
            console.log(`Kind:        ${detail.kind || "-"}`);
            console.log(`Section:     ${detail.target_section || "-"}`);
            console.log(`Topic:       ${detail.topic_key || "-"}`);
            console.log(`Trust:       ${detail.trust || "unreviewed"} context (not instruction)`);
            console.log(`Excerpt:     ${detail.excerpt || "-"}`);
            console.log(`Record:      wolfpack cerebrum record ${shortOf(fp, ruleOf(state, fp))} --text "<sanitized durable entry>"`);
        }
    }
    if (disp) {
        console.log(`Disposed:    ${disp.at}${disp.reason ? ` — ${disp.reason}` : ""}`);
        if (disp.until) console.log(`Until:       ${disp.until}`);
    }
    // Detailed evidence lives in the diagnostic log, keyed by fingerprint. This
    // is the "notification cost vs diagnostic depth" split: the Stop message
    // stays one line, the full picture is one command away.
    const logFile = path.join(dir, "logs", "nudges.jsonl");
    try {
        const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
        const events = lines
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(e => e && (e.fingerprint === fp || e.nudge_id === shortOf(fp, ruleOf(state, fp))));
        if (events.length) {
            console.log(`\nHistory (${events.length} event(s)):`);
            for (const e of events.slice(-10)) {
                console.log(`  ${e.ts}  ${e.event}${e.reason ? ` (${e.reason})` : ""}`);
            }
        }
    } catch { }
}

function dispose(nudgeId, stateName, opts = {}) {
    const dir = wolfDir();
    const fp = resolveNudgeFingerprint(dir, nudgeId);
    if (!fp) {
        console.error(`No nudge matching "${nudgeId}". Try: wolfpack nudge list`);
        process.exitCode = 1;
        return;
    }
    const state = readState(dir);
    const res = setDisposition(dir, fp, stateName, {
        reason: opts.reason || "",
        until: opts.until || null,
        sessionId: opts.sessionId || "",
        ruleId: ruleOf(state, fp),
    });
    if (!res.ok) {
        // Never claim a disposition was persisted when it was not — that is the
        // failure mode that makes a user think they silenced something they did
        // not.
        console.error(`FAILED to persist disposition: ${res.error || "state locked"}. Nudge may re-fire.`);
        process.exitCode = 1;
        return;
    }
    console.log(`${shortOf(fp, ruleOf(state, fp))} → ${stateName}${opts.until ? ` until ${opts.until}` : ""}`);
}

export function nudgeResolve(id) {
    dispose(id, NUDGE_STATES.RESOLVED);
}

export function nudgeDismiss(id, opts) {
    dispose(id, NUDGE_STATES.DISMISSED, { reason: (opts && opts.reason) || "" });
}

export function nudgeSnooze(id, opts) {
    let until = null;
    if (opts && opts.hours) {
        const h = Number(opts.hours);
        if (!Number.isFinite(h) || h <= 0) {
            console.error("--hours must be a positive number");
            process.exitCode = 1;
            return;
        }
        until = new Date(Date.now() + h * 3_600_000).toISOString();
    }
    // `--until session-end` leaves `until` null: the durable record exists, but
    // eligibility is decided per-session by the engine.
    const sessionFile = path.join(wolfDir(), "hooks", "_session.json");
    let sessionId = "";
    try { sessionId = JSON.parse(fs.readFileSync(sessionFile, "utf-8")).session_id || ""; } catch { }
    if (!until && !sessionId) {
        console.error("FAILED to snooze until session-end: current session id is unavailable.");
        process.exitCode = 1;
        return;
    }
    dispose(id, NUDGE_STATES.SNOOZED, { until, sessionId, reason: (opts && opts.reason) || "" });
}

/**
 * `wolfpack nudge stats` — is the system actually helping?
 * Metrics must never themselves generate a Stop nudge; this is pull-only.
 */
export function nudgeStats() {
    const dir = wolfDir();
    const logFile = path.join(dir, "logs", "nudges.jsonl");
    let events = [];
    try {
        events = fs.readFileSync(logFile, "utf-8").trim().split("\n")
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(Boolean);
    } catch {
        console.log("No nudge diagnostics recorded yet.");
        return;
    }
    const counts = {};
    const byRule = {};
    const suppressReasons = {};
    let emittedChars = 0, emittedCount = 0;
    for (const e of events) {
        counts[e.event] = (counts[e.event] || 0) + 1;
        if (e.event === "candidate_emitted") {
            emittedCount++;
            emittedChars += e.chars || 0;
            byRule[e.rule_id] = (byRule[e.rule_id] || 0) + 1;
        }
        if (e.event === "candidate_suppressed" && e.reason) {
            suppressReasons[e.reason] = (suppressReasons[e.reason] || 0) + 1;
        }
    }
    const state = readState(dir);
    const dispositions = Object.values(state.dispositions || {});
    console.log("Nudge diagnostics");
    console.log(`  candidates created : ${counts.candidate_created || 0}`);
    console.log(`  emitted            : ${emittedCount}`);
    console.log(`  avg emitted chars  : ${emittedCount ? Math.round(emittedChars / emittedCount) : 0}`);
    console.log(`  resolved           : ${dispositions.filter(d => d.state === NUDGE_STATES.RESOLVED).length}`);
    console.log(`  dismissed (FP)     : ${dispositions.filter(d => d.state === NUDGE_STATES.DISMISSED).length}`);
    console.log(`  snoozed            : ${dispositions.filter(d => d.state === NUDGE_STATES.SNOOZED).length}`);
    console.log(`  state errors       : ${counts.state_error || 0}`);
    if (Object.keys(suppressReasons).length) {
        console.log("  suppression reasons:");
        for (const [r, n] of Object.entries(suppressReasons).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${String(r).padEnd(38)} ${n}`);
        }
    }
    if (Object.keys(byRule).length) {
        console.log("  emissions by rule:");
        for (const [r, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) {
            console.log(`    ${String(r).padEnd(38)} ${n}`);
        }
    }
    const lineages = Object.entries(state.lineages || {});
    if (lineages.length) {
        console.log("  review rounds by lineage:");
        for (const [id, l] of lineages) {
            console.log(`    ${id}  rounds=${l.rounds}${l.escalated ? " (escalated)" : ""}`);
        }
    }
}
