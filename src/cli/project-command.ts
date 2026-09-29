import { resolve } from "node:path";
import { buildProjectContext } from "../core/project/project-context.js";
import { onboardProject, type OnboardReport } from "../core/project/onboard-project.js";
import { listProjectIds, loadProject } from "../core/project/registry.js";
import { resolveWorkspace } from "../core/project/workspace.js";
import { renderHumanOnboard, renderHumanProjectContext, renderHumanProjectList } from "./render-project.js";

export class ProjectCliError extends Error {
  constructor(message: string, readonly exitCode: 1 | 2) {
    super(message);
    this.name = "ProjectCliError";
  }
}

const PROJECT_HELP = `Usage:
  azevedo project onboard <path> [--name <name>] [--project-id <id>] [--workspace <dir>] [--dry-run] [--json]
  azevedo project list [--workspace <dir>] [--json]
  azevedo project inspect <project-id> [--workspace <dir>] [--json]

Commands:
  onboard    Read an external project and persist a project profile in the Azevedo workspace
  list       List known projects in the workspace registry
  inspect    Build current project context and revalidate stored facts

Options:
  --name         Display name recorded on first onboarding
  --project-id   Explicit stable id, assigned once
  --workspace    Azevedo workspace that owns var/projects
  --dry-run      Discover and validate without writing the registry
  --json         Output machine-readable JSON
  --help         Show help
`;

type Flags = {
  help: boolean;
  json: boolean;
  dryRun: boolean;
  name: string | undefined;
  projectId: string | undefined;
  workspace: string | undefined;
  positionals: string[];
};

function parseFlags(args: readonly string[]): Flags {
  const parsed: Flags = {
    help: false,
    json: false,
    dryRun: false,
    name: undefined,
    projectId: undefined,
    workspace: undefined,
    positionals: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;
    if (token === "--help" || token === "-h") parsed.help = true;
    else if (token === "--json") parsed.json = true;
    else if (token === "--dry-run") parsed.dryRun = true;
    else if (token === "--name" || token === "--project-id" || token === "--workspace") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new ProjectCliError(`Missing value for ${token}`, 2);
      if (token === "--name") parsed.name = value;
      if (token === "--project-id") parsed.projectId = value;
      if (token === "--workspace") parsed.workspace = value;
      index += 1;
    } else if (token.startsWith("--")) throw new ProjectCliError(`Unknown option: ${token}`, 2);
    else parsed.positionals.push(token);
  }
  return parsed;
}

function workspaceFrom(cwd: string, explicit: string | undefined): string {
  return resolveWorkspace(cwd, explicit, process.env.AZEVEDO_WORKSPACE);
}

export function runProjectCli(args: readonly string[], cwd: string): { stdout: string; exitCode: number } {
  const [subcommand, ...rest] = args;
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    if (rest.length > 0) throw new ProjectCliError(`Unexpected argument: ${rest[0]}`, 2);
    return { stdout: PROJECT_HELP, exitCode: 0 };
  }
  if (subcommand !== "onboard" && subcommand !== "list" && subcommand !== "inspect") {
    throw new ProjectCliError(`Unknown project command: ${subcommand}`, 2);
  }
  const flags = parseFlags(rest);
  if (flags.help) return { stdout: PROJECT_HELP, exitCode: 0 };
  if (subcommand === "list") {
    if (flags.positionals.length > 0) throw new ProjectCliError(`Unexpected argument: ${flags.positionals[0]}`, 2);
    if (flags.dryRun || flags.name || flags.projectId) throw new ProjectCliError("list does not accept onboard options", 2);
    const workspace = workspaceFrom(cwd, flags.workspace);
    const projects = listProjectIds(workspace).map((projectId) => {
      const loaded = loadProject(workspace, projectId);
      return { projectId, name: loaded.definition.name, snapshotId: loaded.snapshot.id };
    });
    const payload = { schemaVersion: 1 as const, registryRoot: `${workspace}/var`, projects };
    return { stdout: flags.json ? `${JSON.stringify(payload, null, 2)}\n` : renderHumanProjectList(projects), exitCode: 0 };
  }
  if (subcommand === "inspect") {
    if (flags.positionals.length !== 1) throw new ProjectCliError("project inspect requires a project id", 2);
    if (flags.dryRun || flags.name || flags.projectId) throw new ProjectCliError("inspect does not accept onboard options", 2);
    const workspace = workspaceFrom(cwd, flags.workspace);
    const context = buildProjectContext(workspace, flags.positionals[0] ?? "");
    return { stdout: flags.json ? `${JSON.stringify(context, null, 2)}\n` : renderHumanProjectContext(context), exitCode: 0 };
  }
  if (flags.positionals.length !== 1) throw new ProjectCliError("project onboard requires a target path", 2);
  const workspace = workspaceFrom(cwd, flags.workspace);
  const report: OnboardReport = onboardProject({
    workspace,
    target: resolve(cwd, flags.positionals[0] ?? "."),
    ...(flags.name ? { name: flags.name } : {}),
    ...(flags.projectId ? { projectId: flags.projectId } : {}),
    ...(flags.dryRun ? { dryRun: true } : {}),
  });
  return {
    stdout: flags.json ? `${JSON.stringify(report, null, 2)}\n` : renderHumanOnboard(report),
    exitCode: report.outcome === "blocked" ? 1 : 0,
  };
}
