/**
 * A CLI-level failure that is not a misuse of the command line: an
 * unreadable file, invalid JSON, a graph with nothing to cook. Library
 * errors are never wrapped in this — they propagate with their own
 * message, verbatim, because naming the offending node, pin, or param is
 * the library's job and the CLI must not blur it.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}
