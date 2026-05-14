import * as vscode from 'vscode';
import {
  computeMoveGroup,
  computeMoveLink,
  getRawLinks,
  getRootEntries,
  persistLinks,
  RootEntry,
} from './linkStore';
import { FlatLink, PortlEntry } from './types';

const COLLAPSED_KEY = 'portl.collapsedGroups';
const DND_MIME = 'application/vnd.code.tree.portllinks';

// Output channel + ring buffer สำหรับ diagnose — เปิดผ่าน View > Output > Portl
let outputChannel: vscode.OutputChannel | undefined;
const RING_MAX = 100;
const eventRing: string[] = [];

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) outputChannel = vscode.window.createOutputChannel('Portl');
  return outputChannel;
}

export function getRecentEvents(): readonly string[] {
  return eventRing;
}

function log(msg: string): void {
  const stamped = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
  getOutputChannel().appendLine(stamped);
  eventRing.push(stamped);
  if (eventRing.length > RING_MAX) eventRing.shift();
}

// stable id สำหรับ TreeItem — VS Code ใช้ track expand state ภายในรอบเดียว
function itemId(label: string, group?: string, isGroup = false): string {
  if (isGroup) return `group:${label}`;
  return group ? `link:${group}/${label}` : `link:${label}`;
}

export class PortlTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly link?: FlatLink,
    public readonly groupName?: string,
  ) {
    super(label, collapsibleState);

    if (link) {
      this.id = itemId(link.label, link.group);
      this.contextValue = 'link';

      // Rich markdown tooltip — hover เห็นครบ: bold label + description + target code block
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${link.label}**\n\n`);
      if (link.description) {
        md.appendMarkdown(`${link.description}\n\n`);
      }
      md.appendCodeblock(link.target, 'text');
      md.isTrusted = true;
      this.tooltip = md;

      // Inline description — เฉพาะ description ไม่ fallback target (ลด noise + truncate)
      this.description = link.description ?? '';

      this.iconPath = new vscode.ThemeIcon('link');
      // Body click → double-click logic (เพื่อ multi-select). Single click ครั้งแรก = select.
      // Click ครั้งที่ 2 ภายใน 400ms ที่ item เดียวกัน = เปิด. หรือคลิก inline icon $(link-external) = เปิดทันที
      this.command  = {
        command:   'portl.openFromTreeClick',
        title:     'Select (double-click to open)',
        arguments: [this],
      };
    } else {
      this.id = itemId(label, undefined, true);
      this.contextValue = 'group';
      this.iconPath     = new vscode.ThemeIcon('folder');
    }
  }
}

// payload ที่ส่งผ่าน DataTransfer ตอน drag
interface DragPayload {
  items: Array<{ kind: 'link'; label: string; group?: string } | { kind: 'group'; name: string }>;
}

export class PortlTreeProvider
  implements vscode.TreeDataProvider<PortlTreeItem>, vscode.TreeDragAndDropController<PortlTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<PortlTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  readonly dragMimeTypes = [DND_MIME];
  readonly dropMimeTypes = [DND_MIME];

  // Debounce: applyLinks() clears + sets → fires onDidChangeConfiguration 2 ครั้ง
  // ติด ๆ กัน. ไม่อยากให้ tree refresh 2 รอบ (จะ flicker) — coalesce ภายใน 30ms
  private refreshTimer: NodeJS.Timeout | undefined;

  // Optimistic UI: หลัง compute new state แต่ก่อน settings.json write เสร็จ
  // เก็บ "fake" data ไว้ก่อน → render ทันที. พอ config event fires → ล้าง pending → re-read fresh
  private pendingLinks: Record<string, PortlEntry> | undefined;

  // In-cycle memoization: VS Code เรียก getChildren หลายครั้งต่อ refresh (root + แต่ละ group)
  // cache ผลของ parse ครั้งแรกเพื่อ skip redundant work — invalidate ทุกครั้งที่ refresh()
  private entriesCache: RootEntry[] | undefined;

  // Persist guard: applyLinks ทำ clear+set 2 writes ห่างกัน ~200ms
  // ระหว่างนั้น settings อยู่ในสถานะกลาง ๆ (empty หลัง clear). ถ้า refresh เผลอ fire จะ render empty → flicker
  // ใช้ counter (ไม่ใช่ boolean) เพื่อ support nested/parallel persists
  private persistInFlight = 0;

  constructor(private readonly context: vscode.ExtensionContext) {}

  refresh(): void {
    // ระหว่างเรา persist เอง — ignore config events ที่เกิดจาก writes ของเรา
    if (this.persistInFlight > 0) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.pendingLinks = undefined;
      this.entriesCache = undefined;
      this._onDidChangeTreeData.fire();
      this.refreshTimer = undefined;
    }, 30);
  }

  /** เริ่ม persist — refresh จาก config events ระหว่างนี้จะถูก ignore */
  beginPersist(): void {
    this.persistInFlight++;
  }

  /** จบ persist — เมื่อ counter ถึง 0 บังคับ refresh เพื่อ sync กับ disk state */
  endPersist(): void {
    this.persistInFlight = Math.max(0, this.persistInFlight - 1);
    if (this.persistInFlight === 0) {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.pendingLinks = undefined;
        this.entriesCache = undefined;
        this._onDidChangeTreeData.fire();
        this.refreshTimer = undefined;
      }, 30);
    }
  }

  /** Render preview ทันทีจาก in-memory state — bypass debounce, ไม่ทับ pending state */
  applyOptimistic(links: Record<string, PortlEntry>): void {
    this.pendingLinks = links;
    this.entriesCache = undefined;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this._onDidChangeTreeData.fire();
  }

  // ── expand/collapse persistence ──────────────────────────────────
  private getCollapsedSet(): Set<string> {
    return new Set(this.context.globalState.get<string[]>(COLLAPSED_KEY, []));
  }

  async setCollapsed(group: string, collapsed: boolean): Promise<void> {
    const s = this.getCollapsedSet();
    if (collapsed) s.add(group); else s.delete(group);
    await this.context.globalState.update(COLLAPSED_KEY, [...s]);
  }

  getTreeItem(element: PortlTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PortlTreeItem): PortlTreeItem[] {
    // ใช้ pending state ถ้ามี (optimistic), ไม่งั้นอ่านจาก config
    // memoize ใน entriesCache เพื่อให้ getChildren ซ้ำใน refresh cycle เดียวกันใช้ผลเดิม
    if (!this.entriesCache) {
      const links = this.pendingLinks ?? getRawLinks();
      this.entriesCache = getRootEntries(links);
    }
    const entries = this.entriesCache;

    if (!element) {
      const collapsed = this.getCollapsedSet();
      const result: PortlTreeItem[] = [];

      // Render root keys ตามลำดับเดิม — รวม group ว่าง (collapsibleState ใช้ Collapsed ถ้าว่างจะดูสะอาดขึ้น)
      for (const entry of entries) {
        if (entry.kind === 'group') {
          // group ว่าง = ยังคงแสดง แต่ default Collapsed (เพราะกางไปก็ไม่มีอะไร)
          // group มี link → ใช้ saved state, default Expanded
          let state: vscode.TreeItemCollapsibleState;
          if (entry.links.length === 0) {
            state = vscode.TreeItemCollapsibleState.Collapsed;
          } else {
            state = collapsed.has(entry.name)
              ? vscode.TreeItemCollapsibleState.Collapsed
              : vscode.TreeItemCollapsibleState.Expanded;
          }
          result.push(new PortlTreeItem(entry.name, state, undefined, entry.name));
        } else {
          result.push(new PortlTreeItem(entry.link.label, vscode.TreeItemCollapsibleState.None, entry.link));
        }
      }
      return result;
    }

    if (element.groupName) {
      const grp = entries.find(e => e.kind === 'group' && e.name === element.groupName);
      if (grp && grp.kind === 'group') {
        return grp.links.map(l => new PortlTreeItem(l.label, vscode.TreeItemCollapsibleState.None, l));
      }
    }

    return [];
  }

  // ── Drag & Drop ──────────────────────────────────────────────────
  handleDrag(source: readonly PortlTreeItem[], dataTransfer: vscode.DataTransfer): void {
    const payload: DragPayload = {
      items: source.map(i =>
        i.link
          ? { kind: 'link' as const, label: i.link.label, group: i.link.group }
          : { kind: 'group' as const, name: i.groupName! },
      ),
    };
    dataTransfer.set(DND_MIME, new vscode.DataTransferItem(payload));
    log(`drag start: ${JSON.stringify(payload.items)}`);
  }

  async handleDrop(target: PortlTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const raw = dataTransfer.get(DND_MIME);
    if (!raw) {
      log('drop: no payload (mime mismatch)');
      return;
    }

    // VS Code ส่ง value ตรง ๆ ถ้า drag ภายใน view เดียวกัน
    const payload = (typeof raw.value === 'string' ? JSON.parse(raw.value) : raw.value) as DragPayload;
    if (!payload?.items?.length) {
      log('drop: empty items');
      return;
    }

    const targetDesc = !target
      ? 'root(empty)'
      : target.link
      ? `link[${target.link.group ?? 'root'}/${target.link.label}]`
      : `group[${target.groupName}]`;
    log(`drop: items=${JSON.stringify(payload.items)} → target=${targetDesc}`);

    // === Optimistic update pattern ===
    // 1) compute new state in memory ALL items
    // 2) render preview ทันที (applyOptimistic)
    // 3) persist เพียง 1 ครั้งใน background (ไม่ใช่ N writes ต่อ N items)
    // — ดีกว่าการเรียก moveLink ทีละตัวซึ่ง write 2× ต่อ item
    let working = getRawLinks();
    let touched = false;

    // Target resolution:
    //   target undefined           → drop ที่ root, append ท้าย
    //   target = link               → insert ก่อน link นั้น (ใน scope เดียวกัน)
    //   target = group header       → ใส่ท้าย folder นั้น
    for (const item of payload.items) {
      if (item.kind === 'group') {
        let mgTarget: string | undefined;
        if (target?.link && !target.link.group) mgTarget = target.link.label;
        else if (target?.groupName) mgTarget = target.groupName;

        const next = computeMoveGroup(working, item.name, mgTarget);
        if (next) {
          working = next;
          touched = true;
          log(`  computeMoveGroup(${item.name}, ${mgTarget ?? 'append'}) ok`);
        } else {
          log(`  computeMoveGroup(${item.name}, ${mgTarget ?? 'append'}) skipped`);
        }
        continue;
      }

      // item.kind === 'link'
      let dest: { label?: string; group?: string };
      if (!target) {
        dest = { label: undefined, group: undefined };
      } else if (target.link) {
        dest = { label: target.link.label, group: target.link.group };
      } else if (target.groupName) {
        dest = { label: undefined, group: target.groupName };
      } else {
        continue;
      }

      const result = computeMoveLink(working, { label: item.label, group: item.group }, dest);
      if (result) {
        working = result.newLinks;
        touched = true;
        log(`  computeMoveLink → ${result.newLabel}`);
      } else {
        log(`  computeMoveLink skipped (source not found?)`);
      }
    }

    if (!touched) return;

    // [Optimistic] render preview ทันที — user เห็น tree เปลี่ยนก่อน I/O เสร็จ
    this.applyOptimistic(working);

    // [Persist guard] บอก refresh handler ให้ ignore config events ระหว่าง clear+set ของเรา
    // ป้องกัน flicker จาก intermediate empty state
    this.beginPersist();
    persistLinks(working)
      .catch(err => {
        log(`  persist error: ${(err as Error).message} — reverting to disk state`);
      })
      .finally(() => {
        // endPersist จะ trigger refresh ครั้งเดียวเพื่อ sync — render final state จาก disk
        this.endPersist();
      });
  }
}
