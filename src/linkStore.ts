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

function cloneLinks(config: vscode.WorkspaceConfiguration): Record<string, PortlEntry> {
  return JSON.parse(JSON.stringify(config.get<Record<string, PortlEntry>>('links', {})));
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
        if (Object.keys(grp.nestedItems).length === 0) delete links[group];
      }
    } else {
      delete links[label];
    }
  }

  await config.update('links', links, vscode.ConfigurationTarget.Global);
}
