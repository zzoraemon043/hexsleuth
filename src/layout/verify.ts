import { LayoutInterpreter } from "./interpreter.js";
import type { Layout } from "./schema.js";
import type { TreeNode } from "./values.js";

export interface SampleVerification {
  file: string;
  size: number;
  ok: boolean;
  error: { path: string; offset: number | null; message: string } | null;
  readBytes: number;
  unreadBytes: number;
  unread: { offset: number; length: number }[];
  tree?: TreeNode;
}

export interface VerifyOptions {
  includeTree: boolean;
  maxArrayItems: number;
  maxUnreadRanges: number;
}

function truncateTree(node: TreeNode, maxArrayItems: number): TreeNode {
  const output: TreeNode = { ...node };
  if (node.fields) {
    output.fields = node.fields.map((field) => truncateTree(field, maxArrayItems));
  }
  if (node.items) {
    output.items = node.items.slice(0, maxArrayItems).map((item) => truncateTree(item, maxArrayItems));
    if (node.items.length > maxArrayItems) {
      output.itemsTruncated = node.items.length - maxArrayItems;
    }
  }
  return output;
}

export function verifySample(layout: Layout, file: string, bytes: Uint8Array, options: VerifyOptions): SampleVerification {
  const outcome = new LayoutInterpreter(layout).parse(bytes);
  const unread = outcome.coverage.gaps(bytes.length);
  const unreadBytes = unread.reduce((total, gap) => total + gap.length, 0);
  return {
    file,
    size: bytes.length,
    ok: outcome.error === null,
    error: outcome.error ? { path: outcome.error.path, offset: outcome.error.offset, message: outcome.error.message } : null,
    readBytes: bytes.length - unreadBytes,
    unreadBytes,
    unread: unread.slice(0, options.maxUnreadRanges),
    ...(options.includeTree ? { tree: truncateTree(outcome.root.node, options.maxArrayItems) } : {}),
  };
}
