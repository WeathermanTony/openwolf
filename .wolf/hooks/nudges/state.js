// @ts-nocheck
/**
 * Nudge state: content-addressed fingerprints, lifecycle dispositions, and
 * leased claims.
 *
 * WHY THIS EXISTS
 * ---------------
 * The pre-existing nudge machinery deduped with per-session COUNTERS
 * (`tryConsumeNudgeSlot`) and, for the conclusion gate, a hash of the
 * assistant's rendered TEXT. Neither is evidence. A counter lets identical
 * evidence fire N times; a text hash re-arms whenever the model rephrases the
 * same recap. Both produce the "same warning, same explanation, same
 * corrective ritual" loop.
 *
 * The invariant this module enforces:
 *
 *   The same evidence must not produce the same nudge twice unless the
 *   underlying evidence materially changes.
 *
 * That means dispositions bind to a fingerprint of the DECISION EVIDENCE, not
 * to a rule name and not to displayed text. Dismissing "review-0132" suppresses
 * exactly the byte-state that produced it; touching a covered file mints a new
 * fingerprint and legitimately re-arms the rule.
 *
 * STATE LIVES IN TWO PLACES
 *   - session state (_session.json `nudges`): emissions, leases, round counts.
 *     Dies with the session, which is correct for "already said this turn".
 *   - durable state (.wolf/nudge-state.json): resolutions, dismissals, snoozes.
 *     Must outlive the session or a dismissal is meaningless.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { acquireFileLock } from "../../utils/size-discipline.js";
export const NUDGE_STATE_VERSION = 2;
/** Lifecycle states a candidate can occupy. */
export const NUDGE_STATES = Object.freeze({
    NEW: "new",
    LEASED: "leased",
    EMITTED: "emitted",
    RESOLVED: "resolved",
    DISMISSED: "dismissed",
    SNOOZED: "snoozed",
    SUPERSEDED: "superseded",
});
/** Machine-readable suppression reasons (for diagnostics). */
export const SUPPRESS_REASONS = Object.freeze({
    ALREADY_EMITTED: "same_fingerprint_already_emitted",
    RESOLVED: "resolved",
    DISMISSED: "dismissed",
    SNOOZED: "snoozed",
    REDUCTION_COVERS: "current_reduction_covers_evidence",
    STALE_REVIEW: "stale_review_superseded",
    UNKNOWN_OWNER: "wrong_or_unknown_project_owner",
    OVER_BUDGET: "lower_priority_than_budget",
    ROUND_CAP: "round_cap_reached",
    LEASE_HELD: "lease_held_by_other_process",
});
/**
 * Canonicalize a filesystem path for fingerprinting.
 *
 * realpath resolves symlinks and `..` so that two spellings of the same file
 * (a symlinked project root, a bind mount) collapse to one identity. When the
 * path does not exist yet — a tombstoned/deleted file is legitimate evidence —
 * fall back to path.resolve so the identity is still stable rather than
 * throwing away the evidence entirely.
 *
 * Separators are normalized to `/` so a fingerprint computed on Windows equals
 * one computed on POSIX for the same logical file.
 */
export function canonicalPath(p) {
    if (!p)
        return "";
    let out;
    try {
        out = fs.realpathSync(path.resolve(p));
    }
    catch {
        out = path.resolve(p);
    }
    return out.replace(/\\/g, "/");
}
/**
 * Does this string denote a filesystem path we should canonicalize?
 *
 * Deliberately conservative: only absolute POSIX paths, Windows drive paths,
 * and UNC paths qualify. Relative fragments and prose stay untouched, because
 * resolving them against process.cwd() would make a fingerprint depend on where
 * the hook happened to be invoked from — the opposite of stable identity.
 */
function looksLikePath(s) {
    return typeof s === "string" && s.length > 1 && (s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\"));
}
/**
 * Recursively canonicalize path-like strings inside an evidence payload.
 *
 * Rules embed real absolute paths in evidence (owner_root, written_files,
 * uncovered_files). Without this, `/p/.wolf/x` and `/p/../p/.wolf/x` are two
 * distinct fingerprints for identical evidence, so a dismissal recorded against
 * one spelling silently fails to suppress the other.
 */
export function canonicalizeEvidence(value, depth = 0) {
    if (depth > 12)
        return value; // guard against cyclic/pathological evidence
    if (typeof value === "string")
        return looksLikePath(value) ? canonicalPath(value) : value;
    if (Array.isArray(value))
        return value.map(v => canonicalizeEvidence(v, depth + 1));
    if (value && typeof value === "object") {
        const out = {};
        for (const k of Object.keys(value))
            out[k] = canonicalizeEvidence(value[k], depth + 1);
        return out;
    }
    return value;
}
/**
 * Stable JSON serialization: object keys sorted recursively so that key
 * insertion order — which varies with how evidence was gathered — cannot
 * change a fingerprint. Arrays keep their order (order is often meaningful,
 * e.g. an event sequence); callers sort path lists before passing them.
 */
export function stableStringify(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return "[" + value.map(stableStringify).join(",") + "]";
    const keys = Object.keys(value).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}
/**
 * Compute a candidate's fingerprint from its FULL decision evidence.
 *
 * CRITICAL: callers must pass every relevant file, not the truncated list the
 * message displays. Display truncates to `max_files` (default 3); if the
 * fingerprint truncated too, editing a sixth file while the message shows five
 * would collapse to an unchanged fingerprint and the nudge would stay wrongly
 * silent. Test 15 in the suite pins this.
 *
 * `rule_schema_version` participates so that changing what a rule MEANS by its
 * evidence invalidates old dispositions instead of silently inheriting them.
 */
export function computeFingerprint({ ruleId, ownerRoot, targetHashes = {}, eventSequence = null, evidence = {}, schemaVersion = 1, }) {
    // Canonicalize + sort target hashes into pairs so path spelling and key
    // order cannot perturb the digest. The value carries a type tag: without
    // one, String(h) collapses 12345678 and "12345678" to the same digest, so a
    // caller-side type change between rules would false-suppress a real content
    // change.
    const hashPairs = Object.entries(targetHashes)
        .map(([p, h]) => [canonicalPath(p), `${typeof h}:${String(h)}`])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const payload = {
        rule_id: String(ruleId),
        owner_root: ownerRoot ? canonicalPath(ownerRoot) : null,
        target_hashes: hashPairs,
        event_sequence: eventSequence,
        // Evidence gets the same path canonicalization as target_hashes and
        // owner_root. Rules put real absolute paths in here (owner_root,
        // written_files, uncovered_files); leaving them raw means two spellings
        // of one path yield two fingerprints, so a dismissal bound to one fails
        // to suppress the other and the noise loop returns.
        evidence: canonicalizeEvidence(evidence),
        rule_schema_version: schemaVersion,
    };
    return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}
/** Short, human-quotable id derived from rule + fingerprint. */
export function shortNudgeId(ruleId, fingerprint) {
    const slug = String(ruleId).split(".")[0].replace(/[^a-z0-9]/gi, "").slice(0, 10) || "nudge";
    return `${slug}-${fingerprint.slice(0, 8)}`;
}
function emptyState() {
    return {
        version: NUDGE_STATE_VERSION,
        dispositions: {},
        leases: {},
        emissions: {},
        lineages: {},
    };
}
/**
 * Migrate older state shapes forward. Unknown/older versions are normalized
 * rather than discarded so a version bump never silently drops a user's
 * dismissals.
 */
export function migrateState(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return emptyState();
    const out = emptyState();
    if (raw.dispositions && typeof raw.dispositions === "object" && !Array.isArray(raw.dispositions)) {
        out.dispositions = raw.dispositions;
    }
    if (raw.leases && typeof raw.leases === "object" && !Array.isArray(raw.leases)) {
        out.leases = raw.leases;
    }
    if (raw.emissions && typeof raw.emissions === "object" && !Array.isArray(raw.emissions)) {
        out.emissions = raw.emissions;
    }
    if (raw.lineages && typeof raw.lineages === "object" && !Array.isArray(raw.lineages)) {
        out.lineages = raw.lineages;
    }
    return out;
}
export function nudgeStatePath(wolfDir) {
    return path.join(wolfDir, "nudge-state.json");
}
/**
 * Non-enumerable marker set on a state object that must NOT be written back.
 *
 * Used when `readState` hit corruption it could not quarantine: the unreadable
 * bytes on disk are then the only surviving copy of the user's dispositions, so
 * overwriting them would be the permanent loss this module refuses. Symbol-keyed
 * and non-enumerable so it never reaches JSON.stringify or a fingerprint.
 */
export const UNSAFE_TO_PERSIST = Symbol("unsafeToPersist");
/**
 * Injectable filesystem seam.
 *
 * ESM `import * as fs` creates a LIVE BINDING that a test cannot reassign from
 * the outside — a `fs.writeFileSync = throwingStub` monkeypatch in the test
 * file silently fails to intercept this module's calls, producing a green
 * fault-injection test that proves nothing. Routing correctness-critical writes
 * through a swappable seam makes the injection real and assertable (see tests
 * 18 and 19, which fail loudly if the injection does not execute).
 *
 * Declared ahead of its consumers so no call site sits in the temporal dead
 * zone — `readState`'s corruption path writes through this seam from inside a
 * catch block, where a TDZ ReferenceError would mask the original error.
 */
export const io = {
    writeFileSync: (p, data, enc) => fs.writeFileSync(p, data, enc),
    renameSync: (a, b) => fs.renameSync(a, b),
    unlinkSync: (p) => fs.unlinkSync(p),
    mkdirSync: (p, o) => fs.mkdirSync(p, o),
};
/**
 * Read state, distinguishing "absent" from "corrupt".
 *
 * These two cases must NOT be conflated. A missing file is the normal first
 * run and an empty state is correct. A corrupt-but-PRESENT file means real
 * dispositions exist on disk that we failed to parse — returning an empty
 * state there makes the next write silently and permanently destroy every
 * dismissal, resolution, snooze, and lineage count. "One later duplicate is
 * acceptable; permanent loss is not" cuts directly against that.
 *
 * On corruption we quarantine the unreadable bytes to a `.corrupt-<ts>`
 * sidecar before returning empty, so the state is recoverable by hand and the
 * event is visible rather than inferred. `onCorrupt` lets the caller surface a
 * diagnostic without this module taking a logging dependency.
 */
export function readState(wolfDir, { onCorrupt } = {}) {
    const file = nudgeStatePath(wolfDir);
    let raw;
    try {
        raw = fs.readFileSync(file, "utf-8");
    }
    catch {
        return emptyState(); // absent — normal first run
    }
    try {
        return migrateState(JSON.parse(raw));
    }
    catch (err) {
        // Present but unparseable: preserve the bytes before we move on.
        let quarantine = null;
        try {
            quarantine = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
            io.writeFileSync(quarantine, raw, "utf-8");
        }
        catch {
            quarantine = null;
        }
        if (typeof onCorrupt === "function") {
            try {
                onCorrupt({ file, quarantine, bytes: raw.length, error: String((err && err.message) || err) });
            }
            catch { }
        }
        const fallback = emptyState();
        if (!quarantine) {
            // Quarantine FAILED, so the corrupt bytes are the only copy of the
            // user's dispositions that exists. Returning a plain empty state
            // here would let the very next write rename over them — permanent
            // loss gated on one extra IO failure. Mark the state unsafe so
            // writeStateOrThrow refuses; the nudge simply repeats, which is the
            // side of the trade the module explicitly prefers.
            Object.defineProperty(fallback, UNSAFE_TO_PERSIST, {
                value: `corrupt state at ${file} could not be quarantined`,
                enumerable: false,
            });
        }
        return fallback;
    }
}
/**
 * Atomic state write that THROWS on failure.
 *
 * Deliberately not shared.writeJSON: that helper swallows every error, which
 * is right for advisory ledgers and wrong here. If we cannot persist that a
 * nudge was emitted or dismissed, the caller must know — otherwise it reports
 * "dismissed" to the user while the next Stop re-emits, which is exactly the
 * non-convergent loop this work removes.
 */
export function writeStateOrThrow(wolfDir, state) {
    // Refuse to persist a state derived from unquarantined corruption. Throwing
    // routes callers through their existing degraded path (tryClaim returns
    // {ok:false, degraded:true}), so the nudge repeats rather than the user's
    // dismissals being destroyed.
    if (state && state[UNSAFE_TO_PERSIST]) {
        throw new Error(String(state[UNSAFE_TO_PERSIST]));
    }
    const file = nudgeStatePath(wolfDir);
    const dir = path.dirname(file);
    io.mkdirSync(dir, { recursive: true });
    const tmp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    const body = JSON.stringify(state, null, 2);
    // Validate what we are about to persist. A state object that cannot be
    // re-parsed would brick every later read.
    JSON.parse(body);
    try {
        io.writeFileSync(tmp, body, "utf-8");
        io.renameSync(tmp, file);
    }
    catch (err) {
        try {
            io.unlinkSync(tmp);
        }
        catch { }
        throw err;
    }
}
function nowMs(clock) {
    return clock && typeof clock.now === "function" ? clock.now() : Date.now();
}
/**
 * Is this fingerprint currently suppressed by a durable disposition?
 * Returns a machine-readable reason string, or null when eligible.
 */
export function dispositionSuppression(state, fingerprint, { clock } = {}) {
    const d = state.dispositions ? state.dispositions[fingerprint] : null;
    if (!d)
        return null;
    if (d.state === NUDGE_STATES.RESOLVED)
        return SUPPRESS_REASONS.RESOLVED;
    if (d.state === NUDGE_STATES.DISMISSED)
        return SUPPRESS_REASONS.DISMISSED;
    if (d.state === NUDGE_STATES.SUPERSEDED)
        return SUPPRESS_REASONS.STALE_REVIEW;
    if (d.state === NUDGE_STATES.SNOOZED) {
        // `until: null` means session-scoped: the durable record exists but the
        // session that owns it is gone, so treat expiry as "still snoozed only
        // within that session" — session_id is checked by the caller.
        if (!d.until)
            return SUPPRESS_REASONS.SNOOZED;
        const until = Date.parse(d.until);
        if (Number.isFinite(until) && nowMs(clock) < until)
            return SUPPRESS_REASONS.SNOOZED;
        return null; // snooze expired → eligible again
    }
    return null;
}
/**
 * Attempt a LEASED CLAIM on a fingerprint.
 *
 * The naive shape (read → if unseen → print → write seen) has a TOCTOU window:
 * twelve concurrent Stop hooks all read "unseen", all print, then all write.
 * Test 12 launches real OS processes to prove this path holds.
 *
 * Protocol:
 *   1. take the state lock
 *   2. RE-READ from disk inside the lock (the in-memory copy may be stale)
 *   3. reject if disposed / already emitted / a live lease is held
 *   4. write a short-lived lease carrying an owner token + expiry
 *   5. release the lock, then emit outside it
 *
 * A process that dies after leasing but before emitting leaves an expiring
 * lease, so the candidate becomes eligible again (test 14) rather than being
 * lost forever. A process that emits and dies before `markEmitted` may cause
 * one later duplicate — deliberately preferred over permanent loss.
 */
export function tryClaim(wolfDir, fingerprint, { leaseSeconds = 30, sessionId = "", clock, owner, ruleId = "", maxPerRulePerSession = 0 } = {}) {
    const file = nudgeStatePath(wolfDir);
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    catch { }
    const release = acquireFileLock(file);
    if (!release) {
        return { ok: false, reason: SUPPRESS_REASONS.LEASE_HELD, degraded: true };
    }
    try {
        const state = readState(wolfDir);
        const disp = dispositionSuppression(state, fingerprint, { clock });
        if (disp)
            return { ok: false, reason: disp };
        const emission = state.emissions ? state.emissions[fingerprint] : null;
        if (emission && (!sessionId || emission.session_id === sessionId)) {
            return { ok: false, reason: SUPPRESS_REASONS.ALREADY_EMITTED };
        }
        const t = nowMs(clock);
        const lease = state.leases ? state.leases[fingerprint] : null;
        if (lease && Number.isFinite(Date.parse(lease.expires_at)) && Date.parse(lease.expires_at) > t) {
            return { ok: false, reason: SUPPRESS_REASONS.LEASE_HELD };
        }
        // Per-rule session ceiling, re-checked HERE against durable state.
        // The engine also filters on its pre-lock snapshot, but that snapshot is
        // taken outside the lock and never refreshed: two concurrent Stop hooks
        // holding DISTINCT fingerprints of the same rule both read count 0, both
        // pass that filter, and — without this check — both claim, breaching a
        // ceiling of 1. Counting live leases as well as emissions closes the
        // window between a competitor's claim and its markEmitted.
        if (maxPerRulePerSession > 0 && sessionId && ruleId) {
            const counted = new Set();
            for (const [fp, e] of Object.entries(state.emissions || {})) {
                if (e && e.rule_id === ruleId && e.session_id === sessionId)
                    counted.add(fp);
            }
            for (const [fp, l] of Object.entries(state.leases || {})) {
                if (!l || l.rule_id !== ruleId || l.session_id !== sessionId)
                    continue;
                if (Number.isFinite(Date.parse(l.expires_at)) && Date.parse(l.expires_at) > t)
                    counted.add(fp);
            }
            counted.delete(fingerprint); // our own prior lease must not count against us
            if (counted.size >= maxPerRulePerSession) {
                return { ok: false, reason: SUPPRESS_REASONS.OVER_BUDGET };
            }
        }
        const token = owner || `${process.pid}:${crypto.randomBytes(8).toString("hex")}`;
        state.leases[fingerprint] = {
            owner: token,
            session_id: sessionId,
            rule_id: ruleId || null, // required by the per-rule ceiling above
            acquired_at: new Date(t).toISOString(),
            expires_at: new Date(t + leaseSeconds * 1000).toISOString(),
        };
        writeStateOrThrow(wolfDir, state);
        return { ok: true, token };
    }
    catch (err) {
        // Persistence failed. Do NOT claim — claiming without a durable record
        // means every concurrent process also claims, and the user sees N
        // duplicates. Surface it as degraded so the caller can emit one concise
        // diagnostic instead of silently looping.
        return { ok: false, reason: "state_error", degraded: true, error: String(err && err.message || err) };
    }
    finally {
        release();
    }
}
/** Convert a held lease into a durable emission record. */
export function markEmitted(wolfDir, fingerprint, { token, sessionId = "", ruleId = "", ownerRoot = null, clock } = {}) {
    const file = nudgeStatePath(wolfDir);
    const release = acquireFileLock(file);
    if (!release)
        return { ok: false, degraded: true, reason: SUPPRESS_REASONS.LEASE_HELD };
    try {
        const state = readState(wolfDir);
        const lease = state.leases ? state.leases[fingerprint] : null;
        // Only the lease holder may convert it. A different token means our
        // lease expired and another process took over; that process owns the
        // emission record.
        if (lease && token && lease.owner !== token) {
            return { ok: false, reason: "lease_taken_over" };
        }
        state.emissions[fingerprint] = {
            rule_id: ruleId,
            owner_root: ownerRoot ? canonicalPath(ownerRoot) : null,
            session_id: sessionId,
            emitted_at: new Date(nowMs(clock)).toISOString(),
            state: NUDGE_STATES.EMITTED,
        };
        if (state.leases)
            delete state.leases[fingerprint];
        writeStateOrThrow(wolfDir, state);
        return { ok: true };
    }
    catch (err) {
        return { ok: false, degraded: true, error: String(err && err.message || err) };
    }
    finally {
        release();
    }
}
/** Release a lease without emitting (caller decided not to emit after all). */
export function releaseLease(wolfDir, fingerprint, token) {
    const release = acquireFileLock(nudgeStatePath(wolfDir));
    if (!release)
        return false;
    try {
        const state = readState(wolfDir);
        const lease = state.leases ? state.leases[fingerprint] : null;
        if (!lease)
            return true;
        if (token && lease.owner !== token)
            return false;
        delete state.leases[fingerprint];
        writeStateOrThrow(wolfDir, state);
        return true;
    }
    catch {
        return false;
    }
    finally {
        release();
    }
}
/**
 * Record a durable disposition against an exact fingerprint.
 *
 * Binding to the fingerprint — never to the bare rule id — is what keeps
 * "dismiss" from blinding the rule forever. New evidence produces a new
 * fingerprint with no disposition, so a genuinely new problem still surfaces
 * (test 6).
 */
export function setDisposition(wolfDir, fingerprint, dispositionState, { reason = "", until = null, sessionId = "", ruleId = "", clock } = {}) {
    const release = acquireFileLock(nudgeStatePath(wolfDir));
    if (!release)
        return { ok: false, degraded: true };
    try {
        const state = readState(wolfDir);
        state.dispositions[fingerprint] = {
            state: dispositionState,
            reason: reason || "",
            until: until || null,
            session_id: sessionId,
            rule_id: ruleId,
            at: new Date(nowMs(clock)).toISOString(),
        };
        writeStateOrThrow(wolfDir, state);
        return { ok: true };
    }
    catch (err) {
        return { ok: false, degraded: true, error: String(err && err.message || err) };
    }
    finally {
        release();
    }
}
/**
 * Review lineage bookkeeping. The round cap must apply to the LINEAGE (one
 * logical fix-and-review conversation), not to each content hash — otherwise
 * every fix mints a new hash, resets the counter, and a "3 round" protocol runs
 * seven rounds (the observed failure).
 */
export function bumpLineageRound(wolfDir, lineageId, { clock } = {}) {
    const release = acquireFileLock(nudgeStatePath(wolfDir));
    if (!release)
        return { ok: false, round: null, degraded: true };
    try {
        const state = readState(wolfDir);
        const prior = state.lineages[lineageId] || { rounds: 0, escalated: false };
        prior.rounds = (typeof prior.rounds === "number" ? prior.rounds : 0) + 1;
        prior.last_round_at = new Date(nowMs(clock)).toISOString();
        state.lineages[lineageId] = prior;
        writeStateOrThrow(wolfDir, state);
        return { ok: true, round: prior.rounds, escalated: prior.escalated === true };
    }
    catch (err) {
        return { ok: false, round: null, degraded: true, error: String(err && err.message || err) };
    }
    finally {
        release();
    }
}
export function getLineage(wolfDir, lineageId) {
    const state = readState(wolfDir);
    return state.lineages[lineageId] || { rounds: 0, escalated: false };
}
export function markLineageEscalated(wolfDir, lineageId, { clock } = {}) {
    const release = acquireFileLock(nudgeStatePath(wolfDir));
    if (!release)
        return false;
    try {
        const state = readState(wolfDir);
        const prior = state.lineages[lineageId] || { rounds: 0 };
        prior.escalated = true;
        prior.escalated_at = new Date(nowMs(clock)).toISOString();
        state.lineages[lineageId] = prior;
        writeStateOrThrow(wolfDir, state);
        return true;
    }
    catch {
        return false;
    }
    finally {
        release();
    }
}
//# sourceMappingURL=state.js.map