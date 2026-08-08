#!/usr/bin/env node
// @ts-nocheck
import * as path from "node:path";
import { getWolfDir, readJSON, writeJSON, hashFilesAtRest, HASH_SENTINEL_TOMBSTONE, HASH_SENTINEL_UNREADABLE, normalizeFilePath, getReviewHashes, setReviewCurrentByteReceipt, hashReviewManifest, setReviewReviewedByteReceipt } from "./shared.js";
import { acquireFileLock } from "../utils/size-discipline.js";
function usage() {
    console.error('Usage: node .wolf/hooks/complete-review.js review-NNNN [--reviewer <name>] [--summary <text>]');
    console.error('       node .wolf/hooks/complete-review.js review-NNNN --refresh');
    console.error('       node .wolf/hooks/complete-review.js review-NNNN --check   (read-only: do stored hashes match current bytes?)');
    console.error('       node .wolf/hooks/complete-review.js review-NNNN --reviewed-current --reviewer <name> --summary <text>');
    console.error('       node .wolf/hooks/complete-review.js review-NNNN --reviewer <name> --reviewed-hash <wolfpack-manifest-hash> --summary <text>');
}
function parseArgs(argv) {
    const out = { id: "", reviewer: "manual", summary: "", refresh: false, reviewedCurrent: false, reviewedHash: "", check: false };
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
        else if (arg === "--refresh") {
            out.refresh = true;
        }
        else if (arg === "--check") {
            out.check = true;
        }
        else if (arg === "--reviewed-current") {
            out.reviewedCurrent = true;
        }
        else if (arg === "--reviewed-hash") {
            out.reviewedHash = args[++i] ?? "";
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
const EXIT_REVIEW_HASH_MISMATCH = 7;
let reviewLogPath = "";
let releaseReviewLock = null;
function fail(message, code = EXIT_GENERIC) {
    console.error(`OpenWolf review completion failed: ${message}`);
    if (typeof reviewLogPath === "string") {
        console.error(`Review log searched: ${reviewLogPath}`);
        console.error("Hint: review entries are keyed to the current Claude project/CWD .wolf, not necessarily the edited file's nearest project. If files live elsewhere, cd to the project that emitted the nudge or set CLAUDE_PROJECT_DIR.");
    }
    if (releaseReviewLock) {
        try {
            releaseReviewLock();
        }
        catch { }
        releaseReviewLock = null;
    }
    process.exit(code);
}
const { id, reviewer, summary, refresh, reviewedCurrent, reviewedHash, check } = parseArgs(process.argv.slice(2));
if (!/^review-\d+$/.test(id)) {
    usage();
    fail("review id must look like review-0001", EXIT_USAGE);
}
if (!refresh && !check && (!reviewer || reviewer.trim().length === 0)) {
    fail("--reviewer must not be empty", EXIT_USAGE);
}
if (refresh && reviewedHash) {
    fail("--refresh cannot be combined with --reviewed-hash", EXIT_USAGE);
}
if (reviewedHash && !/^[a-f0-9]{64}$/.test(reviewedHash)) {
    fail("--reviewed-hash must be a 64-character sha256 manifest hash", EXIT_USAGE);
}
const wolfDir = getWolfDir();
reviewLogPath = path.join(wolfDir, "reviewlog.json");
function classifyDrift(file, storedHash, currentHash) {
    if (currentHash === HASH_SENTINEL_UNREADABLE)
        return "unreadable";
    if (currentHash === HASH_SENTINEL_TOMBSTONE)
        return "deleted";
    if (currentHash === undefined)
        return "missing-from-current-file-list";
    return storedHash === currentHash ? "unchanged" : "changed";
}
function formatReviewStaleMessage(id, storedHashes, currentHashes, mismatchedFiles, missingReviewedFiles) {
    const refreshCommand = `node .wolf/hooks/complete-review.js ${id} --refresh`;
    const completeCommand = `node .wolf/hooks/complete-review.js ${id} --reviewed-current --reviewer <name> --summary "<outcome>"`;
    const driftDetails = [
        ...mismatchedFiles.map((file) => {
            const stored = storedHashes?.[file];
            const current = currentHashes[file];
            const kind = classifyDrift(file, stored, current);
            return `${file} ${kind} stored=${String(stored).slice(0, 16)} current=${String(current).slice(0, 16)}`;
        }),
        ...missingReviewedFiles.map((file) => `${file} missing-from-current-file-list stored=${String(storedHashes?.[file]).slice(0, 16)} current=<not in review files>`),
    ];
    const possibleRenames = [];
    const currentByHash = new Map();
    for (const [file, hash] of Object.entries(currentHashes)) {
        if (hash && hash !== HASH_SENTINEL_TOMBSTONE && hash !== HASH_SENTINEL_UNREADABLE) {
            currentByHash.set(hash, file);
        }
    }
    for (const file of missingReviewedFiles) {
        const candidate = currentByHash.get(storedHashes?.[file]);
        if (candidate && candidate !== file) {
            possibleRenames.push(`possible-rename old=${file} current=${candidate} hash=${String(storedHashes?.[file]).slice(0, 16)}`);
        }
    }
    return `REVIEW_STALE: ${id} no longer matches current file bytes. Refusing to complete because the independent review may have covered older content.\n` +
        `Next:\n` +
        `  1. Refresh the pending review receipt: ${refreshCommand}\n` +
        `  2. Rerun a provider companion with review --file <current-path>... on the actual current files.\n` +
        `  3. After observing that current-byte review, complete: ${completeCommand}\n` +
        `Companion receipt hashes are not compatible with Wolfpack --reviewed-hash manifests.\n` +
        `Drift: ${[...driftDetails, ...possibleRenames].join("; ")}`;
}
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
            const completedHashes = getReviewHashes(completed);
            return currentHash && currentHash !== HASH_SENTINEL_UNREADABLE && completedHashes?.[file] === currentHash;
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
releaseReviewLock = release;
try {
    const reviewLog = readJSON(reviewLogPath, { version: 1, reviews: [] });
    if (!Array.isArray(reviewLog.reviews)) {
        fail("reviewlog.json has no reviews array", EXIT_REVIEW_STATE);
    }
    const matches = reviewLog.reviews.filter((r) => r?.id === id);
    if (matches.length > 1) {
        fail(`${id} matches ${matches.length} records; refusing ambiguous mutation. Run wolfpack ledger audit, then wolfpack ledger repair --apply`, EXIT_REVIEW_STATE);
    }
    const review = matches[0];
    if (!review) {
        fail(`${id} does not exist; refusing to create review entries`, EXIT_REVIEW_STATE);
    }
    if (review.status !== "pending") {
        fail(`${id} has status ${JSON.stringify(review.status)}; only pending reviews can be completed`, EXIT_REVIEW_STATE);
    }
    if (!Array.isArray(review.files) || review.files.length === 0 || review.files.some((f) => typeof f !== "string" || f.length === 0)) {
        fail(`${id} has no valid files array`, EXIT_REVIEW_STATE);
    }
    const reviewHashes = getReviewHashes(review);
    if (!refresh && (!reviewHashes || typeof reviewHashes !== "object" || Array.isArray(reviewHashes))) {
        fail(`${id} has no content_hashes; refresh the pending review first: node .wolf/hooks/complete-review.js ${id} --refresh`, EXIT_REVIEW_STATE);
    }
    const contentHashes = hashFilesAtRest(review.files);
    const unreadableFiles = Object.entries(contentHashes)
        .filter(([, hash]) => hash === HASH_SENTINEL_UNREADABLE)
        .map(([file]) => file);
    if (unreadableFiles.length > 0) {
        fail(`refusing to complete ${id}; unreadable review file(s): ${unreadableFiles.join(", ")}`, EXIT_UNREADABLE);
    }
    if (check) {
        // Read-only drift report: do stored (reviewed/refreshed) hashes match
        // current bytes? Exit 0 = current, EXIT_HASH_DRIFT = stale. No mutation.
        const stored = reviewHashes || {};
        const rows = review.files.map((file) => {
            const kind = classifyDrift(file, stored[file], contentHashes[file]);
            return `  ${kind} ${file} stored=${String(stored[file]).slice(0, 16)} current=${String(contentHashes[file]).slice(0, 16)}`;
        });
        const stale = review.files.some((file) => stored[file] !== contentHashes[file]);
        console.log(`OpenWolf ${id}: ${stale ? "STALE — current bytes differ from stored hashes; refresh + re-review before completing" : "CURRENT — stored hashes match current bytes"}.`);
        for (const row of rows)
            console.log(row);
        process.exit(stale ? EXIT_HASH_DRIFT : 0);
    }
    if (refresh) {
        setReviewCurrentByteReceipt(review, review.files, contentHashes);
        review.refreshed_at = new Date().toISOString();
        review.refresh_count = (typeof review.refresh_count === "number" ? review.refresh_count : 0) + 1;
        review.requires_rereview = true;
        review.requires_rereview_reason = "pending review refreshed; rerun independent review on current bytes";
        writeJSON(reviewLogPath, reviewLog);
        const manifestHash = hashReviewManifest(review.files, contentHashes);
        console.log(`OpenWolf refreshed ${id} content_hashes for ${Object.keys(contentHashes).length} file(s).`);
        console.log(`Current Wolfpack manifest hash: ${manifestHash}`);
        console.log("Next: rerun a provider companion with review --file <current-path>... on the actual current bytes, then complete with:");
        console.log(`  node .wolf/hooks/complete-review.js ${id} --reviewed-current --reviewer <name> --summary "<outcome>"`);
        console.log("Do not pass a companion receipt hash to --reviewed-hash; the receipt representations are not compatible.");
    }
    else {
        const mismatchedFiles = Object.entries(contentHashes)
            .filter(([file, hash]) => reviewHashes?.[file] !== hash)
            .map(([file]) => file);
        const missingReviewedFiles = Object.keys(reviewHashes)
            .filter((file) => !Object.prototype.hasOwnProperty.call(contentHashes, file));
        if (mismatchedFiles.length > 0 || missingReviewedFiles.length > 0) {
            fail(formatReviewStaleMessage(id, reviewHashes, contentHashes, mismatchedFiles, missingReviewedFiles), EXIT_HASH_DRIFT);
        }
        const currentManifestHash = hashReviewManifest(review.files, contentHashes);
        if (reviewedHash && reviewedHash !== currentManifestHash) {
            fail(`REVIEW_HASH_MISMATCH: ${id} current manifest hash is ${currentManifestHash}, but --reviewed-hash was ${reviewedHash}. Rerun the reviewer on current bytes or refresh/review again.`, EXIT_REVIEW_HASH_MISMATCH);
        }
        if (review.requires_rereview === true && !reviewedCurrent && !reviewedHash) {
            fail(formatReviewStaleMessage(id, reviewHashes, contentHashes, Object.keys(contentHashes), []), EXIT_HASH_DRIFT);
        }
        review.status = "completed";
        review.completed_at = new Date().toISOString();
        review.reviewer = reviewer.trim();
        review.requires_rereview = false;
        delete review.requires_rereview_reason;
        if (summary.trim().length > 0) {
            review.review_summary = summary.trim();
        }
        if (reviewedHash) {
            setReviewReviewedByteReceipt(review, review.files, contentHashes, { reviewer: reviewer.trim(), source: "reviewed-hash" });
        }
        else {
            setReviewCurrentByteReceipt(review, review.files, contentHashes);
        }
        const superseded = markSupersededPendingReviews(reviewLog, review);
        writeJSON(reviewLogPath, reviewLog);
        console.log(`OpenWolf completed ${id} and verified content_hashes for ${Object.keys(contentHashes).length} file(s).${superseded > 0 ? ` Superseded ${superseded} covered pending review(s).` : ""}`);
    }
}
finally {
    if (releaseReviewLock) {
        releaseReviewLock();
        releaseReviewLock = null;
    }
}
//# sourceMappingURL=complete-review.js.map