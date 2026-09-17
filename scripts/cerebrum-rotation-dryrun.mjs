/**
 * Fleet dry run for cerebrum.md Decision Log rotation.
 *
 * Copies every registered project's cerebrum.md into a throwaway sandbox, runs
 * the real rotation primitive against the copy, and reports what WOULD change.
 * Real ledgers are never opened for writing.
 *
 * Run this before any rollout. It caught a defect the unit tests could not:
 * fixtures written in the parser's own preferred date style hid the fact that
 * 46% of real fleet entries used spellings the parser did not recognise, so the
 * canary project silently rotated nothing.
 *
 * Usage: node scripts/cerebrum-rotation-dryrun.mjs
 */
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
const { rotateDatedBulletsInSection } = await import("/mnt/j/projectshome/projects/customopenwolf/.wolf/utils/size-discipline.js");
const r = JSON.parse(fs.readFileSync(path.join(os.homedir(),".openwolf/registry.json"),"utf8"));
const BUDGET=98304, RET=180, NOW=Date.now();
const g = l => { const m=l.match(/^[-*]\s+(?:[*_`]{1,3}\s*)?\[?\(?(\d{4}-\d{2}-\d{2})\)?\]?/); return m?`${m[1]}T00:00:00Z`:undefined; };
const sect=(t,n)=>{const L=t.split("\n");const s=L.findIndex(x=>x.trim()===`## ${n}`);if(s===-1)return null;let e=L.length;for(let i=s+1;i<L.length;i++)if(/^##\s/.test(L[i])){e=i;break;}return L.slice(s,e).join("\n");};
let changed=[], noop=0, damaged=[];
for (const p of r.projects) {
  const src = path.join(p.root,".wolf","cerebrum.md");
  let orig; try { orig = fs.readFileSync(src,"utf8"); } catch { continue; }
  // DRY RUN: copy into a sandbox, never touch the real file
  const sand = fs.mkdtempSync(path.join(os.tmpdir(),"ow-dry-"));
  fs.mkdirSync(path.join(sand,".wolf"));
  const f = path.join(sand,".wolf","cerebrum.md");
  fs.writeFileSync(f, orig);
  const res = rotateDatedBulletsInSection({file:f,sectionHeaderPattern:/^## Decision Log\s*$/,
    getBulletDate:g, retentionDays:RET, maxBytes:BUDGET, now:NOW});
  const after = fs.readFileSync(f,"utf8");
  if (res.archived>0) {
    // SAFETY: every non-Decision-Log section must be byte-identical
    const heads=[...new Set(orig.split("\n").filter(l=>/^##\s/.test(l)).map(l=>l.trim().slice(3)))];
    const bad=heads.filter(h=>h!=="Decision Log" && sect(orig,h)!==sect(after,h));
    if (bad.length) damaged.push({root:p.root,bad:bad.slice(0,3)});
    changed.push({root:path.basename(p.root),before:orig.length,after:after.length,arch:res.archived,trig:res.trigger});
  } else noop++;
  fs.rmSync(sand,{recursive:true,force:true});
}
console.log(`DRY RUN over ${r.projects.length} projects — real files untouched\n`);
console.log(`would change: ${changed.length} | no-op: ${noop}`);
console.log(`SECTION DAMAGE (must be 0): ${damaged.length}`);
for (const d of damaged) console.log("  DAMAGED", d.root, d.bad);
console.log("\nprojects that would change:");
for (const c of changed) console.log(`  ${c.root.padEnd(20)} ${c.before} -> ${c.after}  archived=${c.arch} trigger=${c.trig}`);
