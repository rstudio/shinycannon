const ShinyEventProxy = require("./proxy");
const evt = require("./shiny-events");

class RecordingSession {
  constructor(proxy) {
    this.proxy = proxy;
    this.events = [];

    this.ctx = new evt.EventContext();

    this._hookEvents();
  }

  _hookEvents() {
    this.proxy.on("proxyReq", (proxyReq, req, res, options) => {
      const reqEvt = evt.fromReq(req);
      this._record(reqEvt);
      req.shinyEvent = reqEvt;
    });
    this.proxy.on("proxyRes", (proxyRes, req, res) => {
      req.shinyEvent.handleResponse(this.ctx, proxyRes);
      // console.log("v " + req.url);
    });

    this.proxy.on("ws_opened", (req, socket) => {
      this._record(evt.ShinyWSOpenEvent.fromReq(req));
    });
    this.proxy.on("ws_received", message => {
      // console.log("> " + message.substring(0, 128));
      // Yes, send. The direction of events is reversed when we playback.
      this._record(evt.ShinyWSSendEvent.fromMessage(message));
    });
    this.proxy.on("ws_sent", message => {
      // console.log("< " + message.substring(0, 128));
      // Yes, receive. The direction of events is reversed when we playback.
      if (!evt.shouldIgnore(message)) {
        this._record(evt.fromMessage(message));
      }
    });
    this.proxy.on("ws_closed", () => {
      // console.log("ws_closed");
      this._record(new evt.ShinyWSCloseEvent());
      process.exit(0);
    });
  }

  _record(event) {
    event.parse(this.ctx);
    this.events.push(event);
    console.log(JSON.stringify(event.toJSON(this.ctx)));
  }
}

function start(target, listenPort = 8600) {
  const sep = new ShinyEventProxy(target);

  new RecordingSession(sep);

  sep.listen(listenPort);
}

exports.start = start;
