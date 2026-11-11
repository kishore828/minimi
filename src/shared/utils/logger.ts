/**
 * Minimal structured JSON logger. One line per event so logs are greppable.
 * Callers must never pass message content or secrets — only metadata such as
 * lengths, counts and durations.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  base: Record<string, unknown> = {},
  options: { level?: LogLevel } = {},
): Logger {
  const minWeight = LEVEL_WEIGHT[options.level ?? "info"];

  const write = (level: LogLevel, event: string, data?: Record<string, unknown>) => {
    if (LEVEL_WEIGHT[level] < minWeight) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...base,
      ...data,
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (event, data) => write("debug", event, data),
    info: (event, data) => write("info", event, data),
    warn: (event, data) => write("warn", event, data),
    error: (event, data) => write("error", event, data),
    child: (bindings) => createLogger({ ...base, ...bindings }, options),
  };
}
