/**
 * Where the server writes what it has to say. The process entry passes the console;
 * tests pass a logger that keeps the lines.
 */
export interface Logger {
  info(line: string): void;
  warn(line: string): void;
  error(line: string, error?: unknown): void;
}

export const consoleLogger: Logger = {
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line, error) => {
    if (error === undefined) console.error(line);
    else console.error(line, error);
  },
};

/** A logger that says nothing. */
export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** A logger that keeps what it is told, for tests. */
export function memoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (line) => void lines.push(line),
    warn: (line) => void lines.push(line),
    error: (line, error) =>
      void lines.push(error instanceof Error ? `${line} ${error.message}` : line),
  };
}

/**
 * What may be logged of an error. An error of a database query is logged by its name
 * and code only, with a fixed sentence and no stack, so that no parameter of the query
 * and no value the database quotes reaches a log. Any other error is logged as it is.
 */
export function safeError(error: unknown): unknown {
  if (!isQueryError(error)) return error;
  const name = error instanceof Error ? error.name : 'Error';
  const code = codeOf(error);
  const safe = new Error(
    code === null ? 'A database query failed.' : `A database query failed with code ${code}.`,
  );
  safe.name = name;
  safe.stack = `${name}: ${safe.message}`;
  return safe;
}
