#!/usr/bin/env node
// @ts-nocheck
import * as path from "node:path";
import { getWolfDir, readJSON, writeJSON, hashFilesAtRest, HASH_SENTINEL_UNREADABLE, normalizeFilePath } from "./shared.js";
import { acquireFileLock } from "../utils/size-discipline.js";
function usage() {
    console.error('Usage: node .wolf/hooks/complete-review.js review-NNNN [--reviewer <name>] [--summary <text>]');
}
function parseArgs(argv) {
    const out = { id: "", reviewer: "manual", summary: "" };
    const args = [...argv];
    if (args.includes("--help") || args.includes("-h")) {
        usage();
        process.exit(0);
    }
    out.id = args.shift() ?? "";
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--reviewer") {
            out.reviewer = args[++i] ?? "";
        }
        else if (arg === "--summary") {
            out.summary = args[++i] ?? "";
        }
        else {
            console.error(`Unknown argument: ${arg}`);
            usage();
            process.exit(2);
        }
    }
    return out;
}
const EXIT_GENERIC = 1;
const EXIT_USAGE = 2;
const EXIT_LOCK_BUSY = 3;
const EXIT_HASH_DRIFT = 4;
const EXIT_UNREADABLE = 5;
const EXIT_REVIEW_STATE = 6;
let reviewLogPath = "";
function fail(message, code = EXIT_GENERIC) {
    console.error(`OpenWolf review completion failed: ${message}`);
    if (typeof reviewLogPath === "string") {
        console.error(`Review log searched: ${reviewLogPath}`);
        console.error("Hint: review entries are keyed to the current Claude project/CWD .wolf, not necessarily the edited file's nearest project. If files live elsewhere, cd to the project that emitted the nudge or set CLAUDE_PROJECT_DIR.");
    }
    process.exit(code);
}
const { id, reviewer, summary } = parseArgs(process.argv.slice(2));
if (!/^review-\d+$/.test(id)) {
    usage();
    fail("review id must look like review-0001", EXIT_USAGE);
}
if (!reviewer || reviewer.trim().length === 0) {
    fail("--reviewer must not be empty", EXIT_USAGE);
}
const wolfDir = getWolfDir();
reviewLogPath = path.join(wolfDir, "reviewlog.json");
function markSupersededPendingReviews(reviewLog, completedReview) {
    const pendingReviews = reviewLog.reviews.filter((r) => r !== completedReview && r.status === "pending" && Array.isArray(r.files));
    if (pendingReviews.length === 0)
        return 0;
    const pendingFiles = [...new Set(pendingReviews.flatMap((r) => r.files))];
    const currentHashes = hashFilesAtRest(pendingFiles);
    const completedReviews = reviewLog.reviews.filter((r) => r.status === "completed" && r.content_hashes && typeof r.content_hashes === "object");
    let count = 0;
    for (const r of pendingReviews) {
        const normalizedFiles = [...new Set(r.files.map(normalizeFilePath))];
        const coveringReview = completedReviews.find((completed) => normalizedFiles.every((file) => {
            const currentHash = currentHashes[file];
            return currentHash && currentHash !== HASH_SENTINEL_UNREADABLE && completed.content_hashes?.[file] === currentHash;
        }));
        if (!coveringReview)
            continue;
        r.status = "superseded";
        r.superseded_at = new Date().toISOString();
        r.superseded_by = [coveringReview.id];
        count++;
    }
    return count;
}
const release = acquireFileLock(reviewLogPath);
if (!release) {
    fail(`could not lock ${reviewLogPath}`, EXIT_LOCK_BUSY);
}
try {
    const reviewLog = readJSON(reviewLogPath, { version: 1, reviews: [] });
    if (!Array.isArray(reviewLog.reviews)) {
        fail("reviewlog.json has no reviews array", EXIT_REVIEW_STATE);
    }
    const review = reviewLog.reviews.find((r) => r?.id === id);
    if (!review) {
        fail(`${id} does not exist; refusing to create review entries`, EXIT_REVIEW_STATE);
    }
    if (review.status !== "pending") {
        fail(`${id} has status ${JSON.stringify(review.status)}; only pending reviews can be completed`, EXIT_REVIEW_STATE);
    }
    if (!Array.isArray(review.files) || review.files.length === 0 || review.files.some((f) => typeof f !== "string" || f.length === 0)) {
        fail(`${id} has no valid files array`, EXIT_REVIEW_STATE);
    }
    if (!review.content_hashes || typeof review.content_hashes !== "object" || Array.isArray(review.content_hashes)) {
        fail(`${id} has no content_hashes; wait for the Stop hook to create/reuse a pending hash-bearing entry, then rerun the independent review`, EXIT_REVIEW_STATE);
    }
    const contentHashes = hashFilesAtRest(review.files);
    const unreadableFiles = Object.entries(contentHashes)
        .filter(([, hash]) => hash === HASH_SENTINEL_UNREADABLE)
        .map(([file]) => file);
    if (unreadableFiles.length > 0) {
        fail(`refusing to complete ${id}; unreadable review file(s): ${unreadableFiles.join(", ")}`, EXIT_UNREADABLE);
    }
    const mismatchedFiles = Object.entries(contentHashes)
        .filter(([file, hash]) => review.content_hashes?.[file] !== hash)
        .map(([file]) => file);
    const missingReviewedFiles = Object.keys(review.content_hashes)
        .filter((file) => !Object.prototype.hasOwnProperty.call(contentHashes, file));
    if (mismatchedFiles.length > 0 || missingReviewedFiles.length > 0) {
        const driftDetails = [
            ...mismatchedFiles.map((file) => `${file} stored=${String(review.content_hashes?.[file]).slice(0, 16)} current=${String(contentHashes[file]).slice(0, 16)}`),
            ...missingReviewedFiles.map((file) => `${file} stored=${String(review.content_hashes?.[file]).slice(0, 16)} current=<not in review files>`),
        ].join("; ");
        fail(`refusing to complete ${id}; reviewed file hashes changed or file set drifted. Rerun the independent review on current content after the Stop hook refreshes pending hashes. Drift: ${driftDetails}`, EXIT_HASH_DRIFT);
    }
    review.status = "completed";
    review.completed_at = new Date().toISOString();
    review.reviewer = reviewer.trim();
    if (summary.trim().length > 0) {
        review.review_summary = summary.trim();
    }
    review.content_hashes = contentHashes;
    const superseded = markSupersededPendingReviews(reviewLog, review);
    writeJSON(reviewLogPath, reviewLog);
    console.log(`OpenWolf completed ${id} and verified content_hashes for ${Object.keys(contentHashes).length} file(s).${superseded > 0 ? ` Superseded ${superseded} covered pending review(s).` : ""}`);
}
finally {
    release();
}
//# sourceMappingURL=complete-review.js.map