const byline = require("byline");
const fs = require("fs");
const evt = require("./shiny-events");

async function playback(file, reporter) {
  let tail = new Promise((resolve, reject) => {
    resolve();
  });

  const ctx = new evt.EventContext();

  const lines = byline(fs.createReadStream(file));

  return new Promise((resolve, reject) => {
    lines.on("data", async line => {
      const obj = JSON.parse(line);
      const shinyEvent = evt.fromJSON(obj);
      tail = tail.then(async () => {
        reporter.beginStep(shinyEvent);
        try {
          return await shinyEvent.execute(ctx);
        } finally {
          reporter.endStep(shinyEvent);
        }
      });
    });
    lines.on("end", async () => {
      try {
        await tail;
        reporter.success();
      } catch (err) {
        reporter.failure(err);
      } finally {
        // Clean up
        ctx.close();
        resolve();
      }
    });
  });
}
module.exports = playback;
