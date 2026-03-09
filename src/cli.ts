import * as fs from "node:fs";
import { Command } from "commander";
import { VERSION } from "./version.js";
import { defaultOutputDir } from "./output.js";
import { parseLogLevel, LogLevel } from "./logger.js";
import { getCreds } from "./auth.js";
import { type Creds } from "./types.js";

// ---------------------------------------------------------------------------
// ParsedArgs
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  recordingPath: string;
  appUrl: string;
  workers: number;
  loadedDurationMinutes: number;
  startInterval: number | null;
  headers: Record<string, string>;
  outputDir: string;
  overwriteOutput: boolean;
  debugLog: boolean;
  logLevel: LogLevel;
  creds: Creds;
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

export function parseHeader(header: string): [string, string] {
  const colonIndex = header.indexOf(":");
  if (colonIndex === -1) throw new Error(`Malformed header: ${header}`);
  const name = header.substring(0, colonIndex);
  if (name.length === 0) throw new Error("Header name is empty");
  const value = header.substring(colonIndex + 1).replace(/^\s+/, "");
  return [name, value];
}

// ---------------------------------------------------------------------------
// Serialize args for output files
// ---------------------------------------------------------------------------

export function serializeArgs(args: ParsedArgs): {
  argsString: string;
  argsJson: string;
} {
  const parts: string[] = [
    args.appUrl,
    `--workers ${args.workers}`,
    `--loaded-duration-minutes ${args.loadedDurationMinutes}`,
  ];
  if (args.startInterval !== null) {
    parts.push(`--start-interval ${args.startInterval}`);
  }
  for (const [name, value] of Object.entries(args.headers)) {
    parts.push(`-H "${name}: ${value}"`);
  }
  parts.push(`--output-dir ${args.outputDir}`);
  if (args.overwriteOutput) {
    parts.push("--overwrite-output");
  }
  if (args.debugLog) {
    parts.push("--debug-log");
  }
  parts.push(`--log-level ${LogLevel[args.logLevel]!.toLowerCase()}`);

  const argsString = parts.join(" ");

  const jsonObj: Record<string, unknown> = {
    appUrl: args.appUrl,
    workers: args.workers,
    loadedDurationMinutes: args.loadedDurationMinutes,
    startInterval: args.startInterval,
    headers: args.headers,
    outputDir: args.outputDir,
    overwriteOutput: args.overwriteOutput,
    debugLog: args.debugLog,
    logLevel: LogLevel[args.logLevel],
  };
  const argsJson = JSON.stringify(jsonObj);

  return { argsString, argsJson };
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv?: string[]): ParsedArgs {
  const program = new Command();

  program
    .name("shinycannon")
    .description(
      "Load generation tool for Shiny applications.\n\n" +
        "Provided a recording file and the URL of a deployed application,\n" +
        "shinycannon will play back the recording, simulating one or more\n" +
        "users interacting with the application over a configurable amount of time.\n\n" +
        "Example:\n" +
        "  shinycannon recording.log https://rsc.example.com/app --workers 3 --loaded-duration-minutes 10",
    )
    .argument("<recording>", "Path to recording file")
    .argument("<app-url>", "URL of the Shiny application to interact with")
    .option("--workers <n>", "Number of workers to simulate", "1")
    .option(
      "--loaded-duration-minutes <n>",
      "Minutes to maintain target workers after warmup",
      "5",
    )
    .option("--start-interval <ms>", "Milliseconds between starting workers")
    .option(
      "-H, --header <header...>",
      "Custom HTTP header (name: value), repeatable",
    )
    .option(
      "--output-dir <dir>",
      "Directory for session logs",
      defaultOutputDir(),
    )
    .option(
      "--overwrite-output",
      "Delete output dir if it exists",
      false,
    )
    .option("--debug-log", "Write verbose debug log", false)
    .option(
      "--log-level <level>",
      "Console log level: debug, info, warn, error",
      "warn",
    )
    .addHelpText(
      "after",
      "\nEnvironment variables:\n" +
        "  SHINYCANNON_USER              Username for SSP or Connect auth\n" +
        "  SHINYCANNON_PASS              Password for SSP or Connect auth\n" +
        "  SHINYCANNON_CONNECT_API_KEY   RStudio Connect API key",
    )
    .version(VERSION);

  program.parse(argv ?? process.argv);

  const opts = program.opts<{
    workers: string;
    loadedDurationMinutes: string;
    startInterval?: string;
    header?: string[];
    outputDir: string;
    overwriteOutput: boolean;
    debugLog: boolean;
    logLevel: string;
  }>();

  const [recordingPath, appUrl] = program.args as [string, string];

  // Validate recording file exists
  if (!fs.existsSync(recordingPath)) {
    throw new Error(`Recording file not found: ${recordingPath}`);
  }

  // Parse headers
  const headers: Record<string, string> = {};
  if (opts.header) {
    for (const h of opts.header) {
      const [name, value] = parseHeader(h);
      headers[name] = value;
    }
  }

  // Parse start interval
  const startInterval =
    opts.startInterval !== undefined ? Number(opts.startInterval) : null;
  if (startInterval !== null && (!Number.isFinite(startInterval) || startInterval < 0)) {
    throw new Error(`Invalid start-interval value: ${opts.startInterval}`);
  }

  const workers = Number(opts.workers);
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`Invalid workers value: ${opts.workers}`);
  }

  const loadedDurationMinutes = Number(opts.loadedDurationMinutes);
  if (!Number.isFinite(loadedDurationMinutes) || loadedDurationMinutes <= 0) {
    throw new Error(
      `Invalid loaded-duration-minutes value: ${opts.loadedDurationMinutes}`,
    );
  }

  return {
    recordingPath,
    appUrl,
    workers,
    loadedDurationMinutes,
    startInterval,
    headers,
    outputDir: opts.outputDir,
    overwriteOutput: opts.overwriteOutput,
    debugLog: opts.debugLog,
    logLevel: parseLogLevel(opts.logLevel),
    creds: getCreds(),
  };
}
