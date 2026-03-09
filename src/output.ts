import * as fs from "node:fs";
import * as path from "node:path";

/**
 * CSV column headers for session output files.
 */
export const CSV_COLUMNS = [
  "session_id",
  "worker_id",
  "iteration",
  "event",
  "timestamp",
  "input_line_number",
  "comment",
] as const;

export interface OutputDirOptions {
  outputDir: string;
  overwrite: boolean;
  version: string;
  recordingPath: string;
}

/**
 * Generate the default output directory name using the current timestamp.
 * Colons are replaced with underscores for Windows compatibility.
 */
export function defaultOutputDir(): string {
  const inst = new Date().toISOString().replace(/:/g, "_");
  return `test-logs-${inst}`;
}

/**
 * Create the output directory structure, write the version file,
 * and copy the recording file.
 */
export function createOutputDir(options: OutputDirOptions): void {
  const { outputDir, overwrite, version, recordingPath } = options;

  if (fs.existsSync(outputDir)) {
    if (!overwrite) {
      throw new Error(
        `Output directory already exists: ${outputDir}. Use --overwrite to replace it.`,
      );
    }
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, "sessions"), { recursive: true });
  fs.writeFileSync(path.join(outputDir, "shinycannon-version.txt"), version);
  fs.copyFileSync(recordingPath, path.join(outputDir, "recording.log"));
}

/**
 * Writes CSV session data to an output file.
 */
export class SessionWriter {
  private fd: number;

  constructor(options: {
    outputDir: string;
    sessionId: number;
    workerId: number;
    iterationId: number;
    argsString: string;
    argsJson: string;
  }) {
    const fileName = `${options.sessionId}_${options.workerId}_${options.iterationId}.csv`;
    const filePath = path.join(options.outputDir, "sessions", fileName);

    this.fd = fs.openSync(filePath, "w");
    this.writeLine(`# ${options.argsString}`);
    this.writeLine(`# ${options.argsJson}`);
    this.writeLine(CSV_COLUMNS.join(","));
  }

  /**
   * Write a CSV row and flush.
   */
  writeCsv(
    sessionId: number,
    workerId: number,
    iterationId: number,
    event: string,
    timestamp: number,
    inputLineNumber: number,
    comment: string,
  ): void {
    this.writeLine(
      [
        sessionId,
        workerId,
        iterationId,
        event,
        timestamp,
        inputLineNumber,
        comment,
      ].join(","),
    );
  }

  /**
   * Close the underlying file descriptor.
   */
  close(): void {
    fs.closeSync(this.fd);
  }

  private writeLine(line: string): void {
    fs.writeSync(this.fd, line + "\n");
    fs.fsyncSync(this.fd);
  }
}
