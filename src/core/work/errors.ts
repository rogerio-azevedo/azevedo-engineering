export class WorkItemError extends Error {
  constructor(
    message: string,
    readonly code: "conflict" | "blocked" | "operational" = "operational",
  ) {
    super(message);
    this.name = "WorkItemError";
  }
}
