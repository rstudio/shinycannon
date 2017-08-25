const fs = require("fs");

class Reporter {
  constructor() {
    this.successCount = 0;
    this.errors = [];
  }

  createJob(outStream) {
    return new SubReporter(this, outStream);
  }

  success() {
    process.stderr.write(".");
    this.successCount++;
  }

  failure(err) {
    process.stderr.write("!");
    this.errors.push(err);
  }

  dump() {
    const errorCounts = new Map();
    console.error(
      `\n\n${this.successCount} succeeded, ${this.errors.length} failed`
    );
    this.errors.forEach(err => {
      const errStr = err.stack;
      if (!errorCounts.has(errStr)) {
        errorCounts.set(errStr, 1);
      } else {
        errorCounts.set(errStr, errorCounts.get(errStr) + 1);
      }
    });
    errorCounts.forEach((count, errStr) => {
      console.error(`${count} incidences of:\n${errStr}\n\n`);
    });
  }
}
module.exports = Reporter;

class SubReporter {
  constructor(parent, outStream) {
    this.parent = parent;
    this.nextId = 1;
    this.currentStep = null;
    this.currentStepStartTime = null;
    this.jobStartTime = new Date();

    this.outputStream = outStream;
  }

  beginStep(event) {
    if (this.currentStep) {
      throw new Error("Can't beginStep when a step is already in progress");
    }
    this.currentStep = event;
    this.currentStepStartTime = new Date();
  }

  endStep(event) {
    if (!this.currentStep) {
      throw new Error("Can't endStep when no step is in progress");
    }
    if (this.currentStep !== event) {
      throw new Error(
        "The step that's ending isn't the same as the one that is in progress"
      );
    }

    const now = new Date();
    const elapsed = now - this.currentStepStartTime;

    this.currentStep = null;
    this.currentStepStartTime = null;

    this.outputStream.write(
      [this.nextId++, now.toISOString(), elapsed, event.type].join("\t") + "\n"
    );
  }

  success() {
    this.outputStream.write("# Success\n");
    this.parent.success();
    this._done();
  }

  failure(err) {
    this.outputStream.write("# Failure\n");
    this.parent.failure(err);
    this._done();
  }

  _done() {
    this.outputStream.write(
      `# Job finished in ${new Date() - this.jobStartTime}ms\n`
    );
    this.outputStream.end();
  }
}
