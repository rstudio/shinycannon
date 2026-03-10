import * as fs from "node:fs";
import { Command } from "commander";
import { bold, cyan, dim, green, magenta, yellow } from "yoctocolors";
import { VERSION } from "./version.js";
import { defaultOutputDir } from "./output.js";
import { parseLogLevel, LogLevel } from "./logger.js";
import { getCreds } from "./auth.js";
import { type Creds } from "./types.js";
import { readRecording } from "./recording.js";

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

  const colorArgument = (str: string): string => {
    if (str.includes("recording")) return green(str);
    if (str.includes("app-url")) return magenta(str);
    return str;
  };

  program
    .configureHelp({
      styleTitle: (str) => bold(str),
      styleOptionTerm: (str) => cyan(str),
    })
    .name(bold(cyan("shinycannon")))
    .description("Load generation tool for Shiny applications.")
    .version(VERSION);

  let result: ParsedArgs | undefined;

  const loadtestCmd = program
    .command("loadtest")
    .configureHelp({
      styleTitle: (str) => bold(str),
      styleArgumentTerm: (str) => colorArgument(str),
      styleArgumentText: (str) => colorArgument(str),
      styleOptionTerm: (str) => cyan(str),
    })
    .description(
      "Run a load test against a deployed Shiny application.\n\n" +
        "Provided a recording file and the URL of a deployed application,\n" +
        "shinycannon will play back the recording, simulating one or more\n" +
        "users interacting with the application over a configurable amount of time.\n\n" +
        dim("Example:") + "\n" +
        `  ${cyan("$")} shinycannon loadtest recording.log https://rsc.example.com/app --workers 3 --loaded-duration-minutes 10`,
    )
    .argument("<recording>", "Path to recording file")
    .argument("[app-url]", "URL of the Shiny application to interact with (defaults to target_url from recording)")
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
      `\n${bold("Environment variables:")}\n` +
        `  ${yellow("SHINYCANNON_USER")}              Username for SSP or Connect auth\n` +
        `  ${yellow("SHINYCANNON_PASS")}              Password for SSP or Connect auth\n` +
        `  ${yellow("SHINYCANNON_CONNECT_API_KEY")}   RStudio Connect API key`,
    )
    .action((recordingPath: string, appUrlArg: string | undefined, opts: {
      workers: string;
      loadedDurationMinutes: string;
      startInterval?: string;
      header?: string[];
      outputDir: string;
      overwriteOutput: boolean;
      debugLog: boolean;
      logLevel: string;
    }) => {
      // Validate recording file exists
      if (!fs.existsSync(recordingPath)) {
        throw new Error(`Recording file not found: ${recordingPath}`);
      }

      // Resolve app URL: CLI argument takes precedence, otherwise use target_url from recording
      let appUrl: string;
      if (appUrlArg) {
        appUrl = appUrlArg;
      } else {
        const recording = readRecording(recordingPath);
        if (!recording.props.targetUrl) {
          throw new Error(
            "Recording does not contain a target_url; provide app-url explicitly",
          );
        }
        appUrl = recording.props.targetUrl;
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

      result = {
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
    });

  const raw = argv ?? process.argv;
  const userArgs = raw.slice(2);

  // Show help when invoked with no arguments
  if (userArgs.length === 0) {
    program.help();
  }

  // Show loadtest help when invoked as `shinycannon loadtest` with no further args
  if (userArgs.length === 1 && userArgs[0] === "loadtest") {
    loadtestCmd.help();
  }

  program.parse(raw);

  if (!result) {
    // Commander already exits on --help/--version. If we get here, no
    // subcommand matched. Show help and exit.
    program.help();
    // program.help() calls process.exit, but TypeScript doesn't know that.
    throw new Error("unreachable");
  }

  return result;
}
