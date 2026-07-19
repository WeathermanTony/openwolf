// @ts-nocheck
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
export function getWolfDir() {
    // Prefer CLAUDE_PROJECT_DIR so hooks work even if CWD changes during a session
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    return path.join(projectDir, ".wolf");
}
/**
 * Bail out silently if .wolf/ directory doesn't exist in the current project.
 * Call this at the top of every hook to avoid crashes in non-OpenWolf projects.
 */
export function ensureWolfDir() {
    const wolfDir = getWolfDir();
    if (!fs.existsSync(wolfDir)) {
        process.exit(0);
    }
}
export function readJSON(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    catch {
        return fallback;
    }
}
export function writeJSON(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
        fs.renameSync(tmp, filePath);
    }
    catch {
        // On Windows, rename can fail if another process holds a handle.
        // Fall back to direct write and clean up the tmp file.
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        }
        catch { }
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
    }
}
export function readMarkdown(filePath) {
    try {
        return fs.readFileSync(filePath, "utf-8");
    }
    catch {
        return "";
    }
}
export function appendMarkdown(filePath, line) {
    // Silent no-op on any error per the hook contract — callers should not
    // need defensive try/catch around this helper.
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(filePath, line, "utf-8");
    }
    catch { }
}
export function parseAnatomy(content) {
    const sections = new Map();
    let currentSection = "";
    for (const line of content.split("\n")) {
        const sm = line.match(/^## (.+)/);
        if (sm) {
            currentSection = sm[1].trim();
            if (!sections.has(currentSection))
                sections.set(currentSection, []);
            continue;
        }
        if (!currentSection)
            continue;
        const em = line.match(/^- `([^`]+)`(?:\s+—\s+(.+?))?\s*\(~(\d+)\s+tok\)$/);
        if (em) {
            sections.get(currentSection).push({
                file: em[1],
                description: em[2] || "",
                tokens: parseInt(em[3], 10),
            });
        }
    }
    return sections;
}
export function serializeAnatomy(sections, metadata) {
    const lines = [
        "# anatomy.md",
        "",
        `> Auto-maintained by OpenWolf. Last scanned: ${metadata.lastScanned}`,
        `> Files: ${metadata.fileCount} tracked | Anatomy hits: ${metadata.hits} | Misses: ${metadata.misses}`,
        "",
    ];
    const keys = [...sections.keys()].sort();
    for (const key of keys) {
        lines.push(`## ${key}`);
        lines.push("");
        const entries = sections.get(key).sort((a, b) => a.file.localeCompare(b.file));
        for (const e of entries) {
            const desc = e.description ? ` — ${e.description}` : "";
            lines.push(`- \`${e.file}\`${desc} (~${e.tokens} tok)`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
export function extractDescription(filePath) {
    const MAX_DESC = 150;
    const basename = path.basename(filePath);
    const ext = path.extname(basename).toLowerCase();
    const known = {
        "package.json": "Node.js package manifest",
        "tsconfig.json": "TypeScript configuration",
        ".gitignore": "Git ignore rules",
        "README.md": "Project documentation",
        "composer.json": "PHP package manifest",
        "requirements.txt": "Python dependencies",
        "schema.sql": "Database schema",
        "Dockerfile": "Docker container definition",
        "docker-compose.yml": "Docker Compose services",
        "Cargo.toml": "Rust package manifest",
        "go.mod": "Go module definition",
        "Gemfile": "Ruby dependencies",
        "pubspec.yaml": "Dart/Flutter package manifest",
    };
    if (known[basename])
        return known[basename];
    let content;
    try {
        const fd = fs.openSync(filePath, "r");
        const buf = Buffer.alloc(12288); // 12KB
        const n = fs.readSync(fd, buf, 0, 12288, 0);
        fs.closeSync(fd);
        content = buf.subarray(0, n).toString("utf-8");
    }
    catch {
        return "";
    }
    if (!content.trim())
        return "";
    const cap = (s) => s.length <= MAX_DESC ? s : s.slice(0, MAX_DESC - 3) + "...";
    // Markdown heading
    if (ext === ".md" || ext === ".mdx") {
        const m = content.match(/^#{1,2}\s+(.+)$/m);
        if (m)
            return cap(m[1].trim());
    }
    // HTML title
    if (ext === ".html" || ext === ".htm") {
        const m = content.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (m)
            return cap(m[1].trim());
    }
    // JSDoc / PHPDoc / Javadoc — first meaningful line
    const jm = content.match(/\/\*\*\s*\n?\s*\*?\s*(.+)/);
    if (jm) {
        const l = jm[1].replace(/\*\/$/, "").trim();
        if (l && !l.startsWith("@") && l.length > 5)
            return cap(l);
    }
    // Python docstring
    if (ext === ".py") {
        const dm = content.match(/^(?:#[^\n]*\n)*\s*(?:"""(.+?)"""|'''(.+?)''')/s);
        if (dm) {
            const first = (dm[1] || dm[2]).split("\n")[0].trim();
            if (first && first.length > 3)
                return cap(first);
        }
    }
    // Rust doc comments
    if (ext === ".rs") {
        const lines = content.split("\n");
        for (const line of lines.slice(0, 20)) {
            const m = line.match(/^\s*(?:\/\/\/|\/\/!)\s*(.+)/);
            if (m && m[1].length > 5)
                return cap(m[1].trim());
        }
    }
    // Go package comment
    if (ext === ".go") {
        const m = content.match(/\/\/\s*Package\s+\w+\s+(.*)/);
        if (m)
            return cap(m[1].trim());
    }
    // C# XML doc
    if (ext === ".cs") {
        const m = content.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/);
        if (m) {
            const text = m[1].replace(/\/\/\/\s*/g, "").replace(/\s+/g, " ").trim();
            if (text.length > 5)
                return cap(text);
        }
    }
    // Elixir @moduledoc
    if (ext === ".ex" || ext === ".exs") {
        const m = content.match(/@moduledoc\s+"""\s*\n\s*(.*)/);
        if (m)
            return cap(m[1].trim());
    }
    // Header comment (skip generic ones)
    const hdrLines = content.split("\n");
    for (const line of hdrLines.slice(0, 15)) {
        const t = line.trim();
        if (!t || t === "<?php" || t.startsWith("#!") || t.startsWith("namespace") || t.startsWith("use ") || t.startsWith("import ") || t.startsWith("from ") || t.startsWith("require") || t.startsWith("module "))
            continue;
        const cm = t.match(/^(?:\/\/|#|--)\s*(.+)/);
        if (cm) {
            const text = cm[1].trim();
            const lower = text.toLowerCase();
            if (text.length > 5 && !lower.startsWith("copyright") && !lower.startsWith("license") && !lower.startsWith("@") && !lower.startsWith("strict") && !lower.startsWith("generated") && !lower.startsWith("eslint-") && !lower.startsWith("nolint")) {
                return cap(text);
            }
        }
        if (!t.startsWith("//") && !t.startsWith("#") && !t.startsWith("/*") && !t.startsWith("*") && !t.startsWith("--"))
            break;
    }
    // ─── PHP / Laravel ───────────────────────────────────────
    if (ext === ".php") {
        if (basename.endsWith(".blade.php")) {
            const ext2 = content.match(/@extends\(\s*['"]([^'"]+)['"]\s*\)/);
            const sections = (content.match(/@section\(\s*['"](\w+)['"]/g) || []).map(s => s.match(/['"](\w+)['"]/)?.[1]).filter(Boolean);
            const parts = [];
            if (ext2)
                parts.push(`extends ${ext2[1]}`);
            if (sections.length)
                parts.push(`sections: ${sections.join(", ")}`);
            return cap(parts.length ? `Blade: ${parts.join(", ")}` : "Blade template");
        }
        const classM = content.match(/class\s+(\w+)(?:\s+extends\s+(\w+))?/);
        const className = classM?.[1] || "";
        const parent = classM?.[2] || "";
        const pubMethods = (content.match(/public\s+function\s+(\w+)/g) || [])
            .map(m => m.match(/public\s+function\s+(\w+)/)?.[1])
            .filter(n => n && n !== "__construct" && n !== "middleware");
        if (basename.endsWith("Controller.php") || parent === "Controller") {
            if (pubMethods.length > 0) {
                const display = pubMethods.slice(0, 5).join(", ");
                return cap(pubMethods.length > 5 ? `${display} + ${pubMethods.length - 5} more` : display);
            }
        }
        if (parent === "Model" || parent === "Authenticatable") {
            const parts = [];
            const tbl = content.match(/\$table\s*=\s*['"]([^'"]+)['"]/);
            if (tbl)
                parts.push(`table: ${tbl[1]}`);
            const fill = content.match(/\$fillable\s*=\s*\[([^\]]*)\]/s);
            if (fill) {
                const c = (fill[1].match(/['"]/g) || []).length / 2;
                parts.push(`${Math.floor(c)} fields`);
            }
            const rels = (content.match(/\$this->(hasMany|hasOne|belongsTo|belongsToMany|morphMany|morphTo)\(/g) || []).length;
            if (rels)
                parts.push(`${rels} rels`);
            return cap(parts.length ? `Model — ${parts.join(", ")}` : `Model: ${className}`);
        }
        if (basename.match(/^\d{4}_\d{2}_\d{2}/)) {
            const create = content.match(/Schema::create\(\s*['"]([^'"]+)['"]/);
            if (create)
                return `Migration: create ${create[1]} table`;
            const alter = content.match(/Schema::table\(\s*['"]([^'"]+)['"]/);
            if (alter)
                return `Migration: alter ${alter[1]} table`;
            return "Database migration";
        }
        if (className && pubMethods.length > 0) {
            const display = pubMethods.slice(0, 4).join(", ");
            return cap(pubMethods.length > 4 ? `${className}: ${display} + ${pubMethods.length - 4} more` : `${className}: ${display}`);
        }
    }
    // ─── TS/JS/React/Next.js ─────────────────────────────────
    if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
        // React component
        if (ext === ".tsx" || ext === ".jsx") {
            const comp = content.match(/(?:export\s+(?:default\s+)?)?(?:function|const)\s+(\w+)/);
            const parts = [];
            if (comp)
                parts.push(comp[1]);
            const renders = [];
            if (/<(?:form|Form)/i.test(content))
                renders.push("form");
            if (/<(?:table|Table|DataTable)/i.test(content))
                renders.push("table");
            if (/<(?:dialog|Dialog|Modal|Drawer)/i.test(content))
                renders.push("modal");
            if (renders.length)
                parts.push(`renders ${renders.join(", ")}`);
            if (parts.length)
                return cap(parts.join(" — "));
        }
        // Next.js conventions
        if (basename === "page.tsx" || basename === "page.js")
            return "Next.js page component";
        if (basename === "layout.tsx" || basename === "layout.js")
            return "Next.js layout";
        if (basename === "route.ts" || basename === "route.js") {
            const methods = [...new Set((content.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g) || [])
                    .map(m => m.match(/(GET|POST|PUT|PATCH|DELETE)/)?.[1]))].filter(Boolean);
            return methods.length ? `Next.js API route: ${methods.join(", ")}` : "Next.js API route";
        }
        // Express/Fastify routes
        const routeHits = content.match(/\.(get|post|put|patch|delete)\s*\(\s*['"`]/g);
        if (routeHits && routeHits.length > 0) {
            const methods = [...new Set(routeHits.map(r => r.match(/\.(get|post|put|patch|delete)/)?.[1]?.toUpperCase()))];
            return cap(`API routes: ${methods.join(", ")} (${routeHits.length} endpoints)`);
        }
        // tRPC router
        if (content.includes("createTRPCRouter") || content.includes("publicProcedure")) {
            const procs = (content.match(/\.(query|mutation|subscription)\s*\(/g) || []).length;
            return procs ? `tRPC router: ${procs} procedures` : "tRPC router";
        }
        // Zod schemas
        if (content.includes("z.object") || content.includes("z.string")) {
            const schemas = (content.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*z\./g) || [])
                .map(s => s.match(/(?:const|let)\s+(\w+)/)?.[1]).filter(Boolean);
            if (schemas.length)
                return cap(`Zod schemas: ${schemas.slice(0, 4).join(", ")}${schemas.length > 4 ? ` + ${schemas.length - 4} more` : ""}`);
        }
        // Exports summary
        const exports = (content.match(/export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g) || [])
            .map(e => e.match(/(\w+)$/)?.[1]).filter(Boolean);
        if (exports.length > 0 && exports.length <= 5)
            return `Exports ${exports.join(", ")}`;
        if (exports.length > 5)
            return cap(`Exports ${exports.slice(0, 4).join(", ")} + ${exports.length - 4} more`);
    }
    // ─── Python / Django / FastAPI / Flask ────────────────────
    if (ext === ".py") {
        // Django model
        if (content.includes("models.Model")) {
            const cls = content.match(/class\s+(\w+)\(.*models\.Model\)/);
            const fields = (content.match(/^\s+\w+\s*=\s*models\.\w+/gm) || []).length;
            return cap(`Model: ${cls?.[1] || "unknown"}, ${fields} fields`);
        }
        // FastAPI/Flask routes
        if (content.includes("@router.") || content.includes("@app.")) {
            const routes = (content.match(/@(?:router|app)\.(get|post|put|patch|delete)\s*\(/g) || []);
            return cap(routes.length ? `API: ${routes.length} endpoints` : "API router");
        }
        // Pydantic
        if (content.includes("BaseModel") && content.includes("Field(")) {
            const cls = content.match(/class\s+(\w+)\(.*BaseModel\)/);
            return cls ? `Pydantic: ${cls[1]}` : "Pydantic model";
        }
        // Celery
        if (content.includes("@shared_task") || content.includes("@app.task")) {
            const tasks = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_"));
            return cap(tasks.length ? `Celery tasks: ${tasks.join(", ")}` : "Celery task");
        }
        // Generic
        const pyClass = content.match(/class\s+(\w+)/);
        const funcs = (content.match(/def\s+(\w+)/g) || []).map(f => f.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_"));
        if (pyClass && funcs.length > 0)
            return cap(funcs.length > 4 ? `${pyClass[1]}: ${funcs.slice(0, 4).join(", ")} + ${funcs.length - 4} more` : `${pyClass[1]}: ${funcs.join(", ")}`);
        if (funcs.length > 0)
            return cap(funcs.slice(0, 4).join(", "));
    }
    // ─── Go ──────────────────────────────────────────────────
    if (ext === ".go") {
        const handlers = (content.match(/func\s+(\w+)\s*\(\s*\w+\s+http\.ResponseWriter/g) || [])
            .map(m => m.match(/func\s+(\w+)/)?.[1]).filter(Boolean);
        if (handlers.length)
            return cap(`HTTP handlers: ${handlers.slice(0, 5).join(", ")}`);
        const iface = content.match(/type\s+(\w+)\s+interface\s*\{/);
        if (iface)
            return `Interface: ${iface[1]}`;
        const structM = content.match(/type\s+(\w+)\s+struct\s*\{/);
        if (structM)
            return `Struct: ${structM[1]}`;
        const funcs = (content.match(/^func\s+(\w+)/gm) || []).map(m => m.match(/func\s+(\w+)/)?.[1]).filter(n => n && n[0] === n[0].toUpperCase());
        if (funcs.length)
            return cap(funcs.slice(0, 5).join(", "));
    }
    // ─── Rust ────────────────────────────────────────────────
    if (ext === ".rs") {
        const structM = content.match(/pub\s+struct\s+(\w+)/);
        if (structM) {
            const methods = (content.match(/pub\s+(?:async\s+)?fn\s+(\w+)/g) || []).map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
            return cap(methods.length ? `${structM[1]}: ${methods.slice(0, 4).join(", ")}` : `Struct: ${structM[1]}`);
        }
        const traitM = content.match(/pub\s+trait\s+(\w+)/);
        if (traitM)
            return `Trait: ${traitM[1]}`;
        const enumM = content.match(/pub\s+enum\s+(\w+)/);
        if (enumM)
            return `Enum: ${enumM[1]}`;
        const fns = (content.match(/pub\s+(?:async\s+)?fn\s+(\w+)/g) || []).map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
        if (fns.length)
            return cap(fns.slice(0, 5).join(", "));
    }
    // ─── Java / Spring ───────────────────────────────────────
    if (ext === ".java") {
        const cls = content.match(/(?:public\s+)?class\s+(\w+)/);
        const className = cls?.[1] || basename.replace(".java", "");
        const annotations = (content.match(/@(RestController|Controller|Service|Repository|Component|Entity|Configuration)/g) || []).map(a => a.slice(1));
        const mappings = (content.match(/@(?:Get|Post|Put|Patch|Delete|Request)Mapping/g) || []).length;
        if (mappings)
            return cap(`${annotations[0] || "Spring"}: ${className} (${mappings} endpoints)`);
        if (annotations.length)
            return `${annotations[0]}: ${className}`;
        if (content.includes("@Entity"))
            return `Entity: ${className}`;
        const methods = (content.match(/public\s+(?:static\s+)?(?:\w+(?:<[\w,\s]+>)?)\s+(\w+)\s*\(/g) || [])
            .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(n => n && n !== className);
        if (methods.length)
            return cap(`${className}: ${methods.slice(0, 4).join(", ")}`);
        return className ? `Class: ${className}` : "";
    }
    // ─── Kotlin ──────────────────────────────────────────────
    if (ext === ".kt" || ext === ".kts") {
        const cls = content.match(/(?:data\s+)?class\s+(\w+)/);
        if (content.match(/data\s+class/))
            return `Data class: ${cls?.[1] || basename.replace(/\.kts?$/, "")}`;
        if (content.includes("routing {"))
            return "Ktor routing";
        const fns = (content.match(/fun\s+(\w+)/g) || []).map(m => m.match(/fun\s+(\w+)/)?.[1]).filter(Boolean);
        if (cls && fns.length)
            return cap(`${cls[1]}: ${fns.slice(0, 4).join(", ")}`);
        if (fns.length)
            return cap(fns.slice(0, 5).join(", "));
    }
    // ─── C# / .NET ───────────────────────────────────────────
    if (ext === ".cs") {
        const cls = content.match(/(?:public\s+)?(?:partial\s+)?class\s+(\w+)(?:\s*:\s*(\w+))?/);
        const className = cls?.[1] || basename.replace(".cs", "");
        const parent = cls?.[2] || "";
        if (parent === "Controller" || parent === "ControllerBase" || content.includes("[ApiController]")) {
            const actions = (content.match(/\[Http(Get|Post|Put|Patch|Delete)\]/g) || []).map(a => a.match(/Http(\w+)/)?.[1]).filter(Boolean);
            return cap(actions.length ? `API Controller: ${className} (${[...new Set(actions)].join(", ")})` : `Controller: ${className}`);
        }
        if (parent === "DbContext" || content.includes("DbSet<")) {
            const sets = (content.match(/DbSet<(\w+)>/g) || []).map(s => s.match(/<(\w+)>/)?.[1]).filter(Boolean);
            return cap(sets.length ? `DbContext: ${sets.join(", ")}` : `DbContext: ${className}`);
        }
        return className ? `Class: ${className}` : "";
    }
    // ─── Ruby / Rails ────────────────────────────────────────
    if (ext === ".rb") {
        const cls = content.match(/class\s+(\w+)(?:\s*<\s*(\w+(?:::\w+)?))?/);
        const className = cls?.[1] || "";
        const parent = cls?.[2] || "";
        if (parent?.includes("Controller")) {
            const actions = (content.match(/def\s+(index|show|new|create|edit|update|destroy|\w+)/g) || [])
                .map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_"));
            return cap(actions.length ? `Controller: ${actions.join(", ")}` : `Controller: ${className}`);
        }
        if (parent === "ApplicationRecord" || parent === "ActiveRecord::Base")
            return `Model: ${className}`;
        if (basename.match(/^\d{14}_/)) {
            const create = content.match(/create_table\s+:(\w+)/);
            return create ? `Migration: create ${create[1]}` : "Database migration";
        }
        const methods = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(n => n && !n.startsWith("_"));
        if (cls && methods.length)
            return cap(`${className}: ${methods.slice(0, 4).join(", ")}`);
    }
    // ─── Swift ───────────────────────────────────────────────
    if (ext === ".swift") {
        if (content.includes(": View") || content.includes("some View")) {
            const name = content.match(/struct\s+(\w+)\s*:\s*View/);
            return name ? `SwiftUI view: ${name[1]}` : "SwiftUI view";
        }
        const proto = content.match(/protocol\s+(\w+)/);
        if (proto)
            return `Protocol: ${proto[1]}`;
        const struct = content.match(/(?:public\s+)?struct\s+(\w+)/);
        const cls = content.match(/(?:public\s+)?class\s+(\w+)/);
        const name = struct?.[1] || cls?.[1] || "";
        if (name)
            return `${struct ? "Struct" : "Class"}: ${name}`;
    }
    // ─── Dart / Flutter ──────────────────────────────────────
    if (ext === ".dart") {
        if (content.includes("StatefulWidget") || content.includes("StatelessWidget")) {
            const name = content.match(/class\s+(\w+)\s+extends\s+(?:Stateful|Stateless)Widget/);
            return name ? `${content.includes("StatefulWidget") ? "Stateful" : "Stateless"} widget: ${name[1]}` : "Flutter widget";
        }
        const cls = content.match(/class\s+(\w+)/);
        if (cls)
            return `Class: ${cls[1]}`;
    }
    // ─── Vue / Svelte / Astro ────────────────────────────────
    if (ext === ".vue") {
        const name = content.match(/name:\s*['"]([^'"]+)['"]/);
        const setup = content.includes("<script setup");
        const parts = [];
        if (name)
            parts.push(name[1]);
        if (setup)
            parts.push("setup");
        return cap(parts.length ? `Vue: ${parts.join(", ")}` : "Vue component");
    }
    if (ext === ".svelte")
        return `Svelte: ${basename.replace(".svelte", "")}`;
    if (ext === ".astro")
        return `Astro: ${basename.replace(".astro", "")}`;
    // ─── CSS / SCSS / Less ───────────────────────────────────
    if (ext === ".css" || ext === ".scss" || ext === ".less") {
        const rules = (content.match(/^[.#@][^\n{]+/gm) || []).length;
        const vars = (content.match(/--[\w-]+\s*:/g) || []).length;
        const parts = [];
        if (rules)
            parts.push(`${rules} rules`);
        if (vars)
            parts.push(`${vars} vars`);
        return cap(parts.length ? `Styles: ${parts.join(", ")}` : "Stylesheet");
    }
    // ─── SQL ─────────────────────────────────────────────────
    if (ext === ".sql") {
        const creates = (content.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)/gi) || [])
            .map(m => m.match(/(?:TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)([`"']?\w+)/i)?.[1]?.replace(/[`"']/g, "")).filter(Boolean);
        if (creates.length)
            return cap(`SQL: tables: ${creates.slice(0, 4).join(", ")}`);
    }
    // ─── Proto / GraphQL ─────────────────────────────────────
    if (ext === ".proto") {
        const msgs = (content.match(/message\s+(\w+)/g) || []).map(m => m.match(/message\s+(\w+)/)?.[1]).filter(Boolean);
        const services = (content.match(/service\s+(\w+)/g) || []).map(m => m.match(/service\s+(\w+)/)?.[1]).filter(Boolean);
        const parts = [];
        if (msgs.length)
            parts.push(`messages: ${msgs.slice(0, 3).join(", ")}`);
        if (services.length)
            parts.push(`services: ${services.join(", ")}`);
        return cap(parts.length ? `Proto: ${parts.join(", ")}` : "");
    }
    if (ext === ".graphql" || ext === ".gql") {
        const types = (content.match(/type\s+(\w+)/g) || []).map(m => m.match(/type\s+(\w+)/)?.[1]).filter(Boolean);
        return cap(types.length ? `GraphQL: types: ${types.slice(0, 4).join(", ")}` : "GraphQL schema");
    }
    // ─── YAML ────────────────────────────────────────────────
    if (ext === ".yaml" || ext === ".yml") {
        if (content.includes("runs-on:")) {
            const name = content.match(/^name:\s*(.+)$/m);
            return cap(name ? `CI: ${name[1].trim()}` : "GitHub Actions workflow");
        }
        if (content.includes("apiVersion:") && content.includes("kind:")) {
            const kind = content.match(/kind:\s*(\w+)/);
            return cap(kind ? `K8s ${kind[1]}` : "Kubernetes manifest");
        }
        if (content.includes("services:") && (basename.includes("docker") || basename.includes("compose"))) {
            const services = (content.match(/^\s{2}\w+:/gm) || []).length;
            return `Docker Compose: ${services} services`;
        }
    }
    // ─── TOML ────────────────────────────────────────────────
    if (ext === ".toml") {
        const desc = content.match(/^description\s*=\s*"([^"]+)"/m);
        if (desc)
            return cap(desc[1]);
    }
    // ─── Elixir ──────────────────────────────────────────────
    if (ext === ".ex" || ext === ".exs") {
        const mod = content.match(/defmodule\s+([\w.]+)/);
        if (content.includes("Phoenix.LiveView"))
            return cap(mod ? `LiveView: ${mod[1]}` : "Phoenix LiveView");
        if (content.includes("Controller"))
            return cap(mod ? `Phoenix controller: ${mod[1]}` : "Phoenix controller");
        const fns = (content.match(/def\s+(\w+)/g) || []).map(m => m.match(/def\s+(\w+)/)?.[1]).filter(Boolean);
        if (mod && fns.length)
            return cap(`${mod[1]}: ${fns.slice(0, 4).join(", ")}`);
        if (mod)
            return mod[1];
    }
    // ─── Lua ─────────────────────────────────────────────────
    if (ext === ".lua") {
        const fns = (content.match(/function\s+(?:\w+[.:])?(\w+)/g) || []).map(m => m.match(/(\w+)\s*$/)?.[1]).filter(Boolean);
        if (fns.length)
            return cap(fns.slice(0, 5).join(", "));
    }
    // ─── Zig ─────────────────────────────────────────────────
    if (ext === ".zig") {
        const fns = (content.match(/pub\s+fn\s+(\w+)/g) || []).map(m => m.match(/fn\s+(\w+)/)?.[1]).filter(Boolean);
        if (fns.length)
            return cap(fns.slice(0, 5).join(", "));
    }
    // Last resort
    const declM = content.match(/(?:function|class|const|interface|type|enum)\s+(\w+)/);
    if (declM) {
        const name = declM[1];
        const methods = (content.match(/(?:public\s+)?(?:async\s+)?(?:function\s+|(?:get|set)\s+)(\w+)\s*\(/g) || [])
            .map(m => m.match(/(\w+)\s*\(/)?.[1]).filter(n => n && n !== name && n !== "__construct" && n !== "constructor");
        if (methods.length > 0 && methods.length <= 5)
            return cap(`${name}: ${methods.join(", ")}`);
        if (methods.length > 5)
            return cap(`${name}: ${methods.slice(0, 3).join(", ")} + ${methods.length - 3} more`);
        return `Declares ${name}`;
    }
    return "";
}
export function estimateTokens(text, type = "mixed") {
    const ratio = type === "code" ? 3.5 : type === "prose" ? 4.0 : 3.75;
    return Math.ceil(text.length / ratio);
}
export function timestamp() {
    return new Date().toISOString();
}
export function timeShort() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
export function readStdin() {
    return new Promise((resolve) => {
        const chunks = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        // If no stdin data after 4s, resolve with whatever we have so far.
        // On Windows, stdin delivery from Claude Code hooks can be slow.
        setTimeout(() => resolve(chunks.length ? Buffer.concat(chunks).toString("utf-8") : "{}"), 4000);
    });
}
export function normalizePath(p) {
    return p.replace(/\\/g, "/");
}
const SIZE_DISCIPLINE_DEFAULTS = {
    enabled: true,
    buglog: { retention_days: 30 },
    reviewlog: { retention_days: 30 },
    memory: { retention_days: 30 },
    token_ledger: { max_inline_sessions: 60 },
    cerebrum: { retention_days: 180 },
    daemon_log: { max_bytes: 5_242_880, keep: 3 },
};
/**
 * Globs that exclude scratch/test/driver files from *every* nudge scope by
 * default. Reused by REVIEW_HOOK_DEFAULTS, QUALITY_GATE_DEFAULTS, and the
 * buglog-scan scope inside checkForMissingBugLogs.
 *
 * Reasoning: editing a one-off falsifier under /tmp/ doesn't carry the same
 * obligations as touching production source. Nudging on those was the bulk
 * of the false-positive noise the user pushed back on.
 */
const SCRATCH_PATH_EXCLUDES = [
    "/tmp/**",
    "**/tmp/**",
    // Windows scratch: the Claude Code session scratchpad lives under
    // %LOCALAPPDATA%\Temp\claude\...\scratchpad\ — directory "Temp" (capital,
    // and the word "Temp" != "tmp"), which the Unix-only patterns above never
    // matched (globToRegex is anchored + case-sensitive). Without these, every
    // throwaway scratch file on Windows counted as reviewable production work
    // and re-fired the review nudge indefinitely. Found and proven by a QA
    // reduction in the computertuning project; see
    // .wolf/qa/scratch-path-excludes-windows.md.
    "**/scratchpad/**",
    "**/AppData/Local/Temp/**",
    "**/*-falsify.js",
    "**/*-falsify.mjs",
    "**/*-falsify.ts",
    "**/*.test.js",
    "**/*.test.mjs",
    "**/*.test.ts",
    "**/*.spec.js",
    "**/*.spec.mjs",
    "**/*.spec.ts",
    "**/__tests__/**",
];
/**
 * OpenWolf-internal documentation/audit-record files that should NEVER count
 * toward the review nudge, quality gate, or buglog-missing scan. These are
 * the gate's OWN output, not new source-code work — letting them trigger the
 * gate is a meta-recursion: a nudge fires on the doc that exists *because of*
 * the prior nudge, indefinitely.
 *
 * Triggered by independent cross-session feedback from three sibling Claude
 * sessions (2026-06-08), all of which reported the same noise class: QA
 * reduction prose, memory.md append churn, reviewlog.json entry growth, and
 * buglog.json log entries each counted as "code changed" and re-fired the
 * gates after the gate's own action wrote those files. See
 * .wolf/qa/exclude-wolf-docs-from-gates.md for the falsifier and rationale.
 *
 * Why these are safe to exclude:
 * - .wolf/qa/**.md — adversarial-reduction documents are evidence OF review
 *   already happening, not new code that needs review.
 * - .wolf/memory.md, .wolf/anatomy.md, .wolf/cerebrum.md — agent-maintained
 *   prose; editing them is correct hygiene, not a code change.
 * - .wolf/reviewlog.json, .wolf/buglog.json — the gate's OWN ledgers; nudging
 *   on their growth is the exact self-reference bug-class the bug-111/112
 *   series fixed for individual gates.
 *
 * If a user genuinely needs to review one of these (e.g. they hand-edit
 * cerebrum to encode something load-bearing), they can override via
 * `openwolf.review_hook.scope_excludes` in .wolf/config.json — these defaults
 * just stop the gate from firing on its OWN paperwork.
 */
const WOLF_DOC_EXCLUDES = [
    // QA reductions — narrowed to *.md to preserve gate coverage if a user
    // ever drops a real source/driver file under .wolf/qa/. The original
    // **/.wolf/qa/** would silently silence such files; restricting to *.md
    // keeps the documented "reduction documents" intent honest (review-0033
    // panel finding H2, both Codex and Claude agreed).
    "**/.wolf/qa/**/*.md",
    "**/.wolf/memory.md",
    "**/.wolf/anatomy.md",
    "**/.wolf/cerebrum.md",
    "**/.wolf/reviewlog.json",
    "**/.wolf/buglog.json",
    "**/.wolf/_session.json",
    "**/.wolf/archive/**",
];
const DEFAULT_GATE_EXCLUDES = [
    ...SCRATCH_PATH_EXCLUDES,
    ...WOLF_DOC_EXCLUDES,
];
/**
 * Merge user-supplied scope_excludes with WOLF_DOC_EXCLUDES.
 *
 * **Why this is not a plain `??` replace:** the WOLF_DOC_EXCLUDES list is
 * load-bearing — it prevents the agent's self-reference meta-recursion
 * (review nudge fires on the QA doc that exists *because of* the prior
 * review nudge, indefinitely). A user who supplies their own
 * `openwolf.review_hook.scope_excludes` in `.wolf/config.json` almost
 * certainly wants to ADD scratch paths to silence, not to silently
 * un-silence the gate's own paperwork. Plain `??` would replace, and the
 * meta-recursion would return. Both Codex and Claude flagged this in
 * review-0033 (C-1, highest severity).
 *
 * Semantics:
 * - If user did not configure scope_excludes → return the full default
 *   (SCRATCH + WOLF_DOC).
 * - If user did configure scope_excludes → use their list AS-IS, then
 *   re-union WOLF_DOC_EXCLUDES so the self-reference protection survives.
 *   Dedup by string identity so a user who happens to repeat one of our
 *   patterns doesn't get a duplicate.
 *
 * Escape hatch: a user who genuinely wants to override the wolf-doc
 * exclusion can set `openwolf.review_hook.allow_wolf_doc_review: true` in
 * their config (handled at the call site below). 99% of users want the
 * default; the escape hatch exists for the 1% who deliberately code under
 * `.wolf/qa/`.
 */
function mergeWithWolfDocExcludes(userExcludes, allowWolfDocReview, defaultBase) {
    if (allowWolfDocReview === true) {
        // Escape hatch: user explicitly opted out of the self-reference
        // protection. Subtract WOLF_DOC_EXCLUDES from the fallback so the flag
        // has the documented effect even when the user supplies no excludes of
        // their own. Without this subtraction, `defaultBase` (which IS
        // DEFAULT_GATE_EXCLUDES = SCRATCH + WOLF_DOC) would silently re-include
        // the wolf-doc patterns and the flag would be a no-op for the common
        // "I want to review my .wolf/qa/foo.ts driver" case. Codex review-0033b
        // M1 caught this in round 2.
        const wolfDocSet = new Set(WOLF_DOC_EXCLUDES);
        const base = userExcludes ?? defaultBase;
        return base.filter(p => !wolfDocSet.has(p));
    }
    if (!userExcludes)
        return defaultBase;
    // Merge: user excludes + WOLF_DOC_EXCLUDES, deduplicated.
    const seen = new Set();
    const out = [];
    for (const pat of [...userExcludes, ...WOLF_DOC_EXCLUDES]) {
        if (seen.has(pat))
            continue;
        seen.add(pat);
        out.push(pat);
    }
    return out;
}
const REVIEW_HOOK_DEFAULTS = {
    enabled: true,
    min_diff_lines: 40,
    always_review_paths: ["**/auth/**", "**/payment/**", "**/migrations/**"],
    scope_excludes: DEFAULT_GATE_EXCLUDES,
    review_companion: "provider companion",
    max_review_rounds: 5,
    nudge_only: true,
};
const VERIFY_CONCLUSIONS_DEFAULTS = {
    enabled: true,
    // Case-insensitive regex sources. Narrowed to *named-artifact* and
    // *shipping-decision* claims — phrases that assert a concrete deliverable
    // is ready, deployed, or final. Generic "verified" / "passes" / "fixed"
    // are intentionally excluded: they fire on every routine test pass and
    // every routine bug fix without indicating that the assistant is making a
    // big-picture shipping claim.
    patterns: [
        // Production / shipping verdicts
        "\\b(production-ready|ready (?:to ship|for review|to merge|to deploy))\\b",
        "\\b(shipped|deployed (?:to production|to prod)|merge(?:d)? (?:to|into) main)\\b",
        // Strong correctness verdicts referencing a named artifact
        "\\b(verdict|the (?:answer|finding|conclusion|result|edge|signal)\\s+is)\\b",
        // Statistical-claim shape (these are usually load-bearing)
        "\\b(t\\s*=\\s*-?\\d|p\\s*[<=>]\\s*0?\\.\\d|p-?value)\\b",
        // Domain-specific strong claims (trading / model survival)
        "\\b(survivor|tradeable|profitable|unprofitable|economically (?:meaningful|meaningless))\\b",
        // Catastrophic/dispositive language
        "\\b(devastating|catastrophic|dead|alive|holds up)\\b",
    ],
    min_pattern_hits: 2,
    min_text_chars: 200,
    // Cap conclusion-gate nudges per session. Three is enough for a long
    // session to surface big claims a few times without drowning out the
    // signal once the user has acknowledged the pattern.
    max_fires_per_session: 3,
    nudge_only: true,
};
const QUALITY_GATE_DEFAULTS = {
    enabled: true,
    scope: "all",
    scope_paths: [],
    scope_excludes: DEFAULT_GATE_EXCLUDES,
    buglog_scan_excludes: DEFAULT_GATE_EXCLUDES,
    min_assumptions: 3,
    require_run_output: true,
    nudge_only: true,
    retention_days: 30,
    verify_conclusions: VERIFY_CONCLUSIONS_DEFAULTS,
};
const HOOK_MESSAGE_DEFAULTS = {
    verbosity: "compact",
    reviewer_profile: "us-only",
    max_files: 3,
    include_provider_examples: false,
    include_docs_hint: true,
};
const AUTONOMY_CONTINUATION_DEFAULTS = {
    enabled: true,
    nudge_only: true,
    min_text_chars: 80,
    max_fires_per_session: 3,
    patterns: [
        "\\bnext (?:action|step)\\b",
        "\\b(?:should|would|could) (?:continue|run|test|verify|fix|update|implement)\\b",
        "\\b(?:if you want|let me know|when you(?:'re| are) ready)\\b",
        "\\b(?:waiting for|awaiting) (?:your|user)\\b",
    ],
};
const GIT_DISCIPLINE_DEFAULTS = {
    enabled: true,
    nudge_only: true,
    min_written_files: 2,
    min_changed_lines: 10,
    max_fires_per_session: 3,
    require_status_block: true,
    require_version_impact_for_user_visible: true,
    discourage_broad_staging: true,
    require_cached_diff_before_commit: true,
    warn_destructive_commands: true,
    scope_excludes: DEFAULT_GATE_EXCLUDES,
    user_visible_paths: [
        "package.json",
        "package-lock.json",
        "VERSION",
        "CHANGELOG*",
        "README*",
        "docs/**",
        "src/**",
        "bin/**",
        "cli/**",
        "lib/**",
        "packages/**",
        "apps/**",
        "templates/**",
    ],
    version_files: ["package.json", "package-lock.json", "VERSION", "CHANGELOG*"],
    material_paths: [
        "package.json",
        "package-lock.json",
        "VERSION",
        "CHANGELOG*",
        "src/**",
        "bin/**",
        "cli/**",
        "templates/**",
        "docs/**",
    ],
    doc_extensions: [".md", ".mdx", ".txt", ".adoc", ".rst"],
    destructive_patterns: [
        "\\bgit\\s+reset\\s+--hard\\b",
        "\\bgit\\s+clean\\s+-[^\\n;|&]*[fd]",
        "\\bgit\\s+push\\b[^\\n;|&]*(?:--force|-f)\\b",
        "\\bgit\\s+(?:checkout|restore)\\s+(?:--\\s+)?(?:\\.|:[/\\w.-]*)(?=\\s|$|;|&|\\|)",
    ],
    commit_patterns: [
        "\\bgit\\s+commit\\b",
    ],
    status_markers: [
        "git/version status",
        "git status",
        "changed files",
        "commit-ready",
        "version impact",
        "pre-existing",
        "untracked",
        "verification",
    ],
    version_markers: [
        "version impact",
        "version bump",
        "changelog",
        "change log",
        "last updated",
        "revision",
        "document version",
        "package version",
    ],
};
const SIMPLICITY_DEFAULTS = {
    enabled: true,
    nudge_only: true,
    min_output_tokens: 500,
    max_fires_per_session: 1,
};
const CLAIM_CALIBRATION_DEFAULTS = {
    enabled: true,
    nudge_only: true,
    min_text_chars: 180,
    min_signal_hits: 2,
    max_fires_per_session: 3,
    retention_days: 30,
    log_decisions: true,
    require_missing_markers: true,
    categories: {
        strong_claims: true,
        causal_claims: true,
        generalizations: true,
        debugging_conclusions: true,
        methodology_claims: true,
        confidence_claims: true,
    },
    discipline_markers: {
        observed: true,
        inferred: true,
        limits: true,
        falsifiers: true,
    },
};
function finiteNumber(value, fallback, { min = 0, max = 10000 } = {}) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return fallback;
    return Math.min(Math.max(Math.floor(value), min), max);
}
/**
 * Load OpenWolf config from .wolf/config.json, returning defaults for any
 * missing keys. Never throws — silently returns defaults on read/parse errors.
 *
 * Guards against valid-JSON-but-not-an-object (e.g. file contains `null`,
 * an array, or a primitive), which would otherwise propagate as type errors
 * to the getters below.
 */
export function loadConfig() {
    const wolfDir = getWolfDir();
    const configPath = path.join(wolfDir, "config.json");
    const raw = readJSON(configPath, null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { version: 1, openwolf: {} };
    }
    return raw;
}
export function getSizeDisciplineConfig() {
    const root = loadConfig();
    const cfg = (root && typeof root === "object" ? root.openwolf?.size_discipline : undefined) ?? {};
    return {
        enabled: cfg.enabled ?? SIZE_DISCIPLINE_DEFAULTS.enabled,
        buglog: { retention_days: cfg.buglog?.retention_days ?? SIZE_DISCIPLINE_DEFAULTS.buglog.retention_days },
        reviewlog: { retention_days: cfg.reviewlog?.retention_days ?? SIZE_DISCIPLINE_DEFAULTS.reviewlog.retention_days },
        memory: { retention_days: cfg.memory?.retention_days ?? SIZE_DISCIPLINE_DEFAULTS.memory.retention_days },
        token_ledger: { max_inline_sessions: cfg.token_ledger?.max_inline_sessions ?? SIZE_DISCIPLINE_DEFAULTS.token_ledger.max_inline_sessions },
        cerebrum: { retention_days: cfg.cerebrum?.retention_days ?? SIZE_DISCIPLINE_DEFAULTS.cerebrum.retention_days },
        daemon_log: {
            max_bytes: cfg.daemon_log?.max_bytes ?? SIZE_DISCIPLINE_DEFAULTS.daemon_log.max_bytes,
            keep: cfg.daemon_log?.keep ?? SIZE_DISCIPLINE_DEFAULTS.daemon_log.keep,
        },
    };
}
/**
 * Read the tail of a Claude Code transcript (JSONL) and return the most recent
 * assistant message that contains non-empty text — concatenated text content
 * plus any tool_use blocks from that entry.
 *
 * IMPORTANT: a turn that ends in a tool call writes an assistant entry whose
 * content is only `{type: "tool_use", ...}` blocks — zero text. If we returned
 * that we'd see text.length === 0 and gates scanning for conclusion language
 * would never fire. So we walk backwards past tool-only entries until we find
 * one with real text. The text-bearing entry might be 1–N entries earlier in
 * a turn that did Bash → tool_result → text → tool_use, but the most recent
 * text is what conclusion-detection needs.
 *
 * Used by the review hook and the verify-conclusions sub-gate to inspect what
 * the model just produced. Silent no-op (returns null) on any read/parse error,
 * empty transcript, or transcript with no text-bearing assistant entry in the
 * tail window.
 *
 * Reads up to `maxBytes` from the END of the file to avoid loading multi-MB
 * transcripts into memory.
 */
export function readLastAssistantText(transcriptPath, maxBytes = 256 * 1024) {
    try {
        if (!transcriptPath || !fs.existsSync(transcriptPath))
            return null;
        const stat = fs.statSync(transcriptPath);
        if (stat.size === 0)
            return null;
        const readSize = Math.min(stat.size, maxBytes);
        const startOffset = Math.max(0, stat.size - readSize);
        const fd = fs.openSync(transcriptPath, "r");
        const buf = Buffer.alloc(readSize);
        try {
            fs.readSync(fd, buf, 0, readSize, startOffset);
        }
        finally {
            fs.closeSync(fd);
        }
        let tail = buf.toString("utf-8");
        // If we sliced mid-line, drop the partial leading line.
        if (startOffset > 0) {
            const firstNewline = tail.indexOf("\n");
            if (firstNewline >= 0)
                tail = tail.slice(firstNewline + 1);
        }
        const lines = tail.split("\n");
        // Walk backwards for the most recent assistant entry that contains text.
        // Tool-use-only entries (Bash, Read, etc.) come without any {type:"text"}
        // block — returning those would give text.length === 0 and the conclusion
        // sub-gate would never see the model's actual prose. Aggregate any
        // tool_uses we pass on the way back so callers (e.g. the review hook
        // looking at file edits) still see the recent activity attached to the
        // text-bearing entry we eventually return.
        const collectedToolUses = [];
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line)
                continue;
            let entry;
            try {
                entry = JSON.parse(line);
            }
            catch {
                continue;
            }
            if (entry.type !== "assistant")
                continue;
            // Claude Code transcripts nest content under message.content as an array
            // of {type: "text", text} and {type: "tool_use", name, input} blocks.
            const message = entry.message;
            const content = Array.isArray(message?.content) ? message.content : [];
            const textParts = [];
            const entryToolUses = [];
            for (const block of content) {
                if (block?.type === "text" && typeof block.text === "string") {
                    textParts.push(block.text);
                }
                else if (block?.type === "tool_use" && typeof block.name === "string") {
                    entryToolUses.push({
                        name: block.name,
                        input: block.input ?? {},
                    });
                }
            }
            // No text in this entry → it's a tool-use-only turn-tail. Remember its
            // tool_uses and keep walking back.
            if (textParts.length === 0 || textParts.every((t) => t.trim().length === 0)) {
                // Prepend so the final list reads chronologically (older→newer) after
                // we eventually return.
                collectedToolUses.unshift(...entryToolUses);
                continue;
            }
            // Found the most recent text-bearing assistant entry.
            collectedToolUses.unshift(...entryToolUses);
            return {
                text: textParts.join("\n"),
                toolUses: collectedToolUses,
                timestamp: typeof entry.timestamp === "string" ? entry.timestamp : "",
            };
        }
        return null;
    }
    catch {
        return null;
    }
}
export function getHookMessageConfig() {
    const root = loadConfig();
    const cfg = (root && typeof root === "object" ? root.openwolf?.hook_messages : undefined) ?? {};
    const verbosity = ["compact", "standard", "verbose"].includes(cfg.verbosity) ? cfg.verbosity : HOOK_MESSAGE_DEFAULTS.verbosity;
    const reviewer_profile = ["us-only", "open", "budget"].includes(cfg.reviewer_profile) ? cfg.reviewer_profile : HOOK_MESSAGE_DEFAULTS.reviewer_profile;
    return {
        verbosity,
        reviewer_profile,
        max_files: finiteNumber(cfg.max_files, HOOK_MESSAGE_DEFAULTS.max_files, { min: 1, max: 20 }),
        include_provider_examples: cfg.include_provider_examples ?? HOOK_MESSAGE_DEFAULTS.include_provider_examples,
        include_docs_hint: cfg.include_docs_hint ?? HOOK_MESSAGE_DEFAULTS.include_docs_hint,
    };
}
export function getReviewHookConfig() {
    const root = loadConfig();
    const cfg = (root && typeof root === "object" ? root.openwolf?.review_hook : undefined) ?? {};
    return {
        enabled: cfg.enabled ?? REVIEW_HOOK_DEFAULTS.enabled,
        min_diff_lines: cfg.min_diff_lines ?? REVIEW_HOOK_DEFAULTS.min_diff_lines,
        always_review_paths: cfg.always_review_paths ?? REVIEW_HOOK_DEFAULTS.always_review_paths,
        scope_excludes: mergeWithWolfDocExcludes(cfg.scope_excludes, cfg.allow_wolf_doc_review, REVIEW_HOOK_DEFAULTS.scope_excludes),
        allow_wolf_doc_review: cfg.allow_wolf_doc_review,
        coalesce_lookback: cfg.coalesce_lookback,
        review_companion: typeof cfg.review_companion === "string" && cfg.review_companion.trim().length > 0
            ? cfg.review_companion.trim()
            : REVIEW_HOOK_DEFAULTS.review_companion,
        max_review_rounds: cfg.max_review_rounds ?? REVIEW_HOOK_DEFAULTS.max_review_rounds,
        nudge_only: cfg.nudge_only ?? REVIEW_HOOK_DEFAULTS.nudge_only,
        nudge_cap: cfg.nudge_cap,
    };
}
export function getAutonomyContinuationConfig() {
    const root = loadConfig();
    const cfg = (root && typeof root === "object" ? root.openwolf?.autonomy_continuation : undefined) ?? {};
    return {
        enabled: cfg.enabled ?? AUTONOMY_CONTINUATION_DEFAULTS.enabled,
        nudge_only: cfg.nudge_only ?? AUTONOMY_CONTINUATION_DEFAULTS.nudge_only,
        min_text_chars: finiteNumber(cfg.min_text_chars, AUTONOMY_CONTINUATION_DEFAULTS.min_text_chars, { min: 0, max: 10000 }),
        max_fires_per_session: finiteNumber(cfg.max_fires_per_session, AUTONOMY_CONTINUATION_DEFAULTS.max_fires_per_session, { min: 0, max: 100 }),
        patterns: Array.isArray(cfg.patterns) ? cfg.patterns : AUTONOMY_CONTINUATION_DEFAULTS.patterns,
    };
}
export function getGitDisciplineConfig() {
    const root = loadConfig();
    const cfg = (root && typeof root === "object" ? root.openwolf?.git_discipline : undefined) ?? {};
    return {
        enabled: cfg.enabled ?? GIT_DISCIPLINE_DEFAULTS.enabled,
        nudge_only: cfg.nudge_only ?? GIT_DISCIPLINE_DEFAULTS.nudge_only,
        min_written_files: finiteNumber(cfg.min_written_files, GIT_DISCIPLINE_DEFAULTS.min_written_files, { min: 1, max: 100 }),
        min_changed_lines: finiteNumber(cfg.min_changed_lines, GIT_DISCIPLINE_DEFAULTS.min_changed_lines, { min: 0, max: 10000 }),
        max_fires_per_session: finiteNumber(cfg.max_fires_per_session, GIT_DISCIPLINE_DEFAULTS.max_fires_per_session, { min: 0, max: 100 }),
        require_status_block: cfg.require_status_block ?? GIT_DISCIPLINE_DEFAULTS.require_status_block,
        require_version_impact_for_user_visible: cfg.require_version_impact_for_user_visible ?? GIT_DISCIPLINE_DEFAULTS.require_version_impact_for_user_visible,
        discourage_broad_staging: cfg.discourage_broad_staging ?? GIT_DISCIPLINE_DEFAULTS.discourage_broad_staging,
        require_cached_diff_before_commit: cfg.require_cached_diff_before_commit ?? GIT_DISCIPLINE_DEFAULTS.require_cached_diff_before_commit,
        warn_destructive_commands: cfg.warn_destructive_commands ?? GIT_DISCIPLINE_DEFAULTS.warn_destructive_commands,
        scope_excludes: mergeWithWolfDocExcludes(cfg.scope_excludes, cfg.allow_wolf_doc_review, GIT_DISCIPLINE_DEFAULTS.scope_excludes),
        allow_wolf_doc_review: cfg.allow_wolf_doc_review,
        user_visible_paths: Array.isArray(cfg.user_visible_paths) ? cfg.user_visible_paths : GIT_DISCIPLINE_DEFAULTS.user_visible_paths,
        version_files: Array.isArray(cfg.version_files) ? cfg.version_files : GIT_DISCIPLINE_DEFAULTS.version_files,
        material_paths: Array.isArray(cfg.material_paths) ? cfg.material_paths : GIT_DISCIPLINE_DEFAULTS.material_paths,
        doc_extensions: Array.isArray(cfg.doc_extensions) ? cfg.doc_extensions : GIT_DISCIPLINE_DEFAULTS.doc_extensions,
        destructive_patterns: Array.isArray(cfg.destructive_patterns) ? cfg.destructive_patterns : GIT_DISCIPLINE_DEFAULTS.destructive_patterns,
        commit_patterns: Array.isArray(cfg.commit_patterns) ? cfg.commit_patterns : GIT_DISCIPLINE_DEFAULTS.commit_patterns,
        status_markers: Array.isArray(cfg.status_markers) ? cfg.status_markers : GIT_DISCIPLINE_DEFAULTS.status_markers,
        version_markers: Array.isArray(cfg.version_markers) ? cfg.version_markers : GIT_DISCIPLINE_DEFAULTS.version_markers,
    };
}
export function getSimplicityConfig() {
    const root = loadConfig();
    const cfg = (root && typeof root === "object" ? root.openwolf?.simplicity : undefined) ?? {};
    return {
        enabled: cfg.enabled ?? SIMPLICITY_DEFAULTS.enabled,
        nudge_only: cfg.nudge_only ?? SIMPLICITY_DEFAULTS.nudge_only,
        min_output_tokens: finiteNumber(cfg.min_output_tokens, SIMPLICITY_DEFAULTS.min_output_tokens, { min: 0, max: 100000 }),
        max_fires_per_session: finiteNumber(cfg.max_fires_per_session, SIMPLICITY_DEFAULTS.max_fires_per_session, { min: 0, max: 100 }),
    };
}
export function getClaimCalibrationConfig() {
    const root = loadConfig();
    const legacy = (root && typeof root === "object" ? root.openwolf?.scientific_mode : undefined) ?? {};
    const modern = (root && typeof root === "object" ? root.openwolf?.claim_calibration : undefined) ?? {};
    const cfg = { ...legacy, ...modern };
    const legacyCategories = legacy.categories && typeof legacy.categories === "object" ? legacy.categories : {};
    const modernCategories = modern.categories && typeof modern.categories === "object" ? modern.categories : {};
    const categories = {
        ...CLAIM_CALIBRATION_DEFAULTS.categories,
        ...legacyCategories,
        ...(legacyCategories.bold_claims === undefined ? {} : { strong_claims: legacyCategories.bold_claims }),
        ...modernCategories,
    };
    delete categories.bold_claims;
    const legacyMarkers = legacy.discipline_markers && typeof legacy.discipline_markers === "object" ? legacy.discipline_markers : {};
    const modernMarkers = modern.discipline_markers && typeof modern.discipline_markers === "object" ? modern.discipline_markers : {};
    return {
        enabled: cfg.enabled ?? CLAIM_CALIBRATION_DEFAULTS.enabled,
        nudge_only: cfg.nudge_only ?? CLAIM_CALIBRATION_DEFAULTS.nudge_only,
        min_text_chars: finiteNumber(cfg.min_text_chars, CLAIM_CALIBRATION_DEFAULTS.min_text_chars, { min: 0, max: 10000 }),
        min_signal_hits: finiteNumber(cfg.min_signal_hits, CLAIM_CALIBRATION_DEFAULTS.min_signal_hits, { min: 1, max: 10 }),
        max_fires_per_session: finiteNumber(cfg.max_fires_per_session, CLAIM_CALIBRATION_DEFAULTS.max_fires_per_session, { min: 0, max: 100 }),
        retention_days: finiteNumber(cfg.retention_days, CLAIM_CALIBRATION_DEFAULTS.retention_days, { min: 1, max: 3650 }),
        log_decisions: cfg.log_decisions ?? CLAIM_CALIBRATION_DEFAULTS.log_decisions,
        require_missing_markers: cfg.require_missing_markers ?? CLAIM_CALIBRATION_DEFAULTS.require_missing_markers,
        categories,
        discipline_markers: {
            ...CLAIM_CALIBRATION_DEFAULTS.discipline_markers,
            ...legacyMarkers,
            ...modernMarkers,
        },
    };
}
export function getScientificModeConfig() {
    return getClaimCalibrationConfig();
}
export function getQualityGateConfig() {
    const root = loadConfig();
    const cfg = (root && typeof root === "object" ? root.openwolf?.quality_gate : undefined) ?? {};
    // User config may supply any subset of VerifyConclusionsConfig; treat as
    // Partial regardless of what TypeScript infers from the Partial<QualityGateConfig>
    // wrapper above.
    const vcUserCfg = cfg.verify_conclusions ?? {};
    return {
        enabled: cfg.enabled ?? QUALITY_GATE_DEFAULTS.enabled,
        scope: cfg.scope ?? QUALITY_GATE_DEFAULTS.scope,
        scope_paths: cfg.scope_paths ?? QUALITY_GATE_DEFAULTS.scope_paths,
        scope_excludes: mergeWithWolfDocExcludes(cfg.scope_excludes, cfg.allow_wolf_doc_review, QUALITY_GATE_DEFAULTS.scope_excludes),
        buglog_scan_excludes: mergeWithWolfDocExcludes(cfg.buglog_scan_excludes, cfg.allow_wolf_doc_review, QUALITY_GATE_DEFAULTS.buglog_scan_excludes),
        allow_wolf_doc_review: cfg.allow_wolf_doc_review,
        min_assumptions: cfg.min_assumptions ?? QUALITY_GATE_DEFAULTS.min_assumptions,
        require_run_output: cfg.require_run_output ?? QUALITY_GATE_DEFAULTS.require_run_output,
        nudge_only: cfg.nudge_only ?? QUALITY_GATE_DEFAULTS.nudge_only,
        nudge_cap: cfg.nudge_cap,
        retention_days: cfg.retention_days ?? QUALITY_GATE_DEFAULTS.retention_days,
        verify_conclusions: {
            enabled: vcUserCfg.enabled ?? VERIFY_CONCLUSIONS_DEFAULTS.enabled,
            patterns: vcUserCfg.patterns ?? VERIFY_CONCLUSIONS_DEFAULTS.patterns,
            min_pattern_hits: vcUserCfg.min_pattern_hits ?? VERIFY_CONCLUSIONS_DEFAULTS.min_pattern_hits,
            min_text_chars: vcUserCfg.min_text_chars ?? VERIFY_CONCLUSIONS_DEFAULTS.min_text_chars,
            max_fires_per_session: vcUserCfg.max_fires_per_session ?? VERIFY_CONCLUSIONS_DEFAULTS.max_fires_per_session,
            nudge_only: vcUserCfg.nudge_only ?? VERIFY_CONCLUSIONS_DEFAULTS.nudge_only,
        },
    };
}
/**
 * Normalize a file path for review-log content identity. Resolves to absolute
 * and replaces backslashes with forward slashes so Windows-style paths compare
 * consistently with Unix-style paths. No filesystem access beyond path.resolve.
 */
export function normalizeFilePath(p) {
    if (!p)
        return p;
    return path.resolve(p).replace(/\\/g, "/");
}
/**
 * Compute SHA-256 hashes of listed files for review-log coalescing.
 *
 * Missing files become the stable "tombstone" sentinel. Existing paths whose
 * bytes cannot be trusted — directories, devices, oversized files, or read
 * errors — become the unstable "unreadable" sentinel.
 */
const HASH_MAX_BYTES = 8 * 1024 * 1024;
export const HASH_SENTINEL_TOMBSTONE = "tombstone";
export const HASH_SENTINEL_UNREADABLE = "unreadable";
export function hashFilesAtRest(files) {
    const out = {};
    for (const file of files) {
        const normalized = normalizeFilePath(file);
        try {
            const st = fs.statSync(normalized);
            if (!st.isFile()) {
                out[normalized] = HASH_SENTINEL_UNREADABLE;
                continue;
            }
            if (st.size > HASH_MAX_BYTES) {
                out[normalized] = HASH_SENTINEL_UNREADABLE;
                continue;
            }
            const buf = fs.readFileSync(normalized);
            out[normalized] = crypto.createHash("sha256").update(buf).digest("hex");
        }
        catch (e) {
            const code = (e && typeof e === "object" && "code" in e) ? e.code : undefined;
            out[normalized] = code === "ENOENT" ? HASH_SENTINEL_TOMBSTONE : HASH_SENTINEL_UNREADABLE;
        }
    }
    return out;
}
export function makeHashManifest(files, hashes) {
    const normalizedFiles = [...new Set(files.map(normalizeFilePath))];
    return normalizedFiles
        .filter((file) => Object.prototype.hasOwnProperty.call(hashes, file))
        .map((file) => [file, hashes[file]])
        .sort((a, b) => a[0].localeCompare(b[0]));
}
export function hashReviewManifest(files, hashes) {
    const manifest = makeHashManifest(files, hashes);
    return crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}
export function makeCurrentByteReceipt(files, hashes, existing) {
    const now = new Date().toISOString();
    return {
        version: 1,
        kind: "current-byte",
        created_at: existing?.created_at ?? now,
        updated_at: now,
        hash_algorithm: "sha256",
        manifest_algorithm: "sha256-json-v1",
        reviewed_hash: hashReviewManifest(files, hashes),
        files: [...new Set(files.map(normalizeFilePath))],
        hashes: { ...hashes },
    };
}
export function setReviewCurrentByteReceipt(review, files, hashes) {
    const normalizedFiles = [...new Set(files.map(normalizeFilePath))];
    const normalizedHashes = {};
    for (const file of normalizedFiles) {
        if (Object.prototype.hasOwnProperty.call(hashes, file)) {
            normalizedHashes[file] = hashes[file];
        }
    }
    review.files = normalizedFiles;
    review.content_hashes = normalizedHashes;
    review.receipt = makeCurrentByteReceipt(normalizedFiles, normalizedHashes, review.receipt);
    return normalizedHashes;
}
export function makeReviewedByteReceipt(files, hashes, options = {}, existing) {
    const now = new Date().toISOString();
    return {
        version: 1,
        kind: "reviewed-byte",
        created_at: existing?.created_at ?? now,
        updated_at: now,
        completed_at: options.completed_at ?? now,
        reviewed_at: options.reviewed_at ?? now,
        reviewer: options.reviewer ?? "manual",
        review_command: options.review_command ?? null,
        hash_algorithm: "sha256",
        manifest_algorithm: "sha256-json-v1",
        reviewed_hash: hashReviewManifest(files, hashes),
        files: [...new Set(files.map(normalizeFilePath))],
        hashes: { ...hashes },
        source: options.source ?? "reviewed-hash",
    };
}
export function setReviewReviewedByteReceipt(review, files, hashes, options = {}) {
    const normalizedFiles = [...new Set(files.map(normalizeFilePath))];
    const normalizedHashes = {};
    for (const file of normalizedFiles) {
        if (Object.prototype.hasOwnProperty.call(hashes, file)) {
            normalizedHashes[file] = hashes[file];
        }
    }
    review.files = normalizedFiles;
    review.content_hashes = normalizedHashes;
    review.receipt = makeReviewedByteReceipt(normalizedFiles, normalizedHashes, options, review.receipt);
    review.reviewed_hash = review.receipt.reviewed_hash;
    review.reviewed_hash_algorithm = "sha256-json-v1";
    review.reviewed_hashes = { ...normalizedHashes };
    review.reviewed_at = review.receipt.reviewed_at;
    review.review_provenance = {
        kind: "reviewer-saw-current-bytes",
        reviewer: options.reviewer ?? "manual",
        hashes: { ...normalizedHashes },
        hash_algorithm: "sha256",
        manifest_algorithm: "sha256-json-v1",
        reviewed_hash: review.receipt.reviewed_hash,
        source: options.source ?? "reviewed-hash",
    };
    return normalizedHashes;
}
export function getReviewHashes(review) {
    const receiptHashes = review?.receipt && typeof review.receipt === "object" && !Array.isArray(review.receipt)
        ? review.receipt.hashes
        : undefined;
    if (receiptHashes && typeof receiptHashes === "object" && !Array.isArray(receiptHashes)) {
        return receiptHashes;
    }
    return review?.content_hashes;
}
//# sourceMappingURL=shared.js.map