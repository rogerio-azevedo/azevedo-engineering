import { constants, accessSync, realpathSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createCodexInitializationArtifacts } from "../adapters/codex/create-init-artifacts.js";
import { createCoreInitializationArtifacts } from "../core/initialization/artifacts.js";
import { applyInitPlan } from "../core/initialization/init-apply.js";
import { buildInitPlan } from "../core/initialization/init-plan.js";
import { createInitReport } from "../core/initialization/init-report.js";
import { createInspectResult } from "../core/inspection/inspect-result.js";
import { renderHumanInspection } from "./render-inspection.js";
import { renderHumanInitialization } from "./render-initialization.js";

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

Commands:
  inspect    Inspect a project without modifying it
  init       Safely initialize Azevedo Engineering in a recognized project

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

type InspectArguments = {
  help: boolean;
  json: boolean;
  path: string;
};

type InitArguments = InspectArguments & {
  dryRun: boolean;
};

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

    if (command !== "inspect" && command !== "init") {
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
