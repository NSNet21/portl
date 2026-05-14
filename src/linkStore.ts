import * as vscode from 'vscode';
import { FlatLink, PortlEntry, PortlGroup, PortlLinkItem } from './types';

function isGroup(entry: PortlEntry): entry is PortlGroup {
  return typeof entry === 'object' && 'nestedItems' in entry;
}

function isLinkItem(entry: PortlEntry): entry is PortlLinkItem {
  return typeof entry === 'object' && 'target' in entry;
}

function resolveTarget(entry: PortlEntry): string | undefined {
  if (typeof entry === 'string') return entry;
  if (isLinkItem(entry)) return entry.target;
  return undefined;
}

function resolveDescription(entry: PortlEntry): string | undefined {
  if (isLinkItem(entry)) return entry.description;
  return undefined;
}

export function getAllLinks(): FlatLink[] {
  const links = vscode.workspace.getConfiguration('portl').get<Record<string, PortlEntry>>('links', {});
  const result: FlatLink[] = [];

  for (const [key, value] of Object.entries(links)) {
    if (isGroup(value)) {
      for (const [subKey, subValue] of Object.entries(value.nestedItems)) {
        const target = resolveTarget(subValue);
        if (target) {
          result.push({ label: subKey, target, description: resolveDescription(subValue), group: key });
        }
      }
    } else {
      const target = resolveTarget(value);
      if (target) {
        result.push({ label: key, target, description: resolveDescription(value) });
      }
    }
  }

  return result;
}

// Structured view สำหรับ tree — preserve groups ว่าง + ลำดับ root keys
export type RootEntry =
  | { kind: 'group'; name: string; links: FlatLink[] }
  | { kind: 'link'; link: FlatLink };

export function getRootEntries(linksInput?: Record<string, PortlEntry>): RootEntry[] {
  const links = linksInput ?? vscode.workspace.getConfiguration('portl').get<Record<string, PortlEntry>>('links', {});
  const result: RootEntry[] = [];

  for (const [key, value] of Object.entries(links)) {
    if (isGroup(value)) {
      const groupLinks: FlatLink[] = [];
      for (const [subKey, subValue] of Object.entries(value.nestedItems)) {
        const target = resolveTarget(subValue);
        if (target) {
          groupLinks.push({ label: subKey, target, description: resolveDescription(subValue), group: key });
        }
      }
      result.push({ kind: 'group', name: key, links: groupLinks });
    } else {
      const target = resolveTarget(value);
      if (target) {
        result.push({ kind: 'link', link: { label: key, target, description: resolveDescription(value) } });
      }
    }
  }

  return result;
}

function cloneLinks(config: vscode.WorkspaceConfiguration): Record<string, PortlEntry> {
  return JSON.parse(JSON.stringify(config.get<Record<string, PortlEntry>>('links', {})));
}

/**
 * VS Code's `config.update(obj)` ใช้ jsonc AST patching ที่ patch แค่ value ของ keys ที่ diff
 * → ไม่ reorder keys! ดังนั้นถ้าเป็น order-only change (reorder, ไม่มี key เพิ่ม/ลด/เปลี่ยน value)
 * ต้อง clear ก่อนแล้ว set ใหม่ บังคับให้ jsonc เขียน key สดทั้งหมดตามลำดับใหม่
 */
async function applyLinks(
  config: vscode.WorkspaceConfiguration,
  links: Record<string, PortlEntry>,
): Promise<void> {
  await config.update('links', undefined, vscode.ConfigurationTarget.Global);
  await config.update('links', links, vscode.ConfigurationTarget.Global);
}

export async function addLink(link: FlatLink): Promise<void> {
  const config = vscode.workspace.getConfiguration('portl');
  const links = cloneLinks(config);

  const entry: PortlEntry = link.description
    ? { target: link.target, description: link.description }
    : link.target;

  if (link.group) {
    const existing = links[link.group];
    const group: PortlGroup = isGroup(existing) ? existing : { nestedItems: {} };
    group.nestedItems[link.label] = entry;
    links[link.group] = group;
  } else {
    links[link.label] = entry;
  }

  await config.update('links', links, vscode.ConfigurationTarget.Global);
}

export async function deleteLink(label: string, group?: string): Promise<void> {
  await deleteLinks([{ label, group }]);
}

export async function resetLinks(): Promise<void> {
  await vscode.workspace.getConfiguration('portl').update('links', {}, vscode.ConfigurationTarget.Global);
}

export async function deleteLinks(targets: Array<{ label: string; group?: string }>): Promise<void> {
  const config = vscode.workspace.getConfiguration('portl');
  const links = cloneLinks(config);

  for (const { label, group } of targets) {
    if (group) {
      const grp = links[group];
      if (isGroup(grp)) {
        delete grp.nestedItems[label];
        // เก็บ folder ว่างไว้ — user อาจอยากใช้เป็น placeholder ก่อน add link ใหม่
      }
    } else {
      delete links[label];
    }
  }

  await config.update('links', links, vscode.ConfigurationTarget.Global);
}

// ───────────────────────── Reorder / Move ─────────────────────────
// JS/V8 รักษา insertion order ของ string keys ใน objects — เราเลยทำ
// reordering ด้วยการ rebuild object ตาม key order ที่ต้องการ

function rebuildObject<T>(obj: Record<string, T>, orderedKeys: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of orderedKeys) if (k in obj) out[k] = obj[k];
  return out;
}

// extract link entry + label จาก root/group โดยไม่ mutate
function pickLink(
  links: Record<string, PortlEntry>,
  label: string,
  group: string | undefined,
): { entry: PortlEntry } | undefined {
  if (group) {
    const grp = links[group];
    if (!isGroup(grp)) return undefined;
    const entry = grp.nestedItems[label];
    return entry !== undefined ? { entry } : undefined;
  }
  const entry = links[label];
  if (entry === undefined || isGroup(entry)) return undefined;
  return { entry };
}

function removeLink(
  links: Record<string, PortlEntry>,
  label: string,
  group: string | undefined,
): void {
  if (group) {
    const grp = links[group];
    if (isGroup(grp)) {
      delete grp.nestedItems[label];
      // เก็บ folder ว่างไว้ — ผู้ใช้อาจ drag ออกชั่วคราวแล้วลากกลับ
    }
  } else {
    delete links[label];
  }
}

// resolve label collision ตอนย้ายข้าม group — ถ้าซ้ำให้ต่อท้าย (2), (3), ...
function uniqueLabel(taken: Record<string, unknown>, desired: string): string {
  if (!(desired in taken)) return desired;
  let i = 2;
  while (`${desired} (${i})` in taken) i++;
  return `${desired} (${i})`;
}

/**
 * Pure compute สำหรับ move link — ไม่แตะ settings.json
 * คืน new state + new label เพื่อให้ caller decide ว่าจะ render preview ก่อน persist หรือเปล่า
 */
export function computeMoveLink(
  links: Record<string, PortlEntry>,
  source: { label: string; group?: string },
  target: { label?: string; group?: string },
): { newLinks: Record<string, PortlEntry>; newLabel: string } | undefined {
  const next = JSON.parse(JSON.stringify(links)) as Record<string, PortlEntry>;

  const picked = pickLink(next, source.label, source.group);
  if (!picked) return undefined;

  // no-op: drop ทับตัวเอง
  if (source.label === target.label && source.group === target.group) {
    return { newLinks: next, newLabel: source.label };
  }

  // Smart positioning: same-container reorder → detect ทิศทาง
  let insertAfter = false;
  if (source.group === target.group && target.label && target.label !== source.label) {
    const preContainer = source.group
      ? (next[source.group] as PortlGroup | undefined)?.nestedItems
      : next;
    if (preContainer) {
      const preKeys = Object.keys(preContainer);
      const sIdx = preKeys.indexOf(source.label);
      const tIdx = preKeys.indexOf(target.label);
      if (sIdx >= 0 && tIdx >= 0 && sIdx < tIdx) insertAfter = true;
    }
  }

  removeLink(next, source.label, source.group);

  let destContainer: Record<string, PortlEntry>;
  if (target.group) {
    let grp = next[target.group];
    if (!isGroup(grp)) {
      grp = { nestedItems: {} };
      next[target.group] = grp;
    }
    destContainer = grp.nestedItems as Record<string, PortlEntry>;
  } else {
    destContainer = next;
  }

  const newLabel = uniqueLabel(destContainer, source.label);
  const keys = Object.keys(destContainer);

  let insertIdx: number;
  if (!target.label) {
    insertIdx = -1;
  } else {
    const targetIdx = keys.indexOf(target.label);
    insertIdx = targetIdx < 0 ? -1 : insertAfter ? targetIdx + 1 : targetIdx;
  }

  const orderedKeys =
    insertIdx >= 0
      ? [...keys.slice(0, insertIdx), newLabel, ...keys.slice(insertIdx)]
      : [...keys, newLabel];

  destContainer[newLabel] = picked.entry;

  if (target.group) {
    (next[target.group] as PortlGroup).nestedItems = rebuildObject(destContainer, orderedKeys);
  } else {
    const rebuilt = rebuildObject(destContainer, orderedKeys);
    for (const k of Object.keys(next)) delete next[k];
    for (const [k, v] of Object.entries(rebuilt)) next[k] = v;
  }

  return { newLinks: next, newLabel };
}

/**
 * ย้าย link จาก {source} ไปก่อน target — wrapper: compute + persist.
 */
export async function moveLink(
  source: { label: string; group?: string },
  target: { label?: string; group?: string },
): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('portl');
  const current = cloneLinks(config);
  const result = computeMoveLink(current, source, target);
  if (!result) return undefined;
  await applyLinks(config, result.newLinks);
  return result.newLabel;
}

/**
 * Pure compute สำหรับ group reorder — ไม่แตะ settings.json
 */
export function computeMoveGroup(
  links: Record<string, PortlEntry>,
  source: string,
  targetGroup?: string,
): Record<string, PortlEntry> | undefined {
  if (!(source in links) || !isGroup(links[source])) return undefined;
  if (source === targetGroup) return undefined;

  const next = JSON.parse(JSON.stringify(links)) as Record<string, PortlEntry>;

  // Smart positioning: ลากลงล่าง → insert AFTER, ลากขึ้นบน → insert BEFORE
  const allKeys = Object.keys(next);
  let insertAfter = false;
  if (targetGroup) {
    const sIdx = allKeys.indexOf(source);
    const tIdx = allKeys.indexOf(targetGroup);
    if (sIdx >= 0 && tIdx >= 0 && sIdx < tIdx) insertAfter = true;
  }

  const keys = allKeys.filter(k => k !== source);

  let insertIdx: number;
  if (!targetGroup) {
    insertIdx = -1;
  } else {
    const tIdx = keys.indexOf(targetGroup);
    insertIdx = tIdx < 0 ? -1 : insertAfter ? tIdx + 1 : tIdx;
  }

  const orderedKeys =
    insertIdx >= 0
      ? [...keys.slice(0, insertIdx), source, ...keys.slice(insertIdx)]
      : [...keys, source];

  // rebuild object ตามลำดับใหม่
  const snapshot = { ...next };
  for (const k of Object.keys(next)) delete next[k];
  for (const k of orderedKeys) if (k in snapshot) next[k] = snapshot[k];

  return next;
}

/**
 * ย้าย group `source` ไปก่อน `targetGroup` ที่ root level — wrapper: compute + persist.
 */
export async function moveGroup(source: string, targetGroup?: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('portl');
  const current = cloneLinks(config);
  const next = computeMoveGroup(current, source, targetGroup);
  if (!next) return;
  await applyLinks(config, next);
}

/**
 * Standalone persist helper — สำหรับ handleDrop ที่จะ compute เอง + render preview ก่อน
 * แล้วจึงเรียก persist ทีหลัง
 */
export async function persistLinks(links: Record<string, PortlEntry>): Promise<void> {
  await applyLinks(vscode.workspace.getConfiguration('portl'), links);
}

/** อ่าน raw links object ปัจจุบัน — convenience สำหรับ handleDrop */
export function getRawLinks(): Record<string, PortlEntry> {
  return vscode.workspace.getConfiguration('portl').get<Record<string, PortlEntry>>('links', {});
}
