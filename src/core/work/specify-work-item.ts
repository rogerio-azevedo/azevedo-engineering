import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  WorkItemSpecificationContentSchema,
  WorkItemSpecificationSchema,
  type WorkItemSpecification,
} from "./contracts.js";
import { WorkItemError } from "./errors.js";
import { workSpecificationIdentity } from "./identity.js";
import { loadWorkItem, saveSpecification, writeWorkPointer } from "./store.js";

const SpecificationFileSchema = z.object({
  title: z.string().trim().min(1).optional(),
  objective: z.string().trim().min(1),
  acceptanceCriteria: z.array(z.object({
    id: z.string().regex(/^ac-[a-z0-9]+(?:-[a-z0-9]+)*$/),
    statement: z.string().min(1),
  }).strict()).optional(),
  openQuestions: z.array(z.string().min(1)).optional(),
}).strict();

export type SpecifyWorkItemResult = {
  outcome: "created" | "unchanged";
  specification: WorkItemSpecification;
};

export function specifyWorkItem(input: {
  workspace: string;
  workItemId: string;
  specificationPath?: string;
  cwd?: string;
}): SpecifyWorkItemResult {
  const loaded = loadWorkItem(input.workspace, input.workItemId);
  if (!loaded) throw new WorkItemError(`Work item was not found: ${input.workItemId}`);
  const supplied = input.specificationPath ? readSpecificationFile(input.specificationPath, input.cwd ?? input.workspace) : null;
  if (supplied && supplied.objective !== loaded.item.objective) {
    throw new WorkItemError("Specification objective must match the work item objective.");
  }
  const content = WorkItemSpecificationContentSchema.parse({
    title: supplied?.title ?? loaded.item.objective,
    objective: loaded.item.objective,
    acceptanceCriteria: supplied?.acceptanceCriteria ?? [],
    openQuestions: supplied?.openQuestions ?? [],
    provenance: {
      projectId: loaded.item.projectId,
      workItemId: loaded.item.id,
      sources: supplied
        ? [{ kind: "user" as const, reference: null }]
        : [{ kind: "work-item" as const, reference: null }],
    },
  });
  const specification = WorkItemSpecificationSchema.parse({
    schemaVersion: 1,
    kind: "work-item-specification",
    id: workSpecificationIdentity(content),
    ...content,
  });
  const saved = saveSpecification(input.workspace, specification);
  const outcome = saved === "unchanged" ? "unchanged" as const : "created" as const;
  if (loaded.pointer.specificationId !== specification.id) {
    writeWorkPointer(input.workspace, {
      ...loaded.pointer,
      specificationId: specification.id,
      coordinatedPlanId: null,
      repositories: loaded.pointer.repositories.map((repository) => ({
        repositoryId: repository.repositoryId,
        relevance: { state: "UNKNOWN" as const, cause: "not-explored" as const },
        explorationId: null,
        repositoryPlanId: null,
      })),
    });
  }
  return { outcome, specification };
}

function readSpecificationFile(specificationPath: string, cwd: string): z.infer<typeof SpecificationFileSchema> {
  const path = resolve(cwd, specificationPath);
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new WorkItemError("Specification input is not a safe regular file.");
  return SpecificationFileSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
