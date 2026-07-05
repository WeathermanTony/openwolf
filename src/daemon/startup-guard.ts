import * as fs from "node:fs";

export function shouldStartDaemonForProject(projectRoot: string, wolfDir: string): boolean {
  if (!fs.existsSync(projectRoot)) return false;
  if (!fs.existsSync(wolfDir)) return false;
  try {
    return fs.statSync(projectRoot).isDirectory() && fs.statSync(wolfDir).isDirectory();
  } catch {
    return false;
  }
}
