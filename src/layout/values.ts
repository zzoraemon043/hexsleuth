import type { Stream } from "./stream.js";

export interface TreeNode {
  name: string;
  type: string;
  offset: number | null;
  size: number;
  value?: number | string | boolean;
  preview?: string;
  fields?: TreeNode[];
  items?: TreeNode[];
  itemsTruncated?: number;
}

export class ParsedObject {
  readonly values = new Map<string, Value>();

  constructor(
    readonly typeName: string,
    readonly parent: ParsedObject | null,
    readonly rootObject: ParsedObject | null,
    readonly io: Stream,
    readonly node: TreeNode,
  ) {}

  get root(): ParsedObject {
    return this.rootObject ?? this;
  }
}

export interface StreamInfo {
  kind: "io";
  stream: Stream;
}

export type Value = number | boolean | string | Uint8Array | ParsedObject | StreamInfo | Value[];
