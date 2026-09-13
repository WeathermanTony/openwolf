// @ts-nocheck
import * as path from "node:path";
import { getWolfDir, ensureWolfDir, mutateJSON, readMarkdown, parseAnatomy, readStdin, normalizePath, projectRelativePath, getSessionFilePath, runHook } from "./shared.js";
async function main() {
    ensureWolfDir();
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
    const anatomyContent = readMarkdown(path.join(wolfDir, "anatomy.md"));
    const sections = parseAnatomy(anatomyContent);
    let anatomyEntry = null;
    for (const [sectionKey, entries] of sections) {
        for (const entry of entries) {
            const entryRelPath = normalizePath(path.join(sectionKey, entry.file));
            if (relToProject === entryRelPath) {
                anatomyEntry = entry;
                break;
            }
        }
        if (anatomyEntry)
            break;
    }
    let repeatedTokens = null;
    const persisted = mutateJSON(sessionFile, {
        session_id: input.session_id ?? "", files_read: {}, anatomy_hits: 0, anatomy_misses: 0,
        repeated_reads_warned: 0,
    }, (session) => {
        session.files_read ??= {};
        session.anatomy_hits ??= 0;
        session.anatomy_misses ??= 0;
        session.repeated_reads_warned ??= 0;
        if (session.files_read[normalizedFile]) {
            repeatedTokens = session.files_read[normalizedFile].tokens ?? 0;
            session.files_read[normalizedFile].count = (session.files_read[normalizedFile].count ?? 0) + 1;
            session.repeated_reads_warned++;
            return session;
        }
        if (anatomyEntry)
            session.anatomy_hits++;
        else
            session.anatomy_misses++;
        session.files_read[normalizedFile] = {
            count: 1,
            tokens: 0,
            first_read: new Date().toISOString(),
        };
        return session;
    });
    if (!persisted) {
        return;
        return;
    }
    if (repeatedTokens !== null) {
        process.stderr.write(`⚡ OpenWolf: ${path.basename(normalizedFile)} was already read this session (~${repeatedTokens} tokens). Consider using your existing knowledge of this file.\n`);
    }
    else if (anatomyEntry) {
        process.stderr.write(`📋 OpenWolf anatomy: ${anatomyEntry.file} — ${anatomyEntry.description} (~${anatomyEntry.tokens} tok)\n`);
    }
    return;
}
runHook("pre-read", main);
