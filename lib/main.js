const fs = require("fs");
const path = require("path");

require("longjohn");

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
    const destfile = path.join(argv.outdir, `profile_${threadId}_${i}.txt`);
    const outStream = await createWriteStreamAsync(destfile);
    const job = reporter.createJob(outStream);
    try {
      // console.log(`running ${threadId}_${i}`);
      await playback(file, job);
      job.success();
    } catch (err) {
      job.failure(err);
      throw err;
    }
  }
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
