import { classifyHighEntropy, entropyBlocks } from "../core/entropy-regions.js";
import type { TreeNode } from "../layout/values.js";
import type { EntropyNote } from "./markdown.js";

const blockSize = 256;

interface Leaf {
  path: string;
  offset: number;
  size: number;
}

function childPath(parentPath: string, parent: TreeNode, child: TreeNode): string {
  if (parent.items?.includes(child)) {
    const cut = parentPath.lastIndexOf(".");
    return cut < 0 ? child.name : `${parentPath.slice(0, cut + 1)}${child.name}`;
  }
  return parentPath ? `${parentPath}.${child.name}` : child.name;
}

function leaves(node: TreeNode, path: string, output: Leaf[]): Leaf[] {
  const children = [...(node.fields ?? []), ...(node.items ?? [])];
  if (children.length === 0 && node.offset !== null && path) {
    output.push({ path, offset: node.offset, size: node.size });
  }
  for (const child of children) {
    leaves(child, childPath(path, node, child), output);
  }
  return output;
}

function fieldAt(tree: TreeNode | undefined, offset: number): string | null {
  if (!tree) {
    return null;
  }
  const covering = leaves(tree, "", []).filter((leaf) => leaf.offset <= offset && offset < leaf.offset + leaf.size);
  covering.sort((left, right) => left.size - right.size);
  return covering[0]?.path ?? null;
}

export function entropyNotes(file: string, bytes: Uint8Array, tree: TreeNode | undefined): EntropyNote[] {
  const regions = classifyHighEntropy(bytes, entropyBlocks(bytes, 0, blockSize), blockSize);
  return regions.map((region) => ({
    file,
    offset: region.offset,
    length: region.length,
    classification: region.compression
      ? `compressed (${region.compression.method}${region.compression.complete ? "" : ", interrupted"})`
      : `${region.classification}${region.note.includes("continuation") ? ", or the continuation of an interrupted stream" : ""}`,
    field: fieldAt(tree, region.compression?.offset ?? region.offset),
  }));
}
