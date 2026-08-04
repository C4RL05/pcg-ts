/** Base class of all graph runtime errors. */
export class GraphError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GraphError";
  }
}

/**
 * Invalid graph construction or use: unknown nodes or pins, pin kind
 * mismatch, duplicate connections on single pins, duplicate ids/names.
 */
export class GraphValidationError extends GraphError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GraphValidationError";
  }
}

/** A connection would create (or a traversal found) a cycle. */
export class GraphCycleError extends GraphError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GraphCycleError";
  }
}

/**
 * A cook was aborted via its AbortSignal. Completed nodes keep their
 * caches, so a re-cook resumes where the cancelled one left off.
 */
export class CookCancelledError extends GraphError {
  constructor(message = "cook cancelled") {
    super(message);
    this.name = "CookCancelledError";
  }
}

/** A node's execute threw; wraps the cause and records the node id. */
export class NodeExecutionError extends GraphError {
  /** Id of the node instance whose execute failed. */
  readonly nodeId: string;

  constructor(nodeId: string, cause: unknown, message?: string) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(message ?? `node "${nodeId}" failed: ${detail}`, { cause });
    this.name = "NodeExecutionError";
    this.nodeId = nodeId;
  }
}
