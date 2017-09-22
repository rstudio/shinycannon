const evt = require("./shiny-events");

const misc = require("./misc");

// pauseMode: "exact" or "none". This list should be extended if we add
//   randomized sleep times in the future.
async function playback(
  jsonEvents,
  reporter,
  target,
  pauseMode = "exact",
  debug = false
) {
  const ctx = new evt.EventContext(target);

  try {
    let prevEvent = null;
    for (let i = 0; i < jsonEvents.length; i++) {
      const shinyEvent = evt.fromJSON(jsonEvents[i]);

      let sleepTime = shinyEvent.sleepBeforeExecute(ctx, prevEvent);
      // Additional sleep modes (i.e. randomized) should be added as cases to
      // this switch, and mutate the sleepTime variable.
      switch (pauseMode) {
        case "exact":
          break;
        case "none":
          sleepTime = 0;
          break;
        default:
          throw new Error(`Unknown pause mode '${pauseMode}'`);
      }
      if (sleepTime && sleepTime > 0) {
        await misc.sleep(sleepTime);
      }

      reporter.beginStep(shinyEvent, debug);
      try {
        await shinyEvent.execute(ctx);
      } finally {
        reporter.endStep(shinyEvent, sleepTime);
      }
      prevEvent = shinyEvent;
    }
    reporter.success();
  } catch (err) {
    reporter.failure(err);
  } finally {
    ctx.close();
  }
}
module.exports = playback;
