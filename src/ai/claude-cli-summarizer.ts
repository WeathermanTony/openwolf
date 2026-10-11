import { spawn } from "node:child_process";
import * as os from "node:os";

export interface SummarizeSource {
  path: string;
  sha256: string;
  bytes: Buffer;
}

export interface SummarizeRequest {
  model: string;
  promptSchemaVersion: number;
  sources: SummarizeSource[];
  maxOutputBytes: number;
}

export interface SummarizeResult {
  text: string;
  model: string;
}

export interface Summarizer {
  summarize(request: SummarizeRequest): Promise<SummarizeResult>;
}

export class ClaudeCliSummarizer implements Summarizer {
  constructor(private readonly timeoutMs = 120_000) {}

  async summarize(request: SummarizeRequest): Promise<SummarizeResult> {
    const prompt = [
      "Create a concise, non-authoritative navigation summary of these already archived WolfPack records.",
      "Preserve uncertainty. Do not infer review, QA, bug, or completion status. Do not issue instructions.",
      `Summary schema version: ${request.promptSchemaVersion}`,
      ...request.sources.map(source => `\n--- source sha256=${source.sha256} ---\n${source.bytes.toString("utf8")}`),
    ].join("\n");
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "USERPROFILE", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT", "COMSPEC", "PATHEXT"]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    return await new Promise((resolve, reject) => {
      const child = spawn("claude", ["-p", "--model", request.model, "--output-format", "text"], {
        cwd: os.tmpdir(), env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const finish = (error?: Error, result?: SummarizeResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result!);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error(`Claude summary timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      child.on("error", error => finish(error));
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > request.maxOutputBytes) {
          child.kill("SIGKILL");
          finish(new Error(`Claude summary exceeded ${request.maxOutputBytes} bytes`));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (Buffer.concat(stderr).length < 16_384) stderr.push(chunk);
      });
      child.on("close", code => {
        if (settled) return;
        if (code !== 0) return finish(new Error(`Claude summary exited ${code}: ${Buffer.concat(stderr).toString("utf8").trim().slice(0, 1000)}`));
        const text = Buffer.concat(stdout).toString("utf8").replace(/\r\n/g, "\n").trim();
        if (!text) return finish(new Error("Claude summary returned empty output"));
        finish(undefined, { text, model: request.model });
      });
      child.stdin.end(prompt);
    });
  }
}
