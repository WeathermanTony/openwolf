#!/usr/bin/env node
// @ts-nocheck
import * as path from "node:path";
import { getWolfDir, readJSON, writeJSON, hashFilesAtRest, HASH_SENTINEL_TOMBSTONE, HASH_SENTINEL_UNREADABLE, normalizeFilePath, getReviewHashes, setReviewCurrentByteReceipt } from "./shared.js";
import { acquireFileLock } from "../utils/size-discipline.js";

function usage() {
    console.error('Usage: node .wolf/hooks/complete-review.js review-NNNN [--reviewer <name>] [--summary <text>]');
    console.error('       node .wolf/hooks/complete-review.js review-NNNN --refresh');
    console.error('       node .wolf/hooks/complete-review.js review-NNNN --reviewed-current --reviewer <name> --summary <text>');
}

function parseArgs(argv) {
    const out = { id: "", reviewer: "manual", summary: "", refresh: false, reviewedCurrent: false };
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
        else if (arg === "--reviewed-current") {
            out.reviewedCurrent = true;
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

const { id, reviewer, summary, refresh, reviewedCurrent } = parseArgs(process.argv.slice(2));
if (!/^review-\d+$/.test(id)) {
    usage();
    fail("review id must look like review-0001", EXIT_USAGE);
}
if (!refresh && (!reviewer || reviewer.trim().length === 0)) {
    fail("--reviewer must not be empty", EXIT_USAGE);
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
        `  2. Rerun the independent review on the current files.\n` +
        `  3. Complete after review: ${completeCommand}\n` +
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

    const reviewHashes = getReviewHashes(review);
    if (!refresh && (!reviewHashes || typeof reviewHashes !== "object" || Array.isArray(reviewHashes))) {
        fail(`${id} has no content_hashes; refresh the pending review first: node .wolf/hooks/complete-review.js ${id} --refresh`, EXIT_REVIEW_STATE);
    }

    const contentHashes = hashFilesAtRest(review.files);
    if (!refresh && review.requires_rereview === true && !reviewedCurrent) {
        fail(formatReviewStaleMessage(id, reviewHashes, contentHashes, Object.keys(contentHashes), []), EXIT_HASH_DRIFT);
    }
    const unreadableFiles = Object.entries(contentHashes)
        .filter(([, hash]) => hash === HASH_SENTINEL_UNREADABLE)
        .map(([file]) => file);
    if (unreadableFiles.length > 0) {
        fail(`refusing to complete ${id}; unreadable review file(s): ${unreadableFiles.join(", ")}`, EXIT_UNREADABLE);
    }

    if (refresh) {
        setReviewCurrentByteReceipt(review, review.files, contentHashes);
        review.refreshed_at = new Date().toISOString();
        review.refresh_count = (typeof review.refresh_count === "number" ? review.refresh_count : 0) + 1;
        review.requires_rereview = true;
        review.requires_rereview_reason = "pending review refreshed; rerun independent review on current bytes";
        writeJSON(reviewLogPath, reviewLog);
        console.log(`OpenWolf refreshed ${id} content_hashes for ${Object.keys(contentHashes).length} file(s).`);
        console.log("Next: rerun the independent review on current bytes, then complete with:");
        console.log(`  node .wolf/hooks/complete-review.js ${id} --reviewed-current --reviewer <name> --summary "<outcome>"`);
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

    review.status = "completed";
    review.completed_at = new Date().toISOString();
    review.reviewer = reviewer.trim();
    review.requires_rereview = false;
    delete review.requires_rereview_reason;
    if (summary.trim().length > 0) {
        review.review_summary = summary.trim();
    }
    setReviewCurrentByteReceipt(review, review.files, contentHashes);
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
