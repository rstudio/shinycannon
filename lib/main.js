const fs = require("fs");
const path = require("path");
const url = require("url");
const parseDuration = require("parse-duration");

const byline = require("byline");
require("longjohn");

const misc = require("./misc");
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
      describe: "Target URL",
      default: "http://localhost:3838"
    });
  })
  .command("playback <file>", "Playback a run", yargs => {
    yargs.option("target", {
      alias: "t",
      describe: "Target URL",
      default: "http://localhost:3838"
    });
    yargs.option("concurrency", {
      alias: "c",
      describe: "Number of concurrent threads",
      default: 1
    });
    yargs.options("duration", {
      alias: "d",
      describe:
        "Targetted test duration (eg 5min, 60s, see: https://www.npmjs.com/package/parse-duration)",
      default: "60s"
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
    yargs.options("pause-mode", {
      alias: "p",
      describe:
        "Whether to pause when the original recording paused. " +
        "Either 'exact' (yes) or 'none' (no).",
      default: "exact"
    });
  })
  .demandCommand(1, "Please specify a command")
  .help().argv;

/* eslint-disable no-console */

if (argv._[0] === "record") {
  // Ensure target URL has a trailing slash
  let urlStr = argv.target;
  if (!/\/$/.test(argv.target)) {
    urlStr += "/";
  }
  if (!/:\/\//.test(urlStr)) {
    urlStr = "http://" + urlStr;
  }

  const urlObj = url.parse(urlStr);
  // TODO: Ensure that urlObj has no search/query/hash
  console.error(`Target: ${url.format(urlObj)}`);
  console.error(`Listening on port ${argv.port}`);
  record.start(urlStr, argv.port);
} else if (argv._[0] === "playback") {
  startPlayback(
    argv.file,
    argv.concurrency,
    argv.duration,
    argv.target,
    argv.startDelayMs
  )
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error("Error: ", err);
    });
}

async function startPlayback(
  file,
  concurrency,
  duration,
  target,
  startDelayMs
) {
  const reporter = new Reporter();
  process.on("SIGINT", () => {
    reporter.dump();
    process.exit(1);
  });

  const lines = await readLines(file);
  const jsonEvents = parseJSON(lines);
  const maxDelay = concurrency * startDelayMs / 1000;
  const durationSec = parseDuration(duration) / 1000;
  const plays = [];
  for (let i = 0; i < concurrency; i++) {
    const thisDelayMs = i * startDelayMs;
    const threadDuration = durationSec + maxDelay - thisDelayMs / 1000;
    plays.push(
      run(jsonEvents, thisDelayMs, i, threadDuration, reporter, target)
    );
  }

  await Promise.all(plays);
  reporter.dump();
}

async function run(
  jsonEvents,
  startDelayMs,
  threadId,
  duration,
  reporter,
  target
) {
  await misc.sleep(startDelayMs);
  var end = new Date();
  end.setSeconds(end.getSeconds() + duration);
  var i = 0;
  while (new Date() < end) {
    const destfile = path.join(argv.outdir, `profile_${threadId}_${i}.txt`);
    const outStream = await createWriteStreamAsync(destfile);
    const job = reporter.createJob(outStream);
    // playback() is guaranteed not to throw
    await playback(jsonEvents, job, target);
    i++;
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
  // Filter out comments first
  return lines.filter(line => !/^#/.test(line)).map(JSON.parse);
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
