import * as path from "node:path";
import { CookieJar } from "tough-cookie";
import { VERSION } from "./version.js";
import { parseArgs, serializeArgs } from "./cli.js";
import { readRecording, recordingDuration } from "./recording.js";
import { createLogger } from "./logger.js";
import { createOutputDir } from "./output.js";
import { runEnduranceTest } from "./worker.js";
import { SERVER_TYPE_NAMES, ServerType } from "./types.js";
import { HttpClient } from "./http.js";
import { detectServerType } from "./detect.js";
import { TerminalUI } from "./ui.js";

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

  if (
    !recording.props.rscApiKeyRequired &&
    args.creds.connectApiKey !== null
  ) {
    throw new Error(
      "SHINYCANNON_CONNECT_API_KEY is set but the recording was not made with an API key. " +
        "Re-record with an API key or unset SHINYCANNON_CONNECT_API_KEY.",
    );
  }

  createOutputDir({
    outputDir: args.outputDir,
    overwrite: args.overwriteOutput,
    version: VERSION,
    recordingPath: args.recordingPath,
  });

  const logger = createLogger({
    name: "thread00",
    consoleLevel: args.logLevel,
    debugLogPath: args.debugLog
      ? path.join(args.outputDir, "debug.log")
      : undefined,
  });

  const recordingServerTypeName =
    SERVER_TYPE_NAMES.get(recording.props.targetType) ??
    recording.props.targetType;
  logger.info(`Server type from recording: ${recordingServerTypeName}`);

  // Detect live server type for validation
  const detectionClient = new HttpClient({
    cookieJar: new CookieJar(),
    headers: args.headers,
    userAgent: `shinycannon/${VERSION}`,
  });

  let detectedServerType: ServerType | null = null;
  try {
    detectedServerType = await detectServerType(args.appUrl, detectionClient);
    const detectedName =
      SERVER_TYPE_NAMES.get(detectedServerType) ?? detectedServerType;
    logger.info(`Detected target application type: ${detectedName}`);

    if (detectedServerType !== recording.props.targetType) {
      logger.warn(
        `Detected server type (${detectedName}) does not match recording ` +
          `target type (${recordingServerTypeName}). Playback may not work correctly.`,
      );
    }
  } catch {
    logger.warn("Could not detect server type; skipping server type validation.");
  }

  // RSC URL fragment check (fall back to recording type if detection failed)
  const effectiveServerType = detectedServerType ?? recording.props.targetType;
  if (
    effectiveServerType === ServerType.RSC &&
    args.appUrl.includes("#")
  ) {
    throw new Error(
      "The app URL contains a '#' fragment. For RStudio Connect, use the " +
        "content URL (solo mode) instead of the dashboard URL.",
    );
  }

  const { argsString, argsJson } = serializeArgs(args);

  const ui = process.stderr.isTTY
    ? new TerminalUI({
        version: VERSION,
        appUrl: args.appUrl,
        workers: args.workers,
        loadedDurationMinutes: args.loadedDurationMinutes,
        outputDir: args.outputDir,
      })
    : undefined;

  ui?.showBanner();

  // Ensure Ctrl+C / kill cleanly stops the spinner and exits
  process.on("SIGINT", () => { ui?.cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { ui?.cleanup(); process.exit(143); });

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
    ui,
  });

  process.exit(0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exit(1);
});
