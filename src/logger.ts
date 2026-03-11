import * as fs from "node:fs"
import * as path from "node:path"

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO ",
  [LogLevel.WARN]: "WARN ",
  [LogLevel.ERROR]: "ERROR",
}

export function parseLogLevel(s: string): LogLevel {
  switch (s.toLowerCase()) {
    case "debug":
      return LogLevel.DEBUG
    case "info":
      return LogLevel.INFO
    case "warn":
      return LogLevel.WARN
    case "error":
      return LogLevel.ERROR
    default:
      throw new Error(`Unknown log level: ${s}`)
  }
}

export interface Logger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string, err?: Error): void
  child(name: string): Logger
}

export interface LoggerOptions {
  name: string
  consoleLevel: LogLevel
  debugLogPath?: string
}

function formatTimestamp(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const MM = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const HH = String(now.getHours()).padStart(2, "0")
  const mm = String(now.getMinutes()).padStart(2, "0")
  const ss = String(now.getSeconds()).padStart(2, "0")
  const SSS = String(now.getMilliseconds()).padStart(3, "0")
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${SSS}`
}

function formatLine(level: LogLevel, name: string, message: string): string {
  return `${formatTimestamp()} ${LEVEL_LABELS[level]} [${name}] - ${message}`
}

export function createLogger(options: LoggerOptions): Logger {
  const { name, consoleLevel, debugLogPath } = options

  let debugLogReady = false
  if (debugLogPath) {
    const dir = path.dirname(debugLogPath)
    fs.mkdirSync(dir, { recursive: true })
    debugLogReady = true
  }

  function writeToDebugLog(line: string): void {
    if (debugLogReady && debugLogPath) {
      fs.appendFileSync(debugLogPath, line + "\n")
    }
  }

  function log(level: LogLevel, message: string, err?: Error): void {
    const line = formatLine(level, name, message)

    // Console: print if at or above console level
    if (level >= consoleLevel) {
      console.error(line)
    }

    // Debug file: all messages
    writeToDebugLog(line)
    if (err?.stack) {
      writeToDebugLog(formatLine(level, name, err.stack))
    }
  }

  return {
    debug(message: string): void {
      log(LogLevel.DEBUG, message)
    },
    info(message: string): void {
      log(LogLevel.INFO, message)
    },
    warn(message: string): void {
      log(LogLevel.WARN, message)
    },
    error(message: string, err?: Error): void {
      log(LogLevel.ERROR, message, err)
    },
    child(childName: string): Logger {
      return createLogger({
        name: childName,
        consoleLevel,
        debugLogPath,
      })
    },
  }
}
