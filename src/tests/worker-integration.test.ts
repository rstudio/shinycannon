import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MockShinyServer } from "./helpers/mock-shiny-server.js";
import { runEnduranceTest } from "../worker.js";
import type { EnduranceTestConfig } from "../worker.js";
import { readRecordingFromString } from "../recording.js";
import type { Logger } from "../logger.js";
import { createOutputDir } from "../output.js";

// ---------------------------------------------------------------------------
// Capturing logger
// ---------------------------------------------------------------------------

function createCapturingLogger(): { logger: Logger; messages: string[] } {
  const messages: string[] = [];

  function makeLogger(prefix: string): Logger {
    return {
      debug(msg: string) {
        messages.push(`DEBUG${prefix}: ${msg}`);
      },
      info(msg: string) {
        messages.push(`INFO${prefix}: ${msg}`);
      },
      warn(msg: string) {
        messages.push(`WARN${prefix}: ${msg}`);
      },
      error(msg: string, _err?: Error) {
        messages.push(`ERROR${prefix}: ${msg}`);
      },
      child(name: string): Logger {
        return makeLogger(`${prefix} [${name}]`);
      },
    };
  }

  return { logger: makeLogger(""), messages };
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

interface RunTestResult {
  tmpDir: string;
  outputDir: string;
  csvFiles: string[];
  messages: string[];
  elapsed: number;
  sessionsDir: string;
}

async function runTest(
  mock: MockShinyServer,
  overrides: Partial<Omit<EnduranceTestConfig, "logger">> = {},
): Promise<RunTestResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shinycannon-worker-"));
  const recordingPath = path.join(tmpDir, "recording.log");
  fs.writeFileSync(recordingPath, mock.makeRecording());
  const outputDir = path.join(tmpDir, "output");
  createOutputDir({ outputDir, overwrite: false, version: "0.0.0-test", recordingPath });

  const recording = readRecordingFromString(fs.readFileSync(recordingPath, "utf-8"));
  const { logger, messages } = createCapturingLogger();

  const config: EnduranceTestConfig = {
    httpUrl: mock.url,
    recording,
    recordingPath,
    headers: {},
    creds: { user: null, pass: null, connectApiKey: null },
    numWorkers: 1,
    warmupInterval: 10,
    loadedDurationMinutes: 0.005,
    outputDir,
    logger,
    argsString: "test",
    argsJson: "{}",
    ...overrides,
  };

  const startTime = Date.now();
  await runEnduranceTest(config);
  const elapsed = Date.now() - startTime;

  const sessionsDir = path.join(outputDir, "sessions");
  const csvFiles = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".csv"));

  return { tmpDir, outputDir, csvFiles, messages, elapsed, sessionsDir };
}

// ---------------------------------------------------------------------------
// Helpers for CSV analysis
// ---------------------------------------------------------------------------

/** Extract unique worker IDs from CSV filenames (format: sessionId_workerId_iterationId.csv) */
function uniqueWorkerIds(csvFiles: string[]): Set<number> {
  const ids = new Set<number>();
  for (const f of csvFiles) {
    const parts = path.basename(f, ".csv").split("_");
    if (parts.length >= 2) {
      ids.add(Number(parts[1]));
    }
  }
  return ids;
}

/** Extract unique iteration IDs from CSV filenames */
function uniqueIterationIds(csvFiles: string[]): Set<number> {
  const ids = new Set<number>();
  for (const f of csvFiles) {
    const parts = path.basename(f, ".csv").split("_");
    if (parts.length >= 3) {
      ids.add(Number(parts[2]));
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Worker Integration", { timeout: 30000 }, () => {
  let mock: MockShinyServer;
  let tempDirs: string[] = [];

  beforeAll(async () => {
    mock = new MockShinyServer();
    await mock.start();
  });

  afterAll(async () => {
    await mock.stop();
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  // CLI-03 / END-01: --workers 3 produces 3 concurrent workers
  it("produces output from all requested workers", async () => {
    const result = await runTest(mock, {
      numWorkers: 3,
      warmupInterval: 10,
      loadedDurationMinutes: 0.001,
    });
    tempDirs.push(result.tmpDir);

    const workerIds = uniqueWorkerIds(result.csvFiles);
    expect(workerIds.size).toBeGreaterThanOrEqual(3);
    expect(workerIds.has(0)).toBe(true);
    expect(workerIds.has(1)).toBe(true);
    expect(workerIds.has(2)).toBe(true);
  });

  // END-02: Workers loop (iteration > 0)
  it("workers loop through multiple iterations", async () => {
    const result = await runTest(mock, {
      numWorkers: 1,
      warmupInterval: 10,
      loadedDurationMinutes: 0.01,
    });
    tempDirs.push(result.tmpDir);

    expect(result.csvFiles.length).toBeGreaterThan(1);

    const iterationIds = uniqueIterationIds(result.csvFiles);
    const maxIteration = Math.max(...Array.from(iterationIds));
    expect(maxIteration).toBeGreaterThan(0);
  });

  // END-03 / END-04: Shutdown after loaded duration
  it("completes within a reasonable time after loaded duration", async () => {
    const result = await runTest(mock, {
      numWorkers: 1,
      warmupInterval: 10,
      loadedDurationMinutes: 0.005,
    });
    tempDirs.push(result.tmpDir);

    // 0.005 minutes = 300ms; with warmup and session overhead, allow very generous bounds
    expect(result.elapsed).toBeGreaterThanOrEqual(100);
    expect(result.elapsed).toBeLessThan(15000);
  });

  // CLI-05: loadedDurationMinutes 0.01 runs for ~600ms
  it("loadedDurationMinutes 0.01 runs for roughly 600ms", async () => {
    const result = await runTest(mock, {
      numWorkers: 1,
      warmupInterval: 10,
      loadedDurationMinutes: 0.01,
    });
    tempDirs.push(result.tmpDir);

    // 0.01 minutes = 600ms; generous tolerance for CI environments
    expect(result.elapsed).toBeGreaterThanOrEqual(200);
    expect(result.elapsed).toBeLessThan(15000);
  });

  // CLI-06: --start-interval staggers workers
  it("staggers worker start with warmupInterval", async () => {
    const result = await runTest(mock, {
      numWorkers: 2,
      warmupInterval: 200,
      loadedDurationMinutes: 0.001,
    });
    tempDirs.push(result.tmpDir);

    const workerIds = uniqueWorkerIds(result.csvFiles);
    expect(workerIds.has(0)).toBe(true);
    expect(workerIds.has(1)).toBe(true);

    // With warmupInterval=200, elapsed should be at least 200ms
    expect(result.elapsed).toBeGreaterThanOrEqual(200);
  });

  // END-06: Final summary includes done/failed counts
  it("final summary includes Done and Failed counts", async () => {
    const result = await runTest(mock, {
      numWorkers: 1,
      warmupInterval: 10,
      loadedDurationMinutes: 0.001,
    });
    tempDirs.push(result.tmpDir);

    const completeLine = result.messages.find(
      (m) => m.includes("Done:") && m.includes("Failed:"),
    );
    expect(completeLine).toBeDefined();
  });
});
