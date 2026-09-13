import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildAnatomy } from "../dist/src/scanner/anatomy-scanner.js";
import { extractDescription } from "../dist/src/scanner/description-extractor.js";
import { DEFAULT_EXCLUDE_PATTERNS, isGitIgnored, isVirtualenvDir, parseGitignore } from "../dist/src/scanner/exclusions.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-scanner-"));
  const wolfDir = path.join(root, ".wolf");
  fs.mkdirSync(wolfDir);
  fs.writeFileSync(path.join(wolfDir, "config.json"), JSON.stringify({
    version: 1,
    openwolf: {
      anatomy: { max_description_length: 100, max_files: 500, exclude_patterns: [...DEFAULT_EXCLUDE_PATTERNS] },
      token_audit: { chars_per_token_code: 3.5, chars_per_token_prose: 4 },
    },
  }));
  return { root, wolfDir };
}

test("description extraction can use already-read content without reopening the file", () => {
  const missing = path.join(os.tmpdir(), `missing-${process.pid}.ts`);
  assert.equal(extractDescription(missing, "/** Supplied description. */\nexport const value = 1;"), "Supplied description.");
});

test("root gitignore supports anchoring, directory rules, wildcards, and negation", () => {
  const rules = parseGitignore("dist/\n*.log\n!important.log\n/build/**\n");
  assert.equal(isGitIgnored(rules, "dist", true), true);
  assert.equal(isGitIgnored(rules, "nested/error.log", false), true);
  assert.equal(isGitIgnored(rules, "important.log", false), false);
  assert.equal(isGitIgnored(rules, "build/out.js", false), true);
  assert.equal(isGitIgnored(rules, "src/build/out.js", false), false);
});

test("scanner excludes gitignored and semantic virtualenv content without dropping env source", () => {
  const { root, wolfDir } = fixture();
  try {
    fs.writeFileSync(path.join(root, ".gitignore"), "generated/\n");
    fs.mkdirSync(path.join(root, "generated"));
    fs.writeFileSync(path.join(root, "generated", "noise.ts"), "export const noise = true;\n");
    fs.mkdirSync(path.join(root, "python-env"));
    fs.writeFileSync(path.join(root, "python-env", "pyvenv.cfg"), "home = /usr/bin\n");
    fs.writeFileSync(path.join(root, "python-env", "site.py"), "print('noise')\n");
    fs.mkdirSync(path.join(root, "env"));
    fs.writeFileSync(path.join(root, "env", "settings.py"), "# Application settings\nVALUE = 1\n");
    fs.writeFileSync(path.join(root, "app.ts"), "/** Main app. */\nexport const app = true;\n");

    assert.equal(isVirtualenvDir(path.join(root, "python-env")), true);
    const anatomy = buildAnatomy(wolfDir, root).content;
    assert.match(anatomy, /`app\.ts`/);
    assert.match(anatomy, /`settings\.py`/);
    assert.doesNotMatch(anatomy, /`noise\.ts`/);
    assert.doesNotMatch(anatomy, /`site\.py`/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
