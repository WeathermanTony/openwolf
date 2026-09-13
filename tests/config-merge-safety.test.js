import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { mergeConfigDefaults } from "../dist/src/cli/update.js";
import { EXCLUDE_PATTERNS_ADDED } from "../dist/src/scanner/exclusions.js";

function tempFiles(existing, defaults) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wolfpack-config-merge-"));
  const source = path.join(dir, "defaults.json");
  const destination = path.join(dir, "config.json");
  fs.writeFileSync(source, defaults);
  fs.writeFileSync(destination, existing);
  return { dir, source, destination };
}

test("config merge preserves malformed project bytes", () => {
  const files = tempFiles("{ malformed project config }", JSON.stringify({ openwolf: { enabled: true } }));
  try {
    assert.throws(() => mergeConfigDefaults(files.source, files.destination), /Refusing to replace malformed or unreadable project config/);
    assert.equal(fs.readFileSync(files.destination, "utf8"), "{ malformed project config }");
  } finally {
    fs.rmSync(files.dir, { recursive: true, force: true });
  }
});

test("config merge adds new scanner exclusions without replacing customized values", () => {
  const existing = {
    openwolf: {
      enabled: false,
      anatomy: { max_files: 17, exclude_patterns: ["custom-cache"] },
    },
  };
  const defaults = {
    openwolf: {
      enabled: true,
      anatomy: { max_files: 500, max_description_length: 100, exclude_patterns: ["node_modules"] },
    },
  };
  const files = tempFiles(JSON.stringify(existing), JSON.stringify(defaults));
  try {
    mergeConfigDefaults(files.source, files.destination);
    const merged = JSON.parse(fs.readFileSync(files.destination, "utf8"));
    assert.equal(merged.openwolf.enabled, false);
    assert.equal(merged.openwolf.anatomy.max_files, 17);
    assert.equal(merged.openwolf.anatomy.max_description_length, 100);
    assert.equal(merged.openwolf.anatomy.exclude_patterns[0], "custom-cache");
    for (const pattern of EXCLUDE_PATTERNS_ADDED) assert.ok(merged.openwolf.anatomy.exclude_patterns.includes(pattern), pattern);
  } finally {
    fs.rmSync(files.dir, { recursive: true, force: true });
  }
});
