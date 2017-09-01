const fs = require("fs");
const evt = require("./shiny-events");

async function playback(jsonEvents, reporter, target) {
  const ctx = new evt.EventContext(target);

  try {
    for (let i = 0; i < jsonEvents.length; i++) {
      const shinyEvent = evt.fromJSON(jsonEvents[i]);
      reporter.beginStep(shinyEvent);
      try {
        await shinyEvent.execute(ctx);
      } finally {
        reporter.endStep(shinyEvent);
      }
    }
    reporter.success();
  } catch (err) {
    reporter.failure(err);
  } finally {
    ctx.close();
  }
}
module.exports = playback;
