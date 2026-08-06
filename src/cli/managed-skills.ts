import * as fs from "node:fs";
import * as path from "node:path";
import { safeCopyFile } from "../utils/fs-safe.js";

export const MANAGED_CLAUDE_SKILL_FILES = [
  "skills/quality-reduction/SKILL.md",
] as const;

const PRESENCE_FILE = ".managed-skill-presence.json";

type PresenceRecord = Record<string, boolean>;

export function installManagedClaudeSkills(templatesDir: string, projectRoot: string): number {
  let installed = 0;
  for (const relativePath of MANAGED_CLAUDE_SKILL_FILES) {
    const source = path.join(templatesDir, "claude", relativePath);
    if (!fs.existsSync(source)) {
      throw new Error(`Managed Claude skill template missing: ${source}`);
    }
    safeCopyFile(source, path.join(projectRoot, ".claude", relativePath));
    installed++;
  }
  return installed;
}

export function backupManagedClaudeSkills(projectRoot: string, backupDir: string): void {
  const presence: PresenceRecord = {};
  const claudeBackup = path.join(backupDir, ".claude");

  for (const relativePath of MANAGED_CLAUDE_SKILL_FILES) {
    const source = path.join(projectRoot, ".claude", relativePath);
    const existed = fs.existsSync(source);
    presence[relativePath] = existed;
    if (existed) {
      safeCopyFile(source, path.join(claudeBackup, relativePath));
    }
  }

  fs.mkdirSync(claudeBackup, { recursive: true });
  fs.writeFileSync(
    path.join(claudeBackup, PRESENCE_FILE),
    JSON.stringify(presence, null, 2) + "\n",
    "utf-8",
  );
}

export function restoreManagedClaudeSkills(projectRoot: string, backupDir: string, templatesDir: string): void {
  const claudeBackup = path.join(backupDir, ".claude");
  const presencePath = path.join(claudeBackup, PRESENCE_FILE);
  if (!fs.existsSync(presencePath)) return;

  const presence = JSON.parse(fs.readFileSync(presencePath, "utf-8")) as PresenceRecord;
  for (const relativePath of MANAGED_CLAUDE_SKILL_FILES) {
    const destination = path.join(projectRoot, ".claude", relativePath);
    if (presence[relativePath]) {
      const source = path.join(claudeBackup, relativePath);
      if (!fs.existsSync(source)) {
        throw new Error(`Managed Claude skill backup missing: ${source}`);
      }
      safeCopyFile(source, destination);
    } else if (fs.existsSync(destination)) {
      const managedTemplate = path.join(templatesDir, "claude", relativePath);
      if (
        fs.existsSync(managedTemplate)
        && fs.readFileSync(destination).equals(fs.readFileSync(managedTemplate))
      ) {
        fs.unlinkSync(destination);
      }
    }
  }
}
