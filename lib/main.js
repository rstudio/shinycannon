require("longjohn");

const record = require("./record");
const playback = require("./playback");
const argv = require("yargs")
  .command("record", "Record a run", yargs => {
    yargs.option("port", {
      alias: "p",
      describe: "Port to listen on",
      default: 8600
    });
    yargs.option("target", {
      alias: "t",
      describe: "Target host/port",
      default: "localhost:3838"
    });
  })
  .command("playback <file>", "Playback a run", yargs => {
    yargs.option("target", {
      alias: "t",
      describe: "Target host/port",
      default: "localhost:3838"
    });
    yargs.option("concurrency", {
      alias: "c",
      describe: "Number of concurrent threads",
      default: 1
    });
    yargs.options("nruns", {
      alias: "n",
      describe: "Number of runs per thread",
      default: 1
    });
  })
  .demandCommand(1, "Please specify a command")
  .help().argv;

/* eslint-disable no-console */

class Reporter {
  constructor() {
    this.successCount = 0;
    this.errors = [];
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

if (argv._[0] === "record") {
  let host = "localhost";
  let port = 80;
  if (/:/.test(argv.target)) {
    const chunks = argv.target.split(":", 2);
    host = chunks[0];
    port = chunks[1];
  } else if (/^\d+$/.test(argv.target)) {
    port = parseInt(argv.target);
  } else {
    host = argv.target;
  }
  console.error(`Target host: ${host}`);
  console.error(`Target port: ${port}`);
  console.error(`Listening on port ${argv.port}`);
  record.start(host, port, argv.port);
} else if (argv._[0] === "playback") {
  const reporter = new Reporter();
  process.on("SIGINT", () => {
    reporter.dump();
    process.exit(1);
  });
  const plays = [];
  for (let i = 0; i < argv.concurrency; i++) {
    plays.push(run(argv.file, i, argv.nruns, reporter));
  }

  Promise.all(plays).then(
    () => {
      reporter.dump();
      //process.exit(0);
    },
    err => {
      console.error("Error: ", err);
      process.exit(1);
    }
  );
}

async function run(file, threadId, times, reporter) {
  for (let i = 0; i < times; i++) {
    const destfile = `output_${threadId}_${i}.txt`;
    try {
      // console.log(`running ${threadId}_${i}`);
      await playback(file, destfile, reporter);
    } catch (err) {
      throw err;
    }
  }
}
