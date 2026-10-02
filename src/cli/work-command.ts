import { resolveWorkspace } from "../core/project/workspace.js";
import { createWorkItem } from "../core/work/create-work-item.js";
import { exploreWorkItem } from "../core/work/explore-work-item.js";
import { planWorkItem } from "../core/work/plan-work-item.js";
import { specifyWorkItem } from "../core/work/specify-work-item.js";
import { WorkItemError } from "../core/work/errors.js";

export class WorkCliError extends Error {
  constructor(message: string, readonly exitCode: 1 | 2) {
    super(message);
    this.name = "WorkCliError";
  }
}

const WORK_HELP = `Usage:
  azevedo work create --project <project-id> --task <task> [--json]
  azevedo work specify --work-item <work-item-id> [--spec <file>] [--json]

Work item mode does not initialize the target and does not write harness files there.
`;

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new WorkCliError(`Option ${name} requires a value.`, 2);
  if (args.indexOf(name, index + 1) >= 0) throw new WorkCliError(`Option ${name} may only be provided once.`, 2);
  return value;
}

function barePositional(args: readonly string[]): string | undefined {
  const valued = new Set(["--project", "--task", "--spec", "--work-item"]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;
    if (token.startsWith("--")) {
      if (valued.has(token)) index += 1;
      continue;
    }
    return token;
  }
  return undefined;
}

function jsonFlag(args: readonly string[]): boolean {
  return args.includes("--json");
}

export function runWorkCli(args: readonly string[], cwd: string): { stdout: string; exitCode: number } {
  const [subcommand, ...rest] = args;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    if (rest.length > 0) throw new WorkCliError(`Unexpected argument: ${rest[0]}`, 2);
    return { stdout: WORK_HELP, exitCode: 0 };
  }
  const workspace = resolveWorkspace(cwd, undefined, process.env.AZEVEDO_WORKSPACE);
  try {
    if (subcommand === "create") return { stdout: create(rest, workspace), exitCode: 0 };
    if (subcommand === "specify") return { stdout: specify(rest, workspace, cwd), exitCode: 0 };
    throw new WorkCliError(`Unknown work command: ${subcommand}`, 2);
  } catch (error) {
    if (error instanceof WorkCliError) throw error;
    if (error instanceof WorkItemError) throw new WorkCliError(error.message, error.code === "conflict" ? 1 : 1);
    throw new WorkCliError(error instanceof Error ? error.message : String(error), 1);
  }
}

function create(args: readonly string[], workspace: string): string {
  if (args.includes("--help")) return WORK_HELP;
  rejectMixed(args, ["--project", "--task", "--json"]);
  const positional = barePositional(args);
  if (positional) throw new WorkCliError(`Path mode and work-item mode cannot be combined. Unexpected argument: ${positional}`, 2);
  const projectId = flag(args, "--project");
  const task = flag(args, "--task");
  if (!projectId || !task?.trim()) throw new WorkCliError("work create requires --project and --task.", 2);
  const result = createWorkItem({ workspace, projectId, objective: task });
  return render(jsonFlag(args), {
    command: "work create",
    outcome: result.outcome,
    projectId: result.item.projectId,
    workItemId: result.item.id,
    repositoryIds: result.item.repositoryIds,
    relevance: result.pointer.repositories.map((repository) => ({
      repositoryId: repository.repositoryId,
      state: repository.relevance.state,
      cause: repository.relevance.state === "UNKNOWN" ? repository.relevance.cause : null,
    })),
  });
}

function specify(args: readonly string[], workspace: string, cwd: string): string {
  if (args.includes("--help")) return WORK_HELP;
  rejectMixed(args, ["--work-item", "--spec", "--json"]);
  const positional = barePositional(args);
  if (positional) throw new WorkCliError(`Path mode and work-item mode cannot be combined. Unexpected argument: ${positional}`, 2);
  const workItemId = flag(args, "--work-item");
  const specificationPath = flag(args, "--spec");
  if (!workItemId) throw new WorkCliError("work specify requires --work-item.", 2);
  const result = specifyWorkItem({
    workspace,
    workItemId,
    ...(specificationPath ? { specificationPath, cwd } : {}),
  });
  return render(jsonFlag(args), {
    command: "work specify",
    outcome: result.outcome,
    workItemId,
    specificationId: result.specification.id,
    acceptanceCriteria: result.specification.acceptanceCriteria.length,
    openQuestions: result.specification.openQuestions,
  });
}

export function runWorkItemExploration(args: readonly string[], cwd: string): { stdout: string; exitCode: number } {
  const positional = barePositional(args);
  if (args.includes("--plan") || args.includes("--spec") || args.includes("--task") || positional) {
    throw new WorkCliError("Path mode and work-item mode cannot be combined.", 2);
  }
  const workItemId = flag(args, "--work-item");
  if (!workItemId) throw new WorkCliError("Option --work-item requires a value.", 2);
  rejectMixed(args, ["--work-item", "--json"]);
  const workspace = resolveWorkspace(cwd, undefined, process.env.AZEVEDO_WORKSPACE);
  try {
    const result = exploreWorkItem({ workspace, workItemId });
    return {
      stdout: render(jsonFlag(args), {
        command: "explore",
        outcome: result.outcome,
        workItemId,
        repositories: result.pointer.repositories.map((repository) => ({
          repositoryId: repository.repositoryId,
          relevance: repository.relevance,
          explorationId: repository.explorationId,
        })),
      }),
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof WorkItemError) throw new WorkCliError(error.message, 1);
    throw error;
  }
}

export function runWorkItemPlan(args: readonly string[], cwd: string): { stdout: string; exitCode: number } {
  const positional = barePositional(args);
  if (args.includes("--task") || positional) {
    throw new WorkCliError("Path mode and work-item mode cannot be combined.", 2);
  }
  const workItemId = flag(args, "--work-item");
  if (!workItemId) throw new WorkCliError("Option --work-item requires a value.", 2);
  rejectMixed(args, ["--work-item", "--json"]);
  const workspace = resolveWorkspace(cwd, undefined, process.env.AZEVEDO_WORKSPACE);
  try {
    const result = planWorkItem({ workspace, workItemId });
    return {
      stdout: render(jsonFlag(args), {
        command: "plan",
        outcome: result.outcome,
        reason: result.reason,
        statement: result.statement,
        workItemId,
        coordinatedPlanId: result.coordinatedPlanId,
        repositories: result.pointer.repositories.map((repository) => ({
          repositoryId: repository.repositoryId,
          relevance: repository.relevance.state,
          repositoryPlanId: repository.repositoryPlanId,
        })),
      }),
      exitCode: result.outcome === "blocked" ? 1 : 0,
    };
  } catch (error) {
    if (error instanceof WorkItemError) throw new WorkCliError(error.message, 1);
    throw error;
  }
}

function rejectMixed(args: readonly string[], allowed: readonly string[]): void {
  for (const token of args) {
    if (!token.startsWith("--")) continue;
    if (!allowed.includes(token)) throw new WorkCliError(`Unknown option: ${token}`, 2);
  }
}

function render(json: boolean, value: unknown): string {
  if (json) return `${JSON.stringify(value, null, 2)}\n`;
  const record = value as { command: string; outcome: string; statement?: string; workItemId?: string };
  const id = "workItemId" in (value as object) ? (value as { workItemId?: string }).workItemId : undefined;
  return `${record.command}: ${record.outcome}${id ? ` ${id}` : ""}${record.statement ? `\n${record.statement}` : ""}\n`;
}
