export interface PortlLinkItem {
  target: string;
  description?: string;
}

export interface PortlGroup {
  nestedItems: Record<string, PortlEntry>;
}

export type PortlEntry = string | PortlLinkItem | PortlGroup;

export interface FlatLink {
  label: string;
  target: string;
  description?: string;
  group?: string;
}
