// @ts-nocheck
/**
 * NudgeEngine — the single place that decides what (if anything) a Stop hook
 * says.
 *
 * Rules are pure-ish: they gather facts and RETURN candidates. They do not
 * print, do not mutate disposition state, and do not decide repetition. That
 * separation is what makes the invariant testable: given identical evidence,
 * the engine must select identically, and having selected once it must stay
 * quiet until the evidence changes.
 *
 * Pipeline: collect → suppress → rank → budget → claim → emit → mark.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { NUDGE_STATES, SUPPRESS_REASONS, computeFingerprint, shortNudgeId, dispositionSuppression, readState, tryClaim, markEmitted, canonicalPath, } from "./state.js";
export const NUDGE_DEFAULTS = Object.freeze({
    enabled: true,
    max_per_stop: 1,
    max_chars: 600,
    max_emissions_per_rule_per_session: 1,
    info_cooldown_hours: 24,
    max_review_rounds: 3,
    lease_seconds: 30,
    suppress_unattributed_low_severity: true,
    default_nonblocking: true,
    show_suppressed_count: false,
    diagnostic_log: ".wolf/logs/nudges.jsonl",
});
const SEVERITY_RANK = { block: 3, warn: 2, info: 1 };
export function getNudgeConfig(cfg) {
    const user = (cfg && cfg.openwolf && cfg.openwolf.nudges) || {};
    const out = { ...NUDGE_DEFAULTS };
    for (const key of Object.keys(NUDGE_DEFAULTS)) {
        if (user[key] === undefined || user[key] === null)
            continue;
        const def = NUDGE_DEFAULTS[key];
        if (typeof def === "number") {
            const n = Number(user[key]);
            // Reject non-finite / negative overrides rather than letting a typo
            // disable the budget entirely.
            const zeroAllowed = key === "max_per_stop";
            if (Number.isFinite(n) && (n > 0 || (zeroAllowed && n === 0)))
                out[key] = n;
        }
        else if (typeof def === "boolean") {
            if (typeof user[key] === "boolean")
                out[key] = user[key];
        }
        else if (typeof def === "string") {
            if (typeof user[key] === "string" && user[key])
                out[key] = user[key];
        }
    }
    return out;
}
/**
 * Build a well-formed candidate. Rules call this so every candidate carries a
 * fingerprint over its FULL evidence, not its rendered text.
 */
export function makeCandidate({ ruleId, ownerRoot = null, severity = "info", confidence = 0.8, title, reason, action = { command: null, label: "" }, evidence = {}, targetHashes = {}, eventSequence = null, schemaVersion = 1, lineageId = null, blocking = false, detail = null, clock = null, }) {
    const fingerprint = computeFingerprint({
        ruleId, ownerRoot, targetHashes, eventSequence, evidence, schemaVersion,
    });
    return {
        rule_id: ruleId,
        owner_root: ownerRoot ? canonicalPath(ownerRoot) : null,
        severity,
        confidence,
        fingerprint,
        lineage_id: lineageId || fingerprint,
        nudge_id: shortNudgeId(ruleId, fingerprint),
        title: title || ruleId,
        reason: reason || "",
        action: { command: action.command || null, label: action.label || "" },
        evidence,
        detail,
        blocking,
        created_at: new Date(clock && clock.now ? clock.now() : Date.now()).toISOString(),
    };
}
/** Append one diagnostic event. Never throws — diagnostics must not break Stop. */
export function logDiagnostic(wolfDir, event) {
    try {
        const cfgPath = path.isAbsolute(event._logPath || "")
            ? event._logPath
            : path.join(wolfDir, "logs", "nudges.jsonl");
        delete event._logPath;
        fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
        fs.appendFileSync(cfgPath, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n", "utf-8");
    }
    catch { }
}
function diagPath(wolfDir, nudgeCfg) {
    const rel = nudgeCfg.diagnostic_log || NUDGE_DEFAULTS.diagnostic_log;
    if (path.isAbsolute(rel))
        return rel;
    // Config stores it project-relative (".wolf/logs/nudges.jsonl"); wolfDir
    // already ends in .wolf, so strip a leading ".wolf/" to avoid .wolf/.wolf/.
    const trimmed = rel.replace(/^\.wolf[\\/]/, "");
    return path.join(wolfDir, trimmed);
}
/**
 * Rank candidates. Deterministic all the way down so identical inputs always
 * select the same candidate — a stable selection is what lets the emission
 * record actually suppress the repeat.
 */
export function rankCandidates(candidates) {
    return [...candidates].sort((a, b) => {
        const sev = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
        if (sev !== 0)
            return sev;
        const conf = (b.confidence || 0) - (a.confidence || 0);
        if (conf !== 0)
            return conf;
        // Actionable (has a concrete command) beats advisory.
        const act = (b.action && b.action.command ? 1 : 0) - (a.action && a.action.command ? 1 : 0);
        if (act !== 0)
            return act;
        const age = Date.parse(a.created_at || "") - Date.parse(b.created_at || "");
        if (Number.isFinite(age) && age !== 0)
            return age;
        return a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0;
    });
}
/**
 * Render the compact Stop message. Detailed evidence deliberately does NOT go
 * here — it lives behind `wolfpack nudge show <id>`. The old review nudge spent
 * most of its bytes re-explaining provider commands, completion instructions,
 * and stale-review handling on every single Stop.
 */
export function formatCandidate(candidate, nudgeCfg) {
    const sev = String(candidate.severity || "info").toUpperCase();
    const lines = [`🐺 WolfPack [${sev} ${candidate.nudge_id}]`, candidate.reason];
    if (candidate.action && candidate.action.command) {
        lines.push(`Run: ${candidate.action.command}`);
    }
    lines.push(`Details: wolfpack nudge show ${candidate.nudge_id} · Dismiss: wolfpack nudge dismiss ${candidate.nudge_id} --reason "..."`);
    let out = lines.filter(Boolean).join("\n");
    const max = nudgeCfg.max_chars || NUDGE_DEFAULTS.max_chars;
    if (out.length > max)
        out = out.slice(0, Math.max(0, max - 1)) + "…";
    return out;
}
/**
 * Run the engine over collected candidates.
 *
 * Returns { messages, emitted, suppressed, queued, degraded } — the caller
 * (stop.ts) owns process exit and the Claude Code JSON contract.
 */
export function evaluate({ wolfDir, candidates, nudgeCfg, sessionId = "", sessionState = null, clock = null, unattributedCount = 0, }) {
    const cfg = nudgeCfg || NUDGE_DEFAULTS;
    const logFile = diagPath(wolfDir, cfg);
    const diag = (event) => logDiagnostic(wolfDir, { ...event, _logPath: logFile });
    const result = { messages: [], emitted: [], suppressed: [], queued: [], degraded: null };
    if (!cfg.enabled)
        return result;
    if (unattributedCount > 0) {
        // Recorded, never emitted: an ambiguous owner is a diagnostics problem,
        // not something to bother the user with.
        diag({ event: "candidate_suppressed", reason: SUPPRESS_REASONS.UNKNOWN_OWNER, count: unattributedCount });
    }
    // Corruption is surfaced, never silently absorbed: an unparseable state file
    // means real dispositions existed on disk, and the operator needs to know the
    // quarantine path to recover them.
    const state = readState(wolfDir, {
        onCorrupt: (info) => diag({ event: "state_corrupt", file: info.file, quarantine: info.quarantine, bytes: info.bytes, error: info.error }),
    });
    const eligible = [];
    for (const c of candidates || []) {
        diag({ event: "candidate_created", rule_id: c.rule_id, nudge_id: c.nudge_id, fingerprint: c.fingerprint, owner_root: c.owner_root, severity: c.severity });
        // Unattributed low-severity candidates are dropped per policy.
        if (!c.owner_root && cfg.suppress_unattributed_low_severity && c.severity === "info") {
            result.suppressed.push({ candidate: c, reason: SUPPRESS_REASONS.UNKNOWN_OWNER });
            diag({ event: "candidate_suppressed", nudge_id: c.nudge_id, reason: SUPPRESS_REASONS.UNKNOWN_OWNER });
            continue;
        }
        const disp = dispositionSuppression(state, c.fingerprint, { clock, sessionId });
        if (disp) {
            result.suppressed.push({ candidate: c, reason: disp });
            diag({ event: "candidate_suppressed", nudge_id: c.nudge_id, reason: disp });
            continue;
        }
        // Already emitted for this exact evidence in this session.
        const emission = state.emissions ? state.emissions[c.fingerprint] : null;
        if (emission) {
            result.suppressed.push({ candidate: c, reason: SUPPRESS_REASONS.ALREADY_EMITTED });
            diag({ event: "candidate_suppressed", nudge_id: c.nudge_id, reason: SUPPRESS_REASONS.ALREADY_EMITTED });
            continue;
        }
        // Per-rule, per-session emission ceiling. Counts DISTINCT fingerprints,
        // so this bounds a chatty rule without blinding it to genuinely new
        // evidence beyond the ceiling (which stays queued and visible via
        // `nudge list`).
        if (cfg.max_emissions_per_rule_per_session > 0 && sessionId) {
            const priorForRule = Object.values(state.emissions || {}).filter((e) => e && e.rule_id === c.rule_id && e.session_id === sessionId).length;
            if (priorForRule >= cfg.max_emissions_per_rule_per_session) {
                result.queued.push({ candidate: c, reason: SUPPRESS_REASONS.OVER_BUDGET });
                diag({ event: "candidate_suppressed", nudge_id: c.nudge_id, reason: SUPPRESS_REASONS.OVER_BUDGET });
                continue;
            }
        }
        eligible.push(c);
    }
    const ranked = rankCandidates(eligible);
    const budget = Math.max(0, cfg.max_per_stop);
    for (const c of ranked) {
        if (result.emitted.length >= budget) {
            result.queued.push({ candidate: c, reason: SUPPRESS_REASONS.OVER_BUDGET });
            diag({ event: "candidate_suppressed", nudge_id: c.nudge_id, reason: SUPPRESS_REASONS.OVER_BUDGET });
            continue;
        }
        const claim = tryClaim(wolfDir, c.fingerprint, {
            leaseSeconds: cfg.lease_seconds,
            sessionId,
            clock,
            // The pre-lock filter above is an optimization; these two let
            // tryClaim re-check the ceiling against durable state under the
            // lock, which is what actually enforces it across processes.
            ruleId: c.rule_id,
            maxPerRulePerSession: cfg.max_emissions_per_rule_per_session,
        });
        if (!claim.ok) {
            if (claim.degraded) {
                // Persistence is broken. Say so ONCE, and never block on it:
                // an informational nudge that cannot be recorded must not hold
                // the user's turn hostage.
                if (!result.degraded) {
                    result.degraded = claim.error || claim.reason;
                    diag({ event: "state_error", nudge_id: c.nudge_id, error: result.degraded });
                }
            }
            else {
                diag({ event: "candidate_suppressed", nudge_id: c.nudge_id, reason: claim.reason });
            }
            // A ceiling refusal is deferred work, not a disposition: keep it in
            // `queued` so it stays listable rather than looking dispositioned.
            if (claim.reason === SUPPRESS_REASONS.OVER_BUDGET) {
                result.queued.push({ candidate: c, reason: claim.reason });
            }
            else {
                result.suppressed.push({ candidate: c, reason: claim.reason });
            }
            continue;
        }
        const message = formatCandidate(c, cfg);
        result.messages.push(message);
        result.emitted.push(c);
        const marked = markEmitted(wolfDir, c.fingerprint, {
            token: claim.token,
            sessionId,
            ruleId: c.rule_id,
            ownerRoot: c.owner_root,
            detail: c.detail,
            clock,
        });
        if (!marked.ok && marked.degraded && !result.degraded) {
            result.degraded = marked.error || "emission not persisted";
            diag({ event: "state_error", nudge_id: c.nudge_id, error: result.degraded });
        }
        diag({ event: "candidate_emitted", nudge_id: c.nudge_id, rule_id: c.rule_id, owner_root: c.owner_root, chars: message.length });
    }
    if (result.degraded) {
        result.messages.push(`🐺 WolfPack: nudge state could not be persisted (${result.degraded}). Nudges may repeat until this is fixed.`);
    }
    if (cfg.show_suppressed_count && result.queued.length > 0) {
        result.messages.push(`(${result.queued.length} more queued — wolfpack nudge list)`);
    }
    return result;
}
export { NUDGE_STATES, SUPPRESS_REASONS };
//# sourceMappingURL=engine.js.map