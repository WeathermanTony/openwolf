export const HOOK_REGISTRATIONS = [
  { event: "SessionStart", matcher: "", entry: "session-start.js", timeout: 5 },
  { event: "PreToolUse", matcher: "Read", entry: "pre-read.js", timeout: 5 },
  { event: "PreToolUse", matcher: "Write|Edit|MultiEdit", entry: "pre-write.js", timeout: 5 },
  { event: "PostToolUse", matcher: "Read", entry: "post-read.js", timeout: 5 },
  { event: "PostToolUse", matcher: "Write|Edit|MultiEdit", entry: "post-write.js", timeout: 10 },
  { event: "Stop", matcher: "", entry: "stop.js", timeout: 10 },
] as const;

export const HOOK_ENTRY_FILES = HOOK_REGISTRATIONS.map(({ entry }) => entry);
export const HOOK_HELPER_FILES = ["complete-review.js"] as const;
export const HOOK_SUPPORT_FILES = [
  "shared.js",
  "nudges/engine.js",
  "nudges/state.js",
  "nudges/project-scope.js",
  "nudges/rules/cerebrum.js",
  "nudges/rules/conclusion.js",
  "nudges/rules/learning.js",
  "nudges/rules/review.js",
] as const;
export const HOOK_PAYLOAD_FILES = [
  ...HOOK_ENTRY_FILES,
  ...HOOK_HELPER_FILES,
  ...HOOK_SUPPORT_FILES,
] as const;
export const HOOK_UTILITY_FILES = ["size-discipline.js"] as const;
export const HOOK_PACKAGE_JSON = { type: "module" } as const;
export const HOOK_MANIFEST_FILE = "manifest.json";
export const HOOK_RUNTIME_MANIFEST = {
  version: 1,
  hooks: HOOK_PAYLOAD_FILES,
  utilities: HOOK_UTILITY_FILES,
} as const;

export function hookCommand(file: string): string {
  const projectPath = `process.env.CLAUDE_PROJECT_DIR+'/.wolf/hooks/${file}'`;
  return `node -e "const p=${projectPath};import('node:fs').then(fs=>{if(fs.existsSync(p))return import('node:url').then(({pathToFileURL})=>import(pathToFileURL(p).href))}).catch(e=>console.error('WolfPack hook load failed:',e.message))"`;
}

interface HookCommandSetting {
  type: "command";
  command: string;
  timeout: number;
}

interface HookMatcherSetting {
  matcher: string;
  hooks: HookCommandSetting[];
}

export interface HookSettings {
  hooks: Record<string, HookMatcherSetting[]>;
}

export function createHookSettings(): HookSettings {
  const hooks: Record<string, HookMatcherSetting[]> = {};
  for (const registration of HOOK_REGISTRATIONS) {
    (hooks[registration.event] ??= []).push({
      matcher: registration.matcher,
      hooks: [{
        type: "command",
        command: hookCommand(registration.entry),
        timeout: registration.timeout,
      }],
    });
  }
  return { hooks };
}

export const HOOK_SETTINGS = createHookSettings();

export function missingHookRegistrations(settings: unknown): string[] {
  const actualHooks = settings && typeof settings === "object"
    ? (settings as { hooks?: unknown }).hooks
    : undefined;
  if (!actualHooks || typeof actualHooks !== "object") {
    return HOOK_REGISTRATIONS.map(({ event, matcher, entry }) => `${event}:${matcher}:${entry}`);
  }
  const events = actualHooks as Record<string, unknown>;
  return HOOK_REGISTRATIONS.flatMap((registration) => {
    const eventMatchers = events[registration.event];
    const matchers: unknown[] = Array.isArray(eventMatchers) ? eventMatchers : [];
    const found = matchers.some((candidate: unknown) => {
      if (!candidate || typeof candidate !== "object") return false;
      const matcher = candidate as { matcher?: unknown; hooks?: unknown };
      if (matcher.matcher !== registration.matcher || !Array.isArray(matcher.hooks)) return false;
      return matcher.hooks.some((hook) => {
        if (!hook || typeof hook !== "object") return false;
        const command = hook as { type?: unknown; command?: unknown; timeout?: unknown };
        return command.type === "command"
          && command.command === hookCommand(registration.entry)
          && command.timeout === registration.timeout;
      });
    });
    return found ? [] : [`${registration.event}:${registration.matcher}:${registration.entry}`];
  });
}
