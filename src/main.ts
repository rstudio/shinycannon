import * as path from "node:path";
import { VERSION } from "./version.js";
import { parseArgs, serializeArgs } from "./cli.js";
import { readRecording, recordingDuration } from "./recording.js";
import { createLogger } from "./logger.js";
import { createOutputDir } from "./output.js";
import { runEnduranceTest } from "./worker.js";
import { SERVER_TYPE_NAMES } from "./types.js";

async function main(): Promise<void> {
  const args = parseArgs();

  const recording = readRecording(args.recordingPath);
  const duration = recordingDuration(recording);

  const startInterval =
    args.startInterval !== null ? args.startInterval : duration / args.workers;

  if (
    recording.props.rscApiKeyRequired &&
    args.creds.connectApiKey === null
  ) {
    throw new Error(
      "Recording requires an RStudio Connect API key but SHINYCANNON_CONNECT_API_KEY is not set.",
    );
  }

  createOutputDir({
    outputDir: args.outputDir,
    overwrite: args.overwriteOutput,
    version: VERSION,
    recordingPath: args.recordingPath,
  });

  const logger = createLogger({
    name: "main",
    consoleLevel: args.logLevel,
    debugLogPath: args.debugLog
      ? path.join(args.outputDir, "debug.log")
      : undefined,
  });

  const serverTypeName =
    SERVER_TYPE_NAMES.get(recording.props.targetType) ??
    recording.props.targetType;
  logger.info(`Server type from recording: ${serverTypeName}`);

  const { argsString, argsJson } = serializeArgs(args);

  await runEnduranceTest({
    httpUrl: args.appUrl,
    recording,
    recordingPath: args.recordingPath,
    headers: args.headers,
    creds: args.creds,
    numWorkers: args.workers,
    warmupInterval: startInterval,
    loadedDurationMinutes: args.loadedDurationMinutes,
    outputDir: args.outputDir,
    logger,
    argsString,
    argsJson,
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
