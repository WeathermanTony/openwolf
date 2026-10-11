// @ts-nocheck
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, mutateJSON, readMarkdown, parseAnatomy, estimateTokens, readStdin, normalizePath, projectRelativePath, getSessionFilePath, runHook, getBehaviorConfig } from "./shared.js";
async function main() {
    ensureWolfDir();
    if (getBehaviorConfig().mode === "quiet")
        return;
    const wolfDir = getWolfDir();
    const raw = await readStdin();
    let input;
    try {
        input = JSON.parse(raw);
    }
    catch {
        return;
        return;
    }
    const filePath = input.tool_input?.file_path ?? input.tool_input?.path ?? "";
    const content = input.tool_output?.content ?? "";
    if (!filePath) {
        return;
        return;
    }
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const relToProject = projectRelativePath(projectDir, filePath);
    if (relToProject === null || relToProject === "" || relToProject === ".wolf" || relToProject.startsWith(".wolf/")) {
        return;
        return;
    }
    const normalizedFile = normalizePath(path.resolve(projectDir, relToProject));
    const sessionFile = getSessionFilePath(wolfDir, input.session_id);
    const ext = path.extname(filePath).toLowerCase();
    const codeExts = new Set([".ts", ".js", ".tsx", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".css", ".json", ".yaml", ".yml"]);
    const proseExts = new Set([".md", ".txt", ".rst"]);
    const type = codeExts.has(ext) ? "code" : proseExts.has(ext) ? "prose" : "mixed";
    let tokens = content ? estimateTokens(content, type) : 0;
    // Fallback: if tool_output had no content, use anatomy token estimate
    if (tokens === 0) {
        const anatomyContent = readMarkdown(path.join(wolfDir, "anatomy.md"));
        const sections = parseAnatomy(anatomyContent);
        for (const [sectionKey, entries] of sections) {
            for (const entry of entries) {
                const entryRelPath = normalizePath(path.join(sectionKey, entry.file));
                if (relToProject === entryRelPath) {
                    tokens = entry.tokens;
                    break;
                }
            }
            if (tokens > 0)
                break;
        }
    }
    mutateJSON(sessionFile, { session_id: input.session_id ?? "", files_read: {} }, (session) => {
        session.files_read ??= {};
        if (session.files_read[normalizedFile]) {
            session.files_read[normalizedFile].tokens = tokens;
        }
        else {
            session.files_read[normalizedFile] = {
                count: 1,
                tokens,
                first_read: new Date().toISOString(),
            };
        }
        return session;
    });
    return;
}
runHook("post-read", main);
