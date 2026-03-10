/**
 * Worker orchestration module. Implements the EnduranceTest: multiple
 * concurrent workers, each looping through recording sessions, with
 * staggered start, loaded duration control, and progress reporting.
 */

import type { Logger } from "./logger.js";
import { Stats, runSession } from "./session.js";
import type { SessionConfig } from "./session.js";
import type { Recording, Creds } from "./types.js";
import type { TerminalUI } from "./ui.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnduranceTestConfig {
  httpUrl: string;
  recording: Recording;
  recordingPath: string;
  headers: Record<string, string>;
  creds: Creds;
  numWorkers: number;
  warmupInterval: number;
  loadedDurationMinutes: number;
  outputDir: string;
  logger: Logger;
  argsString: string;
  argsJson: string;
  ui?: TerminalUI;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// runEnduranceTest
// ---------------------------------------------------------------------------

export async function runEnduranceTest(
  config: EnduranceTestConfig,
): Promise<void> {
  const {
    httpUrl,
    recording,
    recordingPath,
    headers,
    creds,
    numWorkers,
    warmupInterval,
    loadedDurationMinutes,
    outputDir,
    logger,
    argsString,
    argsJson,
    ui,
  } = config;

  const stats = new Stats();

  // Session counter (safe in single-threaded Node.js)
  let sessionCounter = 0;
  function nextSessionId(): number {
    return sessionCounter++;
  }

  // Progress reporting: log stats every 5 seconds (only when no UI)
  const progressInterval = ui
    ? null
    : setInterval(() => {
        logger.info(stats.toString());
      }, 5000);

  ui?.startWarmup();

  // Shared flag to signal workers to stop after loaded duration
  let keepWorking = true;

  // Per-worker warmup resolve functions
  const warmupPromises: Promise<void>[] = [];
  const warmupResolvers: Array<() => void> = [];

  for (let i = 0; i < numWorkers; i++) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    warmupPromises.push(promise);
    warmupResolvers.push(resolve);
  }

  // Worker function
  async function workerFn(workerId: number): Promise<void> {
    const workerLogger = logger.child(
      `thread${String(workerId + 1).padStart(2, "0")}`,
    );

    // Stagger delay
    await sleep(workerId * warmupInterval);
    workerLogger.info("Warming up");

    let iteration = 0;

    // Build session config (shared fields)
    function buildSessionConfig(): SessionConfig {
      return {
        sessionId: nextSessionId(),
        workerId,
        iterationId: iteration++,
        httpUrl,
        recording,
        recordingPath,
        headers,
        creds,
        logger: workerLogger,
        outputDir,
        argsString,
        argsJson,
      };
    }

    // First session (warmup)
    try {
      await runSession(buildSessionConfig(), stats);
    } finally {
      warmupResolvers[workerId]!();
      ui?.workerReady();
    }

    // Subsequent sessions
    while (keepWorking) {
      workerLogger.info("Running again");
      await runSession(buildSessionConfig(), stats);
    }

    workerLogger.info("Stopped");
  }

  // Launch all workers concurrently
  const workerPromises: Promise<void>[] = [];
  for (let i = 0; i < numWorkers; i++) {
    workerPromises.push(workerFn(i));
  }

  try {
    // Wait for all workers to complete their first session (warmup phase)
    logger.info("Waiting for warmup to complete");
    await Promise.all(warmupPromises);

    // Maintain loaded duration
    logger.info(`Maintaining for ${loadedDurationMinutes} minutes`);
    ui?.startLoaded(() => stats.getCounts());
    await sleep(loadedDurationMinutes * 60000);

    // Signal workers to stop
    logger.info("Stopped maintaining, waiting for workers to stop");
    ui?.startShutdown();
    keepWorking = false;

    // Wait for all workers to finish their current sessions
    await Promise.all(workerPromises);

    // Final summary
    const counts = stats.getCounts();
    logger.info(`Complete. Failed: ${counts.failed}, Done: ${counts.done}`);
    ui?.finish(counts);
  } finally {
    if (progressInterval !== null) {
      clearInterval(progressInterval);
    }
  }
}
