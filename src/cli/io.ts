/**
 * The CLI's whole contact with the outside world. Everything else in
 * `src/cli` is pure: it takes an argv and a `CliIo` and returns an exit
 * code, which is what makes the commands testable in-process without
 * spawning a shell or touching the disk.
 */
export interface CliIo {
  /** Write to standard output. Newlines are the caller's business. */
  out(text: string): void;
  /** Write to standard error. */
  err(text: string): void;
  /** Read a UTF-8 text file; throws when it cannot be read. */
  readFile(path: string): string;
  /** Write a UTF-8 text file, creating parent directories. */
  writeFile(path: string, data: string): void;
}
