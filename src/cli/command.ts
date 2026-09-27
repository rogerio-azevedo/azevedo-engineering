import { constants, accessSync, lstatSync, readFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { createCodexInitializationArtifacts } from "../adapters/codex/create-init-artifacts.js";
import { createCoreInitializationArtifacts } from "../core/initialization/artifacts.js";
import { applyInitPlan } from "../core/initialization/init-apply.js";
import { buildInitPlan } from "../core/initialization/init-plan.js";
import { createInitReport } from "../core/initialization/init-report.js";
import { createInspectResult } from "../core/inspection/inspect-result.js";
import { exploreProject } from "../core/exploration/explore-project.js";
import {
  applyExplorationArtifactOperation,
  buildExplorationArtifactOperation,
} from "../core/exploration/exploration-persistence.js";
import { ExplorationArtifactSchema } from "../core/exploration/exploration-artifact.js";
import { buildEngineeringPlan, EngineeringPlanSchema } from "../core/planning/engineering-plan.js";
import { validateInitializedProject } from "../core/planning/initialized-project.js";
import {
  applyPlanArtifactOperation,
  buildPlanArtifactOperation,
  createPlanCommandReport,
} from "../core/planning/plan-persistence.js";
import {
  applyPlanRevisionArtifactOperation,
  buildPlanRevisionArtifactOperation,
} from "../core/planning/plan-revision-persistence.js";
import { EngineeringPlanRevisionSchema } from "../core/planning/plan-revision.js";
import { loadExecutionInputs } from "../core/execution/execution-loader.js";
import { captureProjectCheckpoint } from "../core/execution/project-checkpoint.js";
import { prepareExecution } from "../core/execution/prepare-execution.js";
import {
  applyExecutionArtifactOperations,
  buildExecutionArtifactOperations,
  nextExecutionSequence,
} from "../core/execution/execution-persistence.js";
import {
  createTaskSpecification,
  FeatureSpecificationSchema,
  parseFeatureSpecification,
  type FeatureSpecification,
} from "../core/specification/feature-specification.js";
import {
  applySpecificationArtifactOperation,
  buildSpecificationArtifactOperation,
} from "../core/specification/specification-persistence.js";
import { renderHumanExploration } from "./render-exploration.js";
import { renderHumanInspection } from "./render-inspection.js";
import { renderHumanInitialization } from "./render-initialization.js";
import { renderHumanPlan } from "./render-plan.js";

export const EXIT_SUCCESS = 0;
export const EXIT_OPERATIONAL_ERROR = 1;
export const EXIT_INVALID_USAGE = 2;

export type CliIo = {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
};

export type CliOptions = {
  cwd: string;
  version: string;
};

class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: typeof EXIT_OPERATIONAL_ERROR | typeof EXIT_INVALID_USAGE,
  ) {
    super(message);
  }
}

const GENERAL_HELP = `Usage:
  azevedo inspect [path] [--json]
  azevedo init [path] [--dry-run] [--json]
  azevedo plan [path] --task <task> [--json]
  azevedo explore [path] --plan <plan-id> [--spec <file>] [--dry-run] [--json]
  azevedo execute [path] --revision <revision-id> --prepare [--authorize-isolated-write] [--context-budget <tokens>] [--dry-run] [--json]

Commands:
  inspect    Inspect a project without modifying it
  init       Safely initialize Azevedo Engineering in a recognized project
  plan       Create a deterministic engineering plan for an initialized project
  explore    Build evidence-backed implementation context without executing the plan
  execute    Prepare a bounded execution session; never invokes a coding provider

Options:
  --help     Show help
  --version  Show version
`;

const INSPECT_HELP = `Usage:
  azevedo inspect [path] [--json]

Arguments:
  path       Project directory (default: current directory)

Options:
  --json     Output machine-readable JSON
  --help     Show help
`;

const INIT_HELP = `Usage:
  azevedo init [path] [--dry-run] [--json]

Arguments:
  path       Project or project-group directory (default: current directory)

Options:
  --dry-run  Plan and validate without writing files
  --json     Output machine-readable JSON
  --help     Show help
`;

const PLAN_HELP = `Usage:
  azevedo plan [path] --task <task> [--json]

Arguments:
  path       Initialized project directory (default: current directory)

Options:
  --task     Required engineering task description
  --json     Output machine-readable JSON
  --help     Show help
`;

const EXPLORE_HELP = `Usage:
  azevedo explore [path] --plan <plan-id> [--spec <file>] [--dry-run] [--json]

Arguments:
  path       Initialized project directory (default: current directory)

Options:
  --plan     Required deterministic plan id
  --spec     Optional JSON specification input; defaults to the plan task
  --dry-run  Explore and validate without writing artifacts
  --json     Output machine-readable JSON
  --help     Show help
`;

const EXECUTE_HELP = `Usage:
  azevedo execute [path] --revision <revision-id> --prepare [--authorize-isolated-write] [--context-budget <tokens>] [--dry-run] [--json]

Arguments:
  path                        Initialized project directory (default: current directory)

Options:
  --revision                  Required immutable plan revision id
  --prepare                   Required read/prepare mode; source code is never mutated
  --authorize-isolated-write  Record explicit permission for a later agent in a linked worktree
  --context-budget            Explicit maximum context tokens; omitted uses 6000 or expands to preserve required core
  --dry-run                   Evaluate and show artifacts without writing even harness state
  --json                      Output machine-readable JSON
  --help                      Show help
`;

type InspectArguments = {
  help: boolean;
  json: boolean;
  path: string;
};

type InitArguments = InspectArguments & {
  dryRun: boolean;
};

type PlanArguments = InspectArguments & {
  task: string | undefined;
};

type ExploreArguments = InspectArguments & {
  planId: string | undefined;
  specificationPath: string | undefined;
  dryRun: boolean;
};

type ExecuteArguments = InspectArguments & {
  revisionId: string | undefined;
  prepare: boolean;
  authorizeIsolatedWrite: boolean;
  contextBudget: number | undefined;
  dryRun: boolean;
};

const ExploreOperationReportSchema = z.object({
  action: z.enum(["create", "unchanged", "conflict"]),
  artifact: z.string().min(1),
  reason: z.string().min(1).optional(),
}).strict();

export const ExploreCommandReportSchema = z.object({
  schemaVersion: z.literal(1),
  outcome: z.enum(["created", "unchanged", "conflict", "dry-run"]),
  dryRun: z.boolean(),
  specification: FeatureSpecificationSchema,
  exploration: ExplorationArtifactSchema,
  revision: EngineeringPlanRevisionSchema.nullable(),
  operations: z.array(ExploreOperationReportSchema).min(2),
}).strict();

export type ExploreCommandReport = z.infer<typeof ExploreCommandReportSchema>;

function parseInspectArguments(args: readonly string[]): InspectArguments {
  let help = false;
  let json = false;
  let projectPath: string | undefined;

  for (const argument of args) {
    if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument === "--json") {
      json = true;
    } else if (argument.startsWith("-")) {
      throw new CliError(`Unknown option: ${argument}`, EXIT_INVALID_USAGE);
    } else if (projectPath !== undefined) {
      throw new CliError(`Unexpected argument: ${argument}`, EXIT_INVALID_USAGE);
    } else {
      projectPath = argument;
    }
  }

  return { help, json, path: projectPath ?? "." };
}

function parseInitArguments(args: readonly string[]): InitArguments {
  let help = false;
  let json = false;
  let dryRun = false;
  let projectPath: string | undefined;

  for (const argument of args) {
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--json") json = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (argument.startsWith("-")) throw new CliError(`Unknown option: ${argument}`, EXIT_INVALID_USAGE);
    else if (projectPath !== undefined) throw new CliError(`Unexpected argument: ${argument}`, EXIT_INVALID_USAGE);
    else projectPath = argument;
  }

  return { help, json, dryRun, path: projectPath ?? "." };
}

function parsePlanArguments(args: readonly string[]): PlanArguments {
  let help = false;
  let json = false;
  let projectPath: string | undefined;
  let task: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--json") json = true;
    else if (argument === "--task") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliError("Option --task requires a non-empty value.", EXIT_INVALID_USAGE);
      }
      if (task !== undefined) throw new CliError("Option --task may only be provided once.", EXIT_INVALID_USAGE);
      task = value.trim();
      index += 1;
    } else if (argument?.startsWith("-")) throw new CliError(`Unknown option: ${argument}`, EXIT_INVALID_USAGE);
    else if (projectPath !== undefined) throw new CliError(`Unexpected argument: ${argument}`, EXIT_INVALID_USAGE);
    else projectPath = argument;
  }

  if (!help && !task) throw new CliError("Option --task is required and must not be empty.", EXIT_INVALID_USAGE);
  return { help, json, path: projectPath ?? ".", task };
}

function parseExploreArguments(args: readonly string[]): ExploreArguments {
  let help = false;
  let json = false;
  let dryRun = false;
  let projectPath: string | undefined;
  let planId: string | undefined;
  let specificationPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--json") json = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--plan" || argument === "--spec") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`Option ${argument} requires a value.`, EXIT_INVALID_USAGE);
      if (argument === "--plan") {
        if (planId !== undefined) throw new CliError("Option --plan may only be provided once.", EXIT_INVALID_USAGE);
        planId = value;
      } else {
        if (specificationPath !== undefined) throw new CliError("Option --spec may only be provided once.", EXIT_INVALID_USAGE);
        specificationPath = value;
      }
      index += 1;
    } else if (argument?.startsWith("-")) throw new CliError(`Unknown option: ${argument}`, EXIT_INVALID_USAGE);
    else if (projectPath !== undefined) throw new CliError(`Unexpected argument: ${argument}`, EXIT_INVALID_USAGE);
    else projectPath = argument;
  }
  if (!help && !planId) throw new CliError("Option --plan is required.", EXIT_INVALID_USAGE);
  if (planId && !/^plan-[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{8}$/.test(planId)) {
    throw new CliError("Option --plan must be a deterministic plan id.", EXIT_INVALID_USAGE);
  }
  return { help, json, dryRun, path: projectPath ?? ".", planId, specificationPath };
}

function parseExecuteArguments(args: readonly string[]): ExecuteArguments {
  let help = false;
  let json = false;
  let prepare = false;
  let dryRun = false;
  let authorizeIsolatedWrite = false;
  let projectPath: string | undefined;
  let revisionId: string | undefined;
  let contextBudget: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--json") json = true;
    else if (argument === "--prepare") prepare = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--authorize-isolated-write") authorizeIsolatedWrite = true;
    else if (argument === "--revision" || argument === "--context-budget") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new CliError(`Option ${argument} requires a value.`, EXIT_INVALID_USAGE);
      if (argument === "--revision") {
        if (revisionId) throw new CliError("Option --revision may only be provided once.", EXIT_INVALID_USAGE);
        revisionId = value;
      } else {
        const parsedBudget = Number(value);
        if (!Number.isInteger(parsedBudget) || parsedBudget < 500) {
          throw new CliError("Option --context-budget must be an integer of at least 500.", EXIT_INVALID_USAGE);
        }
        contextBudget = parsedBudget;
      }
      index += 1;
    } else if (argument?.startsWith("-")) throw new CliError(`Unknown option: ${argument}`, EXIT_INVALID_USAGE);
    else if (projectPath !== undefined) throw new CliError(`Unexpected argument: ${argument}`, EXIT_INVALID_USAGE);
    else projectPath = argument;
  }
  if (!help && !revisionId) throw new CliError("Option --revision is required.", EXIT_INVALID_USAGE);
  if (!help && !prepare) throw new CliError("Option --prepare is required in v0.6.", EXIT_INVALID_USAGE);
  if (revisionId && !/^plan-revision-[1-9][0-9]*-[a-f0-9]{8}$/.test(revisionId)) {
    throw new CliError("Option --revision must be an immutable plan revision id.", EXIT_INVALID_USAGE);
  }
  return { help, json, prepare, authorizeIsolatedWrite, contextBudget, dryRun, path: projectPath ?? ".", revisionId };
}

function renderExecutionPreparation(result: ReturnType<typeof prepareExecution>, operations: readonly { action: string; artifact: string }[], dryRun: boolean): string {
  const readiness = result.preparation.readiness;
  return [
    "Execution preparation",
    `  Status: ${readiness.status}`,
    `  Mode: ${dryRun ? "dry-run" : "persist harness artifacts only"}`,
    `  Write authorization: ${result.preparation.writeAuthorized ? "isolated-worktree-only" : "denied"}`,
    `  Mutation authorization: ${result.preparation.mutationAuthorized ? "granted" : `denied (${result.preparation.authorizationReasons.join(", ") || "none"})`}`,
    `  Context budget: ${result.preparation.contextBudget.estimatedTokens}/${result.preparation.contextBudget.maxEstimatedTokens} (${result.preparation.contextBudget.selectionReason}; core ${result.preparation.contextBudget.requiredCoreEstimatedTokens})`,
    `  Context: ${result.preparation.contextId ?? "not produced"}`,
    `  Session: ${result.preparation.sessionId ?? "not produced"}`,
    "  Reasons:",
    ...(readiness.reasons.length > 0
      ? readiness.reasons.map((reason) => `    ${reason.blocking ? "BLOCK" : "INFO"} ${reason.code}: ${reason.message}`)
      : ["    none"]),
    "  Artifacts:",
    ...operations.map((operation) => `    ${operation.action}: ${operation.artifact}`),
    result.instructions ? "\nPrepared agent instructions:\n" + result.instructions : "",
  ].join("\n") + "\n";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveProjectRoot(projectPath: string, cwd: string): string {
  const candidate = resolve(cwd, projectPath);
  let stats;

  try {
    stats = statSync(candidate);
  } catch (error) {
    throw new CliError(`Project path cannot be accessed: ${candidate} (${describeError(error)})`, EXIT_OPERATIONAL_ERROR);
  }

  if (!stats.isDirectory()) {
    throw new CliError(`Project path is not a directory: ${candidate}`, EXIT_OPERATIONAL_ERROR);
  }

  try {
    accessSync(candidate, constants.R_OK);
    readdirSync(candidate);
    return realpathSync(candidate);
  } catch (error) {
    throw new CliError(`Project directory cannot be read: ${candidate} (${describeError(error)})`, EXIT_OPERATIONAL_ERROR);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value !== ".." && !value.startsWith(`..${sep}`) && resolve(root, value) === candidate;
}

function readPlan(root: string, planId: string) {
  const path = join(root, ".azevedo", "plans", `${planId}.json`);
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile() || !isWithin(root, realpathSync(path))) {
    throw new Error(`Plan artifact is not a safe regular file: .azevedo/plans/${planId}.json`);
  }
  const plan: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = EngineeringPlanSchema.parse(plan);
  if (parsed.id !== planId) throw new Error("Plan id does not match the requested artifact.");
  return parsed;
}

function readSpecification(specificationPath: string, cwd: string): FeatureSpecification {
  const path = resolve(cwd, specificationPath);
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`Specification input is not a safe regular file: ${path}`);
  return parseFeatureSpecification(JSON.parse(readFileSync(path, "utf8")));
}

function operationReport(operation: { action: string; artifact: string; reason?: string }) {
  return ExploreOperationReportSchema.parse({
    action: operation.action,
    artifact: operation.artifact,
    ...(operation.reason ? { reason: operation.reason } : {}),
  });
}

export function runCli(
  argv: readonly string[],
  io: CliIo,
  options: CliOptions,
): number {
  try {
    const [command, ...commandArguments] = argv;

    if (command === undefined || command === "--help" || command === "-h") {
      if (commandArguments.length > 0) {
        throw new CliError(`Unexpected argument: ${commandArguments[0]}`, EXIT_INVALID_USAGE);
      }
      io.stdout(GENERAL_HELP);
      return EXIT_SUCCESS;
    }

    if (command === "--version") {
      if (commandArguments.length > 0) {
        throw new CliError(`Unexpected argument: ${commandArguments[0]}`, EXIT_INVALID_USAGE);
      }
      io.stdout(`${options.version}\n`);
      return EXIT_SUCCESS;
    }

    if (command !== "inspect" && command !== "init" && command !== "plan" && command !== "explore" && command !== "execute") {
      throw new CliError(`Unknown command: ${command}`, EXIT_INVALID_USAGE);
    }

    if (command === "inspect") {
      const inspectArguments = parseInspectArguments(commandArguments);
      if (inspectArguments.help) {
        io.stdout(INSPECT_HELP);
        return EXIT_SUCCESS;
      }

      const root = resolveProjectRoot(inspectArguments.path, options.cwd);
      let result;
      try {
        result = createInspectResult(root);
      } catch (error) {
        throw new CliError(`Inspection failed for ${root}: ${describeError(error)}`, EXIT_OPERATIONAL_ERROR);
      }

      io.stdout(inspectArguments.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderHumanInspection(result));
      return EXIT_SUCCESS;
    }

    if (command === "plan") {
      const planArguments = parsePlanArguments(commandArguments);
      if (planArguments.help) {
        io.stdout(PLAN_HELP);
        return EXIT_SUCCESS;
      }

      const root = resolveProjectRoot(planArguments.path, options.cwd);
      try {
        const inspection = createInspectResult(root);
        if (inspection.kind === "project-group") {
          const choices = inspection.projects.map((project) => `  ${project.relativePath}`).join("\n");
          throw new Error(
            `Target is a project group with ${inspection.projects.length} projects.\n` +
            `Choose a project:\n${choices}\nRun plan against the specific project path.`,
          );
        }
        if (inspection.topology.state === "unknown") {
          throw new Error("There is not enough evidence of a recognizable project to build a plan.");
        }
        validateInitializedProject(root);
        const plan = buildEngineeringPlan(inspection, planArguments.task ?? "");
        const operation = buildPlanArtifactOperation(root, plan);
        if (operation.action === "create") applyPlanArtifactOperation(root, operation);
        const report = createPlanCommandReport(plan, operation);
        io.stdout(planArguments.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : renderHumanPlan(report));
        return report.outcome === "conflict" ? EXIT_OPERATIONAL_ERROR : EXIT_SUCCESS;
      } catch (error) {
        throw new CliError(`Planning failed for ${root}: ${describeError(error)}`, EXIT_OPERATIONAL_ERROR);
      }
    }

    if (command === "explore") {
      const exploreArguments = parseExploreArguments(commandArguments);
      if (exploreArguments.help) {
        io.stdout(EXPLORE_HELP);
        return EXIT_SUCCESS;
      }
      const root = resolveProjectRoot(exploreArguments.path, options.cwd);
      try {
        const inspection = createInspectResult(root);
        if (inspection.kind === "project-group") throw new Error("Exploration requires one concrete project, not a project group.");
        if (inspection.topology.state === "unknown") throw new Error("There is not enough evidence of a recognizable project to explore.");
        validateInitializedProject(root);
        const plan = readPlan(root, exploreArguments.planId ?? "");
        const specification = exploreArguments.specificationPath
          ? readSpecification(exploreArguments.specificationPath, options.cwd)
          : createTaskSpecification(plan);
        const result = exploreProject(root, inspection, plan, specification);
        const specificationOperation = buildSpecificationArtifactOperation(root, specification);
        const explorationOperation = buildExplorationArtifactOperation(root, result.artifact);
        const revisionOperation = result.revision ? buildPlanRevisionArtifactOperation(root, result.revision) : null;
        const operations = [specificationOperation, explorationOperation, ...(revisionOperation ? [revisionOperation] : [])];
        const conflict = operations.find((operation) => operation.action === "conflict");
        if (!exploreArguments.dryRun && !conflict) {
          applySpecificationArtifactOperation(root, specificationOperation);
          applyExplorationArtifactOperation(root, explorationOperation);
          if (revisionOperation) applyPlanRevisionArtifactOperation(root, revisionOperation);
        }
        const outcome = exploreArguments.dryRun
          ? "dry-run" as const
          : conflict ? "conflict" as const
            : operations.some((operation) => operation.action === "create") ? "created" as const : "unchanged" as const;
        const report = ExploreCommandReportSchema.parse({
          schemaVersion: 1,
          outcome,
          dryRun: exploreArguments.dryRun,
          specification,
          exploration: result.artifact,
          revision: result.revision,
          operations: operations.map(operationReport),
        });
        io.stdout(exploreArguments.json ? `${JSON.stringify(report, null, 2)}\n` : renderHumanExploration(report));
        return conflict ? EXIT_OPERATIONAL_ERROR : EXIT_SUCCESS;
      } catch (error) {
        throw new CliError(`Exploration failed for ${root}: ${describeError(error)}`, EXIT_OPERATIONAL_ERROR);
      }
    }

    if (command === "execute") {
      const executeArguments = parseExecuteArguments(commandArguments);
      if (executeArguments.help) {
        io.stdout(EXECUTE_HELP);
        return EXIT_SUCCESS;
      }
      const root = resolveProjectRoot(executeArguments.path, options.cwd);
      try {
        const inspection = createInspectResult(root);
        if (inspection.kind === "project-group") throw new Error("Execution requires one concrete project, not a project group.");
        if (inspection.topology.state === "unknown") throw new Error("There is not enough evidence of a recognizable project to execute.");
        validateInitializedProject(root);
        const artifacts = loadExecutionInputs(root, executeArguments.revisionId ?? "");
        const result = prepareExecution({
          inspection,
          ...artifacts,
          checkpoint: captureProjectCheckpoint(root),
          executionSequence: nextExecutionSequence(root),
          writeAuthorized: executeArguments.authorizeIsolatedWrite,
          requireIsolation: true,
          ...(executeArguments.contextBudget === undefined ? {} : { maxContextTokens: executeArguments.contextBudget }),
        });
        const operations = buildExecutionArtifactOperations(root, result.preparation, result.context, result.session);
        if (!executeArguments.dryRun) applyExecutionArtifactOperations(root, operations);
        io.stdout(executeArguments.json
          ? `${JSON.stringify({ ...result, dryRun: executeArguments.dryRun, operations }, null, 2)}\n`
          : renderExecutionPreparation(result, operations, executeArguments.dryRun));
        return result.preparation.readiness.status === "ready" ? EXIT_SUCCESS : EXIT_OPERATIONAL_ERROR;
      } catch (error) {
        throw new CliError(`Execution preparation failed for ${root}: ${describeError(error)}`, EXIT_OPERATIONAL_ERROR);
      }
    }

    const initArguments = parseInitArguments(commandArguments);
    if (initArguments.help) {
      io.stdout(INIT_HELP);
      return EXIT_SUCCESS;
    }
    const root = resolveProjectRoot(initArguments.path, options.cwd);
    try {
      const inspection = createInspectResult(root);
      const artifacts = [
        ...createCoreInitializationArtifacts("codex"),
        ...createCodexInitializationArtifacts(),
      ];
      const plan = buildInitPlan(inspection, artifacts);
      if (!initArguments.dryRun && !plan.blocked) applyInitPlan(plan);
      const report = createInitReport(plan, initArguments.dryRun);
      io.stdout(initArguments.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderHumanInitialization(report));
      return report.blocked ? EXIT_OPERATIONAL_ERROR : EXIT_SUCCESS;
    } catch (error) {
      throw new CliError(`Initialization failed for ${root}: ${describeError(error)}`, EXIT_OPERATIONAL_ERROR);
    }
  } catch (error) {
    const cliError = error instanceof CliError
      ? error
      : new CliError(describeError(error), EXIT_OPERATIONAL_ERROR);
    io.stderr(`Error: ${cliError.message}\n`);
    if (cliError.exitCode === EXIT_INVALID_USAGE) {
      io.stderr("Run 'azevedo --help' for usage.\n");
    }
    return cliError.exitCode;
  }
}
