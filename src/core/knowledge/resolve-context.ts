import { posix } from "node:path";
import type { z } from "zod";
import {
  ContextManifestSchema,
  KnowledgeApplicabilitySelectorSchema,
  KnowledgeResolutionContextSchema,
  KnowledgeUnitSchema,
  type ContextManifest,
  type KnowledgeUnit,
} from "./knowledge-unit.js";

type SelectorInput = z.input<typeof KnowledgeApplicabilitySelectorSchema>;
type ResolutionInput = z.input<typeof KnowledgeResolutionContextSchema>;

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function normalizePath(value: string): string {
  const normalized = posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "").replace(/\/$/, "");
  return normalized || ".";
}

function pathMatches(prefix: string, path: string): boolean {
  const normalizedPrefix = normalizePath(prefix);
  const normalizedPath = normalizePath(path);
  return normalizedPrefix === "." || normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

export function selectorMatches(
  rawSelector: SelectorInput,
  rawContext: ResolutionInput,
): boolean {
  const selector = KnowledgeApplicabilitySelectorSchema.parse(rawSelector);
  const context = KnowledgeResolutionContextSchema.parse(rawContext);
  if (selector.always) return true;
  if (selector.phases.length > 0 && !selector.phases.includes(context.phase)) return false;
  if (selector.taskTypes.length > 0 && !selector.taskTypes.includes(context.taskType)) return false;
  if (selector.riskClasses.length > 0 && !selector.riskClasses.includes(context.riskClass)) return false;
  if (selector.signals.length > 0 && !intersects(selector.signals, context.signals)) return false;
  if (selector.technologies.length > 0 && !intersects(selector.technologies, context.technologies)) return false;
  if (selector.capabilities.length > 0 && !intersects(selector.capabilities, context.capabilities)) return false;
  if (
    selector.pathPrefixes.length > 0 &&
    !selector.pathPrefixes.some((prefix) => context.affectedPaths.some((path) => pathMatches(prefix, path)))
  ) return false;
  if (selector.contextSources.length > 0 && !intersects(selector.contextSources, context.contextSources)) return false;
  return true;
}

function selectionReasons(unit: KnowledgeUnit, context: z.infer<typeof KnowledgeResolutionContextSchema>): string[] {
  const reasons = new Set<string>();
  for (const selector of unit.appliesWhen) {
    if (!selectorMatches(selector, context)) continue;
    if (selector.always) reasons.add("always");
    if (selector.phases.includes(context.phase)) reasons.add(`phase:${context.phase}`);
    if (selector.taskTypes.includes(context.taskType)) reasons.add(`task-type:${context.taskType}`);
    if (selector.riskClasses.includes(context.riskClass)) reasons.add(`risk:${context.riskClass}`);
    for (const signal of selector.signals.filter((value) => context.signals.includes(value))) reasons.add(`signal:${signal}`);
    for (const technology of selector.technologies.filter((value) => context.technologies.includes(value))) reasons.add(`technology:${technology}`);
    for (const capability of selector.capabilities.filter((value) => context.capabilities.includes(value))) reasons.add(`capability:${capability}`);
    for (const prefix of selector.pathPrefixes) {
      if (context.affectedPaths.some((path) => pathMatches(prefix, path))) reasons.add(`path-prefix:${normalizePath(prefix)}`);
    }
    for (const source of selector.contextSources.filter((value) => context.contextSources.includes(value))) {
      reasons.add(`context-source:${source}`);
    }
  }
  return [...reasons].sort();
}

export function resolveContextManifest(
  rawCatalog: readonly KnowledgeUnit[],
  rawContext: ResolutionInput,
): ContextManifest {
  const context = KnowledgeResolutionContextSchema.parse(rawContext);
  const catalog = rawCatalog.map((unit) => KnowledgeUnitSchema.parse(unit));
  const byId = new Map<string, KnowledgeUnit>();
  for (const unit of catalog) {
    if (byId.has(unit.id)) throw new Error(`Duplicate knowledge unit: ${unit.id}`);
    byId.set(unit.id, unit);
  }

  const reasons = new Map<string, Set<string>>();
  for (const unit of catalog) {
    const included = unit.appliesWhen.some((selector) => selectorMatches(selector, context));
    const excluded = unit.doesNotApplyWhen.some((selector) => selectorMatches(selector, context));
    if (included && !excluded) reasons.set(unit.id, new Set(selectionReasons(unit, context)));
  }

  const addRequirements = (unit: KnowledgeUnit, chain: readonly string[]): void => {
    for (const requiredId of unit.requires) {
      const required = byId.get(requiredId);
      if (!required) throw new Error(`Knowledge unit ${unit.id} requires missing unit ${requiredId}.`);
      if (chain.includes(requiredId)) throw new Error(`Knowledge dependency cycle: ${[...chain, requiredId].join(" -> ")}`);
      const requiredReasons = reasons.get(requiredId) ?? new Set<string>();
      requiredReasons.add(`required-by:${unit.id}`);
      reasons.set(requiredId, requiredReasons);
      addRequirements(required, [...chain, requiredId]);
    }
  };
  for (const id of [...reasons.keys()]) addRequirements(byId.get(id)!, [id]);

  for (const id of reasons.keys()) {
    const unit = byId.get(id)!;
    const conflict = unit.conflictsWith.find((conflictId) => reasons.has(conflictId));
    if (conflict) throw new Error(`Selected knowledge units conflict: ${unit.id} and ${conflict}.`);
  }

  const selected = [...reasons.keys()].sort().map((id) => {
    const unit = byId.get(id)!;
    return {
      id: unit.id,
      version: unit.version,
      reason: [...reasons.get(id)!].sort(),
      estimatedTokens: unit.estimatedTokens,
    };
  });
  return ContextManifestSchema.parse({
    schemaVersion: 1,
    phase: context.phase,
    selected,
    totalEstimatedTokens: selected.reduce((total, unit) => total + unit.estimatedTokens, 0),
  });
}
