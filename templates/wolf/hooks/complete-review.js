#!/usr/bin/env node
import * as path from "node:path";
import { getWolfDir, readJSON, writeJSON, hashFilesAtRest, HASH_SENTINEL_UNREADABLE } from "./shared.js";
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

function fail(message, code = 1) {
    console.error(`OpenWolf review completion failed: ${message}`);
    process.exit(code);
}

const { id, reviewer, summary } = parseArgs(process.argv.slice(2));
if (!/^review-\d+$/.test(id)) {
    usage();
    fail("review id must look like review-0001", 2);
}
if (!reviewer || reviewer.trim().length === 0) {
    fail("--reviewer must not be empty", 2);
}

const wolfDir = getWolfDir();
const reviewLogPath = path.join(wolfDir, "reviewlog.json");
const release = acquireFileLock(reviewLogPath);
if (!release) {
    fail(`could not lock ${reviewLogPath}`);
}

try {
    const reviewLog = readJSON(reviewLogPath, { version: 1, reviews: [] });
    if (!Array.isArray(reviewLog.reviews)) {
        fail("reviewlog.json has no reviews array");
    }
    const review = reviewLog.reviews.find((r) => r?.id === id);
    if (!review) {
        fail(`${id} does not exist; refusing to create review entries`);
    }
    if (review.status !== "pending") {
        fail(`${id} has status ${JSON.stringify(review.status)}; only pending reviews can be completed`);
    }
    if (!Array.isArray(review.files) || review.files.length === 0 || review.files.some((f) => typeof f !== "string" || f.length === 0)) {
        fail(`${id} has no valid files array`);
    }

    if (!review.content_hashes || typeof review.content_hashes !== "object" || Array.isArray(review.content_hashes)) {
        fail(`${id} has no content_hashes; wait for the Stop hook to create/reuse a pending hash-bearing entry, then rerun the independent review`);
    }

    const contentHashes = hashFilesAtRest(review.files);
    const unreadableFiles = Object.entries(contentHashes)
        .filter(([, hash]) => hash === HASH_SENTINEL_UNREADABLE)
        .map(([file]) => file);
    if (unreadableFiles.length > 0) {
        fail(`refusing to complete ${id}; unreadable review file(s): ${unreadableFiles.join(", ")}`);
    }

    const mismatchedFiles = Object.entries(contentHashes)
        .filter(([file, hash]) => review.content_hashes?.[file] !== hash)
        .map(([file]) => file);
    const missingReviewedFiles = Object.keys(review.content_hashes)
        .filter((file) => !Object.prototype.hasOwnProperty.call(contentHashes, file));
    if (mismatchedFiles.length > 0 || missingReviewedFiles.length > 0) {
        fail(`refusing to complete ${id}; reviewed file hashes changed or file set drifted. Rerun the independent review on current content. Changed/missing: ${[...mismatchedFiles, ...missingReviewedFiles].join(", ")}`);
    }

    review.status = "completed";
    review.completed_at = new Date().toISOString();
    review.reviewer = reviewer.trim();
    if (summary.trim().length > 0) {
        review.review_summary = summary.trim();
    }
    review.content_hashes = contentHashes;

    writeJSON(reviewLogPath, reviewLog);
    console.log(`OpenWolf completed ${id} and verified content_hashes for ${Object.keys(contentHashes).length} file(s).`);
}
finally {
    release();
}
