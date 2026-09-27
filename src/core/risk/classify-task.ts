import type { TaskClassification, TaskInput } from "../schemas/task.js";
import { TaskClassificationSchema, TaskInputSchema } from "../schemas/task.js";

const ARCHITECTURE_SIGNALS = new Set([
  "structural_dependency",
  "new_boundary",
  "new_package",
  "new_app",
  "integration",
  "persistence",
  "public_contract",
  "auth",
]);

const SECURITY_SIGNALS = new Set([
  "auth",
  "authorization",
  "credentials",
  "pii",
  "destructive_migration",
  "migration",
  "public_contract",
  "integration",
  "filesystem",
  "process_execution",
  "external_input",
  "file_upload",
  "external_url",
  "webhook",
  "serialization",
  "sensitive_logging",
  "dependency_permissions",
  "data_exposure",
]);

function inferTaskType(input: ReturnType<typeof TaskInputSchema.parse>): TaskClassification["type"] {
  if (input.type) return input.type;
  const paths = input.affectedPaths.map((path) => path.toLowerCase());
  const text = `${input.title} ${input.description}`.toLowerCase();

  if (paths.length > 0 && paths.every((path) => /(^|\/)(docs?\/|readme)|\.mdx?$/.test(path))) return "docs";
  if (paths.length > 0 && paths.every((path) => /\.(css|scss|sass|less)$/.test(path))) return "ui_style";
  if (/\b(auth|authorization|permission|credential|secret|security|autenticação|autorização|permissão|credencial|segredo|segurança)\b/.test(text)) return "security";
  if (/\b(architecture|boundary|new package|new app|integration strategy|arquitetura|fronteira|novo pacote|novo app|novo aplicativo|estratégia de integração)\b/.test(text)) return "architecture";
  if (
    /\b(dependency|upgrade package|add package|dependência|atualizar pacote|adicionar pacote)\b/.test(text) ||
    /\b(update|upgrade|atualizar)\s+(?:o\s+|a\s+)?prisma\b/.test(text)
  ) return "dependency_change";
  if (input.reproducibleBug || /\b(bug|regression|fix|defect|erro|falha|corrigir|defeito)\b/.test(text)) return "bugfix";
  if (/\b(refactor|rename|restructure|cleanup|refatorar|refatoração|renomear|reestruturar|limpeza)\b/.test(text)) return "refactor";
  if (/\b(feature|behavior|behaviour|business rule|regra de negócio|nova regra|comportamento|funcionalidade)\b/.test(text)) return "business_behavior";
  if (paths.some((path) => /(^|\/)(infra|config|deploy|terraform|\.github)(\/|$)/.test(path))) return "config_infra";
  return "general";
}

function inferTextSignals(text: string): TaskClassification["signals"] {
  const signals = new Set<TaskClassification["signals"][number]>();
  if (/\b(auth|authentication|autenticação)\b/i.test(text)) signals.add("auth");
  if (/\b(authorization|permission|autorização|permissão)\b/i.test(text)) signals.add("authorization");
  if (/\b(credential|secret|credencial|segredo)\b/i.test(text)) signals.add("credentials");
  if (/\b(public contract|public api|contrato público|api pública)\b/i.test(text)) signals.add("public_contract");
  if (/\b(migration|migração)\b/i.test(text)) signals.add("migration");
  if (/\b(user input|external input|untrusted input|entrada (?:do usuário|externa|não confiável))\b/i.test(text)) signals.add("external_input");
  if (/\b(file upload|upload(?: de)? arquivo|upload de arquivos|envio de arquivo)\b/i.test(text)) signals.add("file_upload");
  if (/\b(external url|remote url|url externa|url remota|ssrf)\b/i.test(text)) signals.add("external_url");
  if (/\b(webhook|callback endpoint|endpoint de callback)\b/i.test(text)) signals.add("webhook");
  if (/\b(deserializ(?:e|ation)|serializ(?:e|ation)|desserializa(?:r|ção)|serializa(?:r|ção))\b/i.test(text)) signals.add("serialization");
  if (/\b(sensitive log(?:ging)?|log(?:ar|ging)? (?:pii|dados sensíveis|credenciais?)|logs? sensíveis)\b/i.test(text)) signals.add("sensitive_logging");
  if (/\b(dependency permissions?|package permissions?|permissões? (?:da dependência|do pacote))\b/i.test(text)) signals.add("dependency_permissions");
  if (/\b(data exposure|data leak|exposição de dados|vazamento de dados)\b/i.test(text)) signals.add("data_exposure");
  return [...signals];
}

function inferPathSignals(paths: readonly string[]): TaskClassification["signals"] {
  const signals = new Set<TaskClassification["signals"][number]>();
  for (const rawPath of paths) {
    const path = rawPath.toLowerCase();
    if (/(^|\/)(auth|authentication|authorization|permissions?)(\/|\.|$)/.test(path)) signals.add("auth");
    if (/(^|\/)(migrations?|prisma\/migrations|drizzle)(\/|\.|$)/.test(path)) signals.add("migration");
    if (/(^|\/)(contracts?|openapi|public-api)(\/|\.|$)/.test(path)) signals.add("public_contract");
    if (/(^|\/)(uploads?|file-uploads?)(\/|\.|$)/.test(path)) signals.add("file_upload");
    if (/(^|\/)(webhooks?|callbacks?)(\/|\.|$)/.test(path)) signals.add("webhook");
    if (/(^|\/)(serializers?|deserializers?)(\/|\.|$)/.test(path)) signals.add("serialization");
  }
  return [...signals];
}

export function classifyTask(rawInput: TaskInput): TaskClassification {
  const input = TaskInputSchema.parse(rawInput);
  const type = inferTaskType(input);
  const pathSignals = inferPathSignals(input.affectedPaths);
  const textSignals = inferTextSignals(`${input.title} ${input.description}`);
  const signals = [...new Set([
    ...input.signals,
    ...pathSignals,
    ...textSignals,
  ])];
  const signalSet = new Set(signals);
  const authoritativeSignalSet = new Set([...input.signals, ...pathSignals]);
  const rationale: string[] = [];

  let risk: TaskClassification["risk"] = "normal";
  if (authoritativeSignalSet.has("credentials") || authoritativeSignalSet.has("destructive_migration")) {
    risk = "critical";
    rationale.push("Credentials or destructive data change can have irreversible impact.");
  } else if (
    type === "security" ||
    type === "architecture" ||
    signals.some((signal) => ARCHITECTURE_SIGNALS.has(signal) || SECURITY_SIGNALS.has(signal))
  ) {
    risk = "high-risk";
    rationale.push("The change crosses an architectural, security, data, or external contract boundary.");
  } else if (type === "docs" && signals.length === 0) {
    risk = "trivial";
    rationale.push("The change is limited to documentation and has no detected behavior risk.");
  } else {
    rationale.push("The change has ordinary product risk with no high-impact signal detected.");
  }

  const architectRequired =
    type === "architecture" || [...authoritativeSignalSet].some((signal) => ARCHITECTURE_SIGNALS.has(signal));
  const securityReviewRequired = type === "security" || signals.some((signal) => SECURITY_SIGNALS.has(signal));

  let tdd: TaskClassification["tdd"];
  if (type === "bugfix" && input.reproducibleBug) {
    tdd = { expectation: "required", reason: "A reproducible bug should be demonstrated by a failing regression test before the fix when technically reasonable." };
  } else if (type === "business_behavior") {
    tdd = { expectation: "required", reason: "New business behavior should normally be specified with a failing test first." };
  } else if (type === "general") {
    tdd = { expectation: "recommended", reason: "Use TDD when the task introduces observable behavior; record the final disposition." };
  } else if (type === "ui_style" || type === "config_infra" || type === "dependency_change") {
    tdd = { expectation: "domain_verification", reason: "Use a domain-appropriate visual, configuration, or infrastructure proof instead of an artificial RED test." };
  } else if (type === "docs") {
    tdd = { expectation: "not_applicable", reason: "Documentation-only changes do not require TDD." };
  } else if (type === "refactor") {
    tdd = { expectation: "not_applicable", reason: "A refactor preserves behavior; prove it with existing tests and add tests only for relevant gaps." };
  } else {
    tdd = { expectation: "recommended", reason: "Apply TDD when the concrete change adds behavior; do not create an artificial RED phase." };
  }

  const recommendedAgents: TaskClassification["recommendedAgents"] = [];
  if (risk === "high-risk" || risk === "critical") recommendedAgents.push("explorer");
  if (architectRequired) recommendedAgents.push("architect");
  if (risk !== "trivial") recommendedAgents.push("reviewer");
  if (securityReviewRequired) recommendedAgents.push("security-reviewer");

  return TaskClassificationSchema.parse({
    taskId: input.taskId,
    type,
    risk,
    signals,
    affectedPaths: input.affectedPaths,
    targetScopes: input.targetScopes,
    rationale,
    tdd,
    recommendedAgents: [...new Set(recommendedAgents)],
    architectRequired,
    securityReviewRequired,
  });
}
