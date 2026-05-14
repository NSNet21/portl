import * as vscode from 'vscode';
import { getOutputChannel, getRecentEvents, PortlTreeProvider } from '../treeView';
import { getRootEntries, moveLink, moveGroup } from '../linkStore';
import { PortlEntry } from '../types';

const COLLAPSED_KEY = 'portl.collapsedGroups';

// truncate value ที่ยาวเกินสำหรับ pretty print
function shortenValue(v: unknown, max = 80): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function dumpLinks(links: Record<string, PortlEntry>): string[] {
  const lines: string[] = [];
  let i = 0;
  for (const [key, value] of Object.entries(links)) {
    i++;
    if (typeof value === 'object' && value !== null && 'nestedItems' in value) {
      const items = Object.entries(value.nestedItems);
      lines.push(`  ${i}. [group] "${key}" (${items.length} items)`);
      let j = 0;
      for (const [subKey, subValue] of items) {
        j++;
        lines.push(`       ${j}. "${subKey}" = ${shortenValue(subValue)}`);
      }
    } else {
      lines.push(`  ${i}. [link]  "${key}" = ${shortenValue(value)}`);
    }
  }
  return lines;
}

export function showOutputLog(): void {
  getOutputChannel().show(true);
}

export async function diagnose(
  context: vscode.ExtensionContext,
  treeProvider?: PortlTreeProvider,
): Promise<void> {
  const ch = getOutputChannel();
  const ext = vscode.extensions.getExtension('nsnet.portl');
  const version = ext?.packageJSON?.version ?? 'unknown';
  const config = vscode.workspace.getConfiguration('portl');
  const rawLinks = config.get<Record<string, PortlEntry>>('links', {});
  const entries = getRootEntries();
  const collapsedSet = new Set(context.globalState.get<string[]>(COLLAPSED_KEY, []));
  const recentEvents = getRecentEvents();

  ch.appendLine('');
  ch.appendLine('═══════════════════════════════════════════════════════');
  ch.appendLine(`  Portl Diagnose Report — ${new Date().toLocaleString()}`);
  ch.appendLine('═══════════════════════════════════════════════════════');

  // ── Environment ─────────────────────────────────────────────────
  ch.appendLine('');
  ch.appendLine('▼ Environment');
  ch.appendLine(`  Portl version: ${version}`);
  ch.appendLine(`  VS Code:       ${vscode.version}`);
  ch.appendLine(`  Platform:      ${process.platform} (${process.arch})`);

  // ── Raw settings ────────────────────────────────────────────────
  ch.appendLine('');
  ch.appendLine(`▼ Settings (portl.links) — ${Object.keys(rawLinks).length} root keys`);
  for (const line of dumpLinks(rawLinks)) ch.appendLine(line);

  // ── Parsed tree (what tree view sees) ───────────────────────────
  ch.appendLine('');
  ch.appendLine(`▼ Parsed tree via getRootEntries() — ${entries.length} entries`);
  entries.forEach((e, i) => {
    if (e.kind === 'group') {
      ch.appendLine(`  ${i + 1}. [group] "${e.name}" (${e.links.length} links)`);
      e.links.forEach((l, j) => ch.appendLine(`       ${j + 1}. "${l.label}"`));
    } else {
      ch.appendLine(`  ${i + 1}. [link]  "${e.link.label}" → ${shortenValue(e.link.target)}`);
    }
  });

  // ── globalState ─────────────────────────────────────────────────
  ch.appendLine('');
  ch.appendLine(`▼ globalState['${COLLAPSED_KEY}'] — ${collapsedSet.size} collapsed`);
  if (collapsedSet.size === 0) {
    ch.appendLine('  (all groups expanded by default)');
  } else {
    [...collapsedSet].forEach(g => ch.appendLine(`  • ${g}`));
  }

  // ── Recent DnD events ───────────────────────────────────────────
  ch.appendLine('');
  ch.appendLine(`▼ Recent DnD events — ${recentEvents.length}/100 logged`);
  if (recentEvents.length === 0) {
    ch.appendLine('  (no events yet — ลองลาก link/folder แล้วรันคำสั่งนี้อีกครั้ง)');
  } else {
    // แสดง 30 รายการล่าสุด (ก่อนหน้าอยู่ใน buffer แต่ไม่ render เพื่อความสั้น)
    const shown = recentEvents.slice(-30);
    shown.forEach(e => ch.appendLine(`  ${e}`));
    if (recentEvents.length > 30) {
      ch.appendLine(`  (… ${recentEvents.length - 30} older events omitted)`);
    }
  }

  // ── Performance probe ───────────────────────────────────────────
  ch.appendLine('');
  ch.appendLine('▼ Performance probe (timings, average of 5 runs)');
  await runPerfProbe(ch);

  // ── Self-test ───────────────────────────────────────────────────
  ch.appendLine('');
  ch.appendLine('▼ Self-test: move-and-revert (writes to settings, then undoes)');
  // เปิด persist guard ครอบ self-test ทั้งหมด — tree ไม่ flicker ระหว่างหลาย writes
  treeProvider?.beginPersist();
  try {
    await runSelfTest(ch, config, rawLinks);
  } finally {
    treeProvider?.endPersist();
  }

  ch.appendLine('');
  ch.appendLine('═══════════════════════════════════════════════════════');
  ch.appendLine('  End of report');
  ch.appendLine('═══════════════════════════════════════════════════════');

  ch.show(true);
}

/** วัด micro-timings เฉลี่ย 5 ครั้ง — ไม่แตะ data จริง (read-only ops) */
async function runPerfProbe(ch: vscode.OutputChannel): Promise<void> {
  const time = (fn: () => unknown, runs = 5): number => {
    let total = 0;
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      fn();
      total += performance.now() - t;
    }
    return total / runs;
  };

  const cfg = vscode.workspace.getConfiguration('portl');
  const raw = cfg.get<Record<string, PortlEntry>>('links', {});
  const linkCount = Object.entries(raw).reduce((acc, [, v]) => {
    if (typeof v === 'object' && v !== null && 'nestedItems' in v) return acc + Object.keys(v.nestedItems).length;
    return acc + 1;
  }, 0);

  const tGet = time(() => cfg.get('links'));
  const tGetRoot = time(() => getRootEntries());
  const tClone = time(() => JSON.parse(JSON.stringify(raw)));

  ch.appendLine(`  data size:           ${linkCount} links across ${Object.keys(raw).length} root keys`);
  ch.appendLine(`  config.get('links'): ${tGet.toFixed(2)}ms`);
  ch.appendLine(`  getRootEntries():    ${tGetRoot.toFixed(2)}ms`);
  ch.appendLine(`  JSON deep clone:     ${tClone.toFixed(2)}ms`);
  ch.appendLine('  (applyLinks I/O ไม่วัดที่นี่ — write จะเปลี่ยน data จริง; ดู self-test ด้านล่าง)');
}

/** ทดสอบ moveLink/moveGroup กับ data จริง แล้ว revert กลับ — verify logic ถูก */
async function runSelfTest(
  ch: vscode.OutputChannel,
  _config: vscode.WorkspaceConfiguration,
  originalLinks: Record<string, PortlEntry>,
): Promise<void> {
  // WorkspaceConfiguration เป็น snapshot — หลัง update() ต้องเรียก getConfiguration() ใหม่ทุกครั้ง
  // ไม่งั้น .get() จะ return ค่าเดิม (false negative ใน self-test)
  const fresh = () => vscode.workspace.getConfiguration('portl');

  // backup
  const backup = JSON.parse(JSON.stringify(originalLinks)) as Record<string, PortlEntry>;
  const restore = async () => {
    // ใช้ clear+set เพื่อบังคับ jsonc เขียนใหม่ตามลำดับเดิม
    await fresh().update('links', undefined, vscode.ConfigurationTarget.Global);
    await fresh().update('links', backup, vscode.ConfigurationTarget.Global);
  };

  try {
    // หา group แรกที่มี ≥2 links เพื่อทดสอบ in-folder reorder
    const candidateGroup = Object.entries(originalLinks).find(([, v]) => {
      return typeof v === 'object' && v !== null && 'nestedItems' in v && Object.keys(v.nestedItems).length >= 2;
    });

    if (!candidateGroup) {
      ch.appendLine('  ⚠ ข้าม in-folder reorder test — ไม่มี group ที่มี ≥2 links');
    } else {
      const [groupName, groupVal] = candidateGroup;
      const linkKeys = Object.keys((groupVal as { nestedItems: Record<string, PortlEntry> }).nestedItems);
      const a = linkKeys[0];
      const b = linkKeys[1];

      ch.appendLine(`  [Test 1] In-folder reorder: move "${a}" → before/after "${b}" in "${groupName}"`);
      ch.appendLine(`    Pre order: [${linkKeys.slice(0, 5).join(', ')}${linkKeys.length > 5 ? ', …' : ''}]`);

      const t1 = performance.now();
      const result = await moveLink({ label: a, group: groupName }, { label: b, group: groupName });
      const t1Elapsed = performance.now() - t1;
      ch.appendLine(`    moveLink returned: ${result ?? 'undefined ❌'} (${t1Elapsed.toFixed(0)}ms incl. 2× settings.json write)`);

      const after = fresh().get<Record<string, PortlEntry>>('links', {});
      const afterGroup = after[groupName];
      if (typeof afterGroup === 'object' && afterGroup !== null && 'nestedItems' in afterGroup) {
        const afterKeys = Object.keys(afterGroup.nestedItems);
        ch.appendLine(`    Post order: [${afterKeys.slice(0, 5).join(', ')}${afterKeys.length > 5 ? ', …' : ''}]`);
        const changed = JSON.stringify(linkKeys) !== JSON.stringify(afterKeys);
        ch.appendLine(`    Order changed: ${changed ? '✓ YES' : '❌ NO (BUG!)'}`);
      }

      await restore();
      ch.appendLine('    → restored');
    }

    // ทดสอบ folder reorder ถ้ามี ≥2 groups
    const allGroups = Object.entries(originalLinks)
      .filter(([, v]) => typeof v === 'object' && v !== null && 'nestedItems' in v)
      .map(([k]) => k);

    if (allGroups.length < 2) {
      ch.appendLine('  ⚠ ข้าม group reorder test — ต้องมี ≥2 groups');
    } else {
      const g1 = allGroups[0];
      const g2 = allGroups[1];
      const preKeys = Object.keys(originalLinks);
      ch.appendLine(`  [Test 2] Group reorder: move "${g1}" → before "${g2}"`);
      ch.appendLine(`    Pre order: [${preKeys.join(', ')}]`);

      const t2 = performance.now();
      await moveGroup(g1, g2);
      const t2Elapsed = performance.now() - t2;
      ch.appendLine(`    Elapsed: ${t2Elapsed.toFixed(0)}ms incl. 2× settings.json write`);

      const after = fresh().get<Record<string, PortlEntry>>('links', {});
      const afterKeys = Object.keys(after);
      ch.appendLine(`    Post order: [${afterKeys.join(', ')}]`);
      const changed = JSON.stringify(preKeys) !== JSON.stringify(afterKeys);
      ch.appendLine(`    Order changed: ${changed ? '✓ YES' : '❌ NO (BUG!)'}`);

      await restore();
      ch.appendLine('    → restored');
    }
  } catch (err) {
    ch.appendLine(`  ❌ Self-test threw: ${(err as Error).message}`);
    await restore(); // safety
  }
}
