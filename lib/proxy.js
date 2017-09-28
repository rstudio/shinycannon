const EventEmitter = require("events");
const http = require("http");
const url = require("url");

const http_proxy = require("http-proxy");
const websocket = require("websocket-driver");

class ShinyEventProxy extends EventEmitter {
  constructor(target, secure = true) {
    super();
    this.target = target;

    this.proxy = new http_proxy.createProxyServer({
      target: target,
      secure: secure,
      headers: {
        host: url.parse(target).host
      }
    });

    this.proxy.on("proxyReq", (proxyReq, req, res, options) => {
      this.emit("proxyReq", proxyReq, req, res, options);
    });
    this.proxy.on("proxyRes", (proxyRes, req, res) => {
      this.emit("proxyRes", proxyRes, req, res);
    });

    this.server = http.createServer((req, res) => {
      this.proxy.web(req, res);
    });

    this.server.on("upgrade", (req, socket, head) => {
      this.emit("ws_opened", req, socket);

      socket.on("close", () => {
        this.emit("ws_closed", req, socket);
      });

      const driver_in = websocket.http(req, { requireMasking: false });
      driver_in.messages.on("data", message => {
        // MESSAGE SENT
        this.emit("ws_sent", message);
      });
      driver_in.messages.on("error", err => {
        this.emit("error", err);
      });
      const old_write = socket.write;
      socket.write = function(data) {
        if (typeof data !== "string" || !/^HTTP\//.test(data)) {
          driver_in.parse(Buffer.from(data));
        }
        old_write.apply(this, arguments);
      };

      this.proxy.ws(req, socket, head);

      const driver_out = websocket.http(req);
      socket.on("data", buf => {
        driver_out.parse(Buffer.from(buf));
      });
      driver_out.messages.on("data", message => {
        this.emit("ws_received", message);
      });
    });
  }

  listen(port) {
    this.server.listen(port);
  }
}

module.exports = ShinyEventProxy;
