import { findRecordChains } from "./chains.js";
import { findStrideRelations, occurrenceCountFindings, strideCountFindings } from "./counts.js";
import { findEndianness } from "./endianness.js";
import type { Finding, FindingKind } from "./finding.js";
import { findFileSizeLengths } from "./lengths.js";
import { findMagicFinding } from "./magic.js";
import { findOffsets } from "./offsets.js";
import { buildSlotTable, buildValueIndex } from "./slot-table.js";
import { enumerateSlots, type Sample, type ScanPlan } from "./slots.js";
import { findVersions } from "./version.js";

export interface InferOptions {
  plan: ScanPlan;
  minConfidence: number;
  maxFindings: number;
}

const chainScanLimit = 128;

function absoluteRange(finding: Finding, sample: Sample): { start: number; end: number } | undefined {
  const evidence = finding.evidence.find((item) => item.sample === sample.file);
  if (!evidence || !finding.field) {
    return undefined;
  }
  const width = finding.field.type === "u1" ? 1 : Number(finding.field.type.charAt(1));
  return { start: evidence.range.offset, end: evidence.range.offset + width };
}

function rank(left: Finding, right: Finding): number {
  const widthOf = (finding: Finding): number => Number(finding.field?.type.charAt(1) ?? 0);
  return right.confidence - left.confidence || widthOf(right) - widthOf(left);
}

function dropOverlapsWithinKind(findings: Finding[], sample: Sample): Finding[] {
  const kept: Finding[] = [];
  for (const finding of [...findings].sort(rank)) {
    const range = absoluteRange(finding, sample);
    const clashes = kept.some((other) => {
      const otherRange = absoluteRange(other, sample);
      return other.kind === finding.kind && range && otherRange && range.start < otherRange.end && otherRange.start < range.end;
    });
    if (!clashes) {
      kept.push(finding);
    }
  }
  return kept;
}

function coverageTest(findings: Finding[], sample: Sample): (position: number, width: number) => boolean {
  const ranges = findings.flatMap((finding) => {
    const evidence = finding.evidence.find((item) => item.sample === sample.file);
    return evidence ? [{ start: evidence.range.offset, end: evidence.range.offset + evidence.range.length }] : [];
  });
  return (position, width) => ranges.some((range) => position < range.end && range.start < position + width);
}

const corroborationBonus = 0.1;

function mergeSameField(findings: Finding[]): Finding[] {
  const merged = new Map<string, Finding>();
  for (const finding of findings) {
    const existing = merged.get(finding.id);
    if (!existing) {
      merged.set(finding.id, { ...finding });
      continue;
    }
    const [stronger, weaker] = existing.confidence >= finding.confidence ? [existing, finding] : [finding, existing];
    merged.set(finding.id, {
      ...stronger,
      claim: stronger.claim,
      check: `${stronger.check}; ${weaker.check}`,
      confidence: Math.min(0.99, Math.round((stronger.confidence + corroborationBonus) * 100) / 100),
      limits: [...new Set([...stronger.limits, ...weaker.limits])],
      related: [...new Set([...stronger.related, ...weaker.related])],
    });
  }
  return [...merged.values()];
}

export interface InferResult {
  findings: Finding[];
  countsByKind: Partial<Record<FindingKind, number>>;
}

export function inferFindings(samples: Sample[], options: InferOptions): InferResult {
  const first = samples[0] as Sample;
  const slots = enumerateSlots(samples, options.plan, [1, 2, 4]);
  const table = buildSlotTable(samples, slots);
  const index = buildValueIndex(table);
  const relations = findStrideRelations(samples, table);
  const structural = dropOverlapsWithinKind(
    mergeSameField([
      ...findFileSizeLengths(samples, slots),
      ...findRecordChains(samples, slots, Math.min(chainScanLimit, options.plan.startTo)),
      ...strideCountFindings(samples, relations),
      ...occurrenceCountFindings(samples, table),
      ...findOffsets(samples, table, index, relations),
    ]),
    first,
  );
  const endianness = findEndianness(samples, structural, table);
  const littleEndian = endianness ? endianness.claim.includes("little") : true;
  const magic = findMagicFinding(samples);
  const versions = findVersions(samples, coverageTest([...structural, ...(magic ? [magic] : [])], first), littleEndian, {
    from: options.plan.startFrom,
    to: options.plan.startTo,
  });
  const all = [...(magic ? [magic] : []), ...structural, ...versions, ...(endianness ? [endianness] : [])];
  const findings = all
    .filter((finding) => finding.confidence >= options.minConfidence)
    .sort(rank)
    .slice(0, options.maxFindings);
  const countsByKind: Partial<Record<FindingKind, number>> = {};
  for (const finding of findings) {
    countsByKind[finding.kind] = (countsByKind[finding.kind] ?? 0) + 1;
  }
  return { findings, countsByKind };
}
