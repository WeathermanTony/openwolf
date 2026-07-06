import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { findProjectRoot } from "../scanner/project-root.js";
import { readJSON } from "../utils/fs-safe.js";
import { hashFilesAtRest, hashReviewManifest, HASH_SENTINEL_UNREADABLE, normalizeFilePath, getReviewHashes } from "../hooks/shared.js";

interface ReviewEntry {
  id: string;
  status?: string;
  files?: string[];
  reviewer?: string;
  review_summary?: string;
  completed_at?: string;
  reviewed_hash?: string;
  content_hashes?: Record<string, string>;
  receipt?: { hashes?: Record<string, string>; reviewed_hash?: string; kind?: string };
  [key: string]: unknown;
}

interface ReviewLog {
  version: number;
  reviews: ReviewEntry[];
}

function wolfDir(): string {
  const projectRoot = findProjectRoot();
  const dir = path.join(projectRoot, ".wolf");
  if (!fs.existsSync(dir)) {
    console.log("Wolfpack not initialized. Run: wolfpack init");
    process.exitCode = 1;
  }
  return dir;
}

function readReviewLog(): ReviewLog {
  const dir = wolfDir();
  return readJSON<ReviewLog>(path.join(dir, "reviewlog.json"), { version: 1, reviews: [] });
}

function findReview(id: string): ReviewEntry | undefined {
  const log = readReviewLog();
  return Array.isArray(log.reviews) ? log.reviews.find((r) => r?.id === id) : undefined;
}

function compactFiles(files: string[] = [], max = 3): string {
  if (files.length <= max) return files.join(", ");
  return `${files.slice(0, max).join(", ")} +${files.length - max} more`;
}

function currentHashSummary(files: string[] = []): { hashes: Record<string, string>; manifestHash: string; unreadable: string[] } {
  const normalized = [...new Set(files.map(normalizeFilePath))];
  const hashes = hashFilesAtRest(normalized);
  const unreadable = Object.entries(hashes).filter(([, hash]) => hash === HASH_SENTINEL_UNREADABLE).map(([file]) => file);
  const manifestHash = hashReviewManifest(normalized, hashes);
  return { hashes, manifestHash, unreadable };
}

function reviewedProvenanceHash(review: ReviewEntry): string | undefined {
  if (typeof review.reviewed_hash === "string" && review.reviewed_hash.length > 0) return review.reviewed_hash;
  if (review.receipt?.kind === "reviewed-byte" && typeof review.receipt.reviewed_hash === "string") return review.receipt.reviewed_hash;
  return undefined;
}

export function reviewList(): void {
  const log = readReviewLog();
  const reviews = Array.isArray(log.reviews) ? log.reviews : [];
  if (reviews.length === 0) {
    console.log("No Wolfpack reviews found.");
    return;
  }
  console.log(`Wolfpack reviews (${reviews.length}):\n`);
  for (const review of reviews) {
    const files = Array.isArray(review.files) ? review.files : [];
    const provenance = reviewedProvenanceHash(review) ? "hash-provenance" : "no-reviewed-hash";
    const reviewer = review.reviewer ? ` reviewer=${review.reviewer}` : "";
    console.log(`  ${review.id} ${review.status ?? "unknown"}${reviewer} ${provenance}`);
    if (files.length > 0) console.log(`    Files: ${compactFiles(files)}`);
  }
}

export function reviewShow(id: string): void {
  const review = findReview(id);
  if (!review) {
    console.log(`Review not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  const files = Array.isArray(review.files) ? review.files : [];
  const { hashes, manifestHash, unreadable } = currentHashSummary(files);
  const stored = getReviewHashes(review) ?? {};
  console.log(`${review.id} ${review.status ?? "unknown"}`);
  if (review.reviewer) console.log(`Reviewer: ${review.reviewer}`);
  if (review.review_summary) console.log(`Summary: ${review.review_summary}`);
  const reviewedHash = reviewedProvenanceHash(review);
  if (reviewedHash) console.log(`Reviewed hash: ${reviewedHash}`);
  console.log(`Current manifest hash: ${manifestHash}`);
  if (unreadable.length > 0) console.log(`Unreadable: ${unreadable.join(", ")}`);
  for (const file of files.map(normalizeFilePath)) {
    const current = hashes[file];
    const prior = stored[file];
    const state = prior === current ? "same" : "diff";
    console.log(`  ${state} ${file}`);
    console.log(`    stored=${prior ?? "<none>"}`);
    console.log(`    current=${current ?? "<none>"}`);
  }
}

export function reviewHash(files: string[]): void {
  if (!files || files.length === 0) {
    console.log("Usage: wolfpack review hash <file...>");
    process.exitCode = 2;
    return;
  }
  const normalized = files.map((f) => normalizeFilePath(path.resolve(f)));
  const { hashes, manifestHash, unreadable } = currentHashSummary(normalized);
  if (unreadable.length > 0) {
    console.log(`Unreadable review file(s): ${unreadable.join(", ")}`);
    process.exitCode = 5;
    return;
  }
  console.log(`Review manifest hash: ${manifestHash}`);
  for (const file of normalized) {
    console.log(`${hashes[file]}  ${file}`);
  }
}

export function reviewComplete(id: string, opts: { reviewer?: string; summary?: string; reviewedHash?: string; reviewedCurrent?: boolean } = {}): void {
  const dir = wolfDir();
  if (process.exitCode) return;
  const helper = path.join(dir, "hooks", "complete-review.js");
  const args = [helper, id, "--reviewer", opts.reviewer ?? "manual", "--summary", opts.summary ?? ""];
  if (opts.reviewedHash) args.push("--reviewed-hash", opts.reviewedHash);
  if (opts.reviewedCurrent) args.push("--reviewed-current");
  const result = spawnSync(process.execPath, args, {
    cwd: path.dirname(dir),
    env: { ...process.env, CLAUDE_PROJECT_DIR: path.dirname(dir) },
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 1;
}
