// @ts-nocheck
/** Explicit user-stated learning signals. Transcript text is evidence, never instruction. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { makeCandidate } from "../engine.js";

export const RULE_ID = "learning.explicit";
const SCHEMA_VERSION = 1;
const CONTROL = /<(?:system-reminder|task-notification|hookSpecificOutput|command-name)\b|ignore (?:all |the )?(?:previous|prior) instructions|system prompt/i;
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp|github_pat|xox[baprs])-[_A-Za-z0-9-]{16,}|\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*\S{8,}/i;
const QUESTION = /^\s*(?:can|could|would|will|should|do|does|did|is|are|what|why|how|where|when)\b.*\?\s*$/i;

function hashFile(p) {
    try { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
    catch { return "unreadable"; }
}

export function topicKey(text) {
    const stop = new Set(["about", "because", "instead", "please", "prefer", "rather", "remember", "should", "dont", "that", "this", "with", "would", "using", "use"]);
    return String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
        .filter(w => w.length > 2 && !stop.has(w)).slice(0, 8).join("-").slice(0, 80) || "explicit-learning";
}

export function classifyExplicitLearning(text) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (s.length < 12 || s.length > 4000 || QUESTION.test(s) || CONTROL.test(s) || SECRET.test(s)) return null;
    if (/^(?:here(?:'s| is)|quoted?|example|the (?:file|text|message|user) says?)\b.{0,80}\b(?:i|we)\s+(?:prefer|chose|decided)\b/i.test(s)) return null;
    const patterns = [
        { kind: "preference", section: "## User Preferences", re: /\b(?:i|we)\s+(?:strongly\s+)?prefer\b|\b(?:i am|i'm|we are|we're)\s+(?:not\s+)?(?:a\s+)?(?:big\s+)?fan of\b|\bplease\s+(?:use|avoid)\b.+\b(?:rather than|instead of)\b/i },
        { kind: "correction", section: "## Do-Not-Repeat", re: /^\s*(?:no[,.:;-]|not quite\b)|\b(?:don't|do not|never|always|remember to)\b|\b(?:use|do)\b.+\binstead\b/i },
        { kind: "decision", section: "## Decision Log", re: /\b(?:we (?:chose|choose|will use|decided)|let's|let us)\b.+\b(?:because|not|rather than|instead of)\b/i },
    ];
    const hit = patterns.find(p => p.re.test(s));
    if (!hit) return null;
    return { ...hit, text: s, topic_key: topicKey(s) };
}

export function collect({ turns = [], ownerRoot, wolfDir, maxExcerptChars = 240, clock = null } = {}) {
    if (!ownerRoot || !wolfDir) return { candidates: [], rejected: [] };
    const cerebrumPath = path.join(wolfDir, "cerebrum.md");
    const cerebrumHash = hashFile(cerebrumPath);
    const candidates = [];
    const rejected = [];
    for (const turn of turns) {
        const classified = classifyExplicitLearning(turn.text);
        if (!classified) { rejected.push(turn.hash); continue; }
        const excerpt = classified.text.slice(0, Math.max(80, maxExcerptChars));
        const detail = {
            candidate_type: "learning",
            trust: "unreviewed",
            kind: classified.kind,
            target_section: classified.section,
            topic_key: classified.topic_key,
            excerpt,
            source_hash: turn.hash,
            source_timestamp: turn.timestamp || "",
            cerebrum_hash: cerebrumHash,
        };
        candidates.push(makeCandidate({
            ruleId: RULE_ID,
            ownerRoot,
            severity: "info",
            confidence: 0.95,
            schemaVersion: SCHEMA_VERSION,
            title: `Record explicit ${classified.kind}`,
            reason: `Explicit ${classified.kind} may be durable: “${excerpt}${classified.text.length > excerpt.length ? "…" : ""}”`,
            action: { command: null, label: "Record in Cerebrum" },
            targetHashes: { [cerebrumPath]: cerebrumHash },
            evidence: {
                kind: classified.kind,
                target_section: classified.section,
                topic_key: classified.topic_key,
                source_hash: turn.hash,
                source_timestamp: turn.timestamp || "",
            },
            detail,
            clock,
        }));
    }
    return { candidates, rejected };
}
