import * as os from "node:os";

export function isWindows(): boolean {
  return os.platform() === "win32";
}

export function isMac(): boolean {
  return os.platform() === "darwin";
}

export function isLinux(): boolean {
  return os.platform() === "linux";
}

export function whichCommand(): string {
  return isWindows() ? "where" : "which";
}
