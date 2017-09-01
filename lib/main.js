const fs = require("fs");
const path = require("path");

require("longjohn");
const byline = require("byline");

const playback = require("./playback");
const record = require("./record");
const Reporter = require("./reporter");

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
      default: "http://localhost:3838"
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
    yargs.options("startDelayMs", {
      alias: "s",
      describe: "Number of milliseconds to wait between starting threads",
      default: 0
    });
    yargs.options("outdir", {
      alias: "o",
      describe: "The directory to write profiles to",
      default: "./profiles"
    });
  })
  .demandCommand(1, "Please specify a command")
  .help().argv;

/* eslint-disable no-console */

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
  startPlayback(argv.file, argv.concurrency, argv.nruns, argv.target)
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error("Error: ", err);
    });
}

async function startPlayback(file, concurrency, nruns, target) {
  const reporter = new Reporter();
  process.on("SIGINT", () => {
    reporter.dump();
    process.exit(1);
  });

  const lines = await readLines(argv.file);
  const jsonEvents = parseJSON(lines);
  const plays = [];
  for (let i = 0; i < argv.concurrency; i++) {
    const startDelayMs = i * argv.startDelayMs;
    plays.push(
      run(jsonEvents, startDelayMs, i, argv.nruns, reporter, argv.target)
    );
  }

  await Promise.all(plays);
  reporter.dump();
}

async function sleep(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, ms);
  });
}

async function run(
  jsonEvents,
  startDelayMs,
  threadId,
  times,
  reporter,
  target
) {
  await sleep(startDelayMs);
  for (let i = 0; i < times; i++) {
    const destfile = path.join(argv.outdir, `profile_${threadId}_${i}.txt`);
    const outStream = await createWriteStreamAsync(destfile);
    const job = reporter.createJob(outStream);
    // playback() is guaranteed not to throw
    await playback(jsonEvents, job, target);
  }
}

async function readLines(file) {
  const lineReader = byline(fs.createReadStream(file)),
    lines = [];

  lineReader.on("data", line => {
    lines.push(line);
  });

  return new Promise((resolve, reject) => {
    lineReader.on("end", () => {
      resolve(lines);
    });
    lineReader.on("error", reject);
  });
}

function parseJSON(lines) {
  return lines.map(JSON.parse);
}

function createWriteStreamAsync(path, options) {
  const ws = fs.createWriteStream(path, options);
  return new Promise((resolve, reject) => {
    ws.on("open", () => {
      resolve(ws);
    });
    ws.on("error", err => {
      reject(err);
    });
  });
}
