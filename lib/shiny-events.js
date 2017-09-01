const crypto = require("crypto");
const EventEmitter = require("events");
const http = require("http");
const { parse } = require("url");
const util = require("util");

const WebSocketClient = require("websocket").client;
const streams = require("memory-streams");

class EventContext extends EventEmitter {
  constructor(target = "http://localhost:3838", tokens = new Tokens()) {
    super();
    this.tokens = tokens;
    this._websocket = null;
    this._msgbuffer = [];
    this.target = target;
  }

  close() {
    if (this._websocket) {
      this._websocket.close();
      this._websocket = null;
    }
  }

  closeWS() {
    this._websocket.close();
    this._websocket = null;
  }

  setWebsocket(ws) {
    if (this._websocket) {
      throw new Error("EventContext already has a websocket");
    }
    this._websocket = ws;
    ws.on("message", message => {
      if (this.listenerCount("message") === 0) {
        this._msgbuffer.push(message.utf8Data);
      }
      this.emit("message", message.utf8Data);
    });
  }

  sendWS(message) {
    this._websocket.sendUTF(message);
  }

  async nextMessage() {
    if (this._msgbuffer.length !== 0) {
      return this._msgbuffer.shift();
    }
    return new Promise((resolve, reject) => {
      const msgHandler = msg => {
        if (!shouldIgnore(msg)) {
          this.removeListener("message", msgHandler);
          this._websocket.removeListener("end", endHandler);
          resolve(msg);
        }
      };
      const endHandler = () => {
        this.removeListener("message", msgHandler);
        reject(new Error("Websocket closed"));
      };

      this.on("message", msgHandler);
      this._websocket.once("end", endHandler);
    });
  }

  resolve(url) {
    return this.target + url;
  }
}
exports.EventContext = EventContext;

class Tokens {
  constructor() {
    this.tokens = [];
    this.tokenMap = new Map();
  }

  registerToken(token, value) {
    if (!/^[a-z]\w*$/i.test(token)) {
      throw new Error("Invalid token name: '" + token + "'");
    }
    if (!value) {
      throw new Error("Token value must be a nonempty string");
    }

    if (this.tokenMap.has(token)) {
      if (this.tokenMap.get(token) !== value) {
        throw new Error(
          [
            `Can't overwrite existing token '${token}'.`,
            `Old value: '${this.tokenMap.get(token)}'.`,
            `New value: '${value}'.`
          ].join(" ")
        );
      }
    }

    this.tokenMap.set(token, value);
    this.tokens.push({
      token: token,
      value: value,
      regex: new RegExp(escapeRegExp(value), "g")
    });
  }

  // Implements a simple string interpolation parser/formatter.
  // ${varname} is used for interpolation. Backslash can be used
  // for escaping (two backslashes must be used for a literal
  // backslash).

  // Replace any known token values in str with ${token_name}.
  // Also escape any \ and $ characters found in str.
  insertTokenPlaceholders(str) {
    str = str.replace(/[$\\]/g, "\\$&");
    this.tokens.forEach(t => {
      str = str.replace(t.regex, "${" + t.token + "}");
    });
    return str;
  }

  // Replace ${token_name} style placeholders with
  replaceTokenPlaceholders(str) {
    return str.replace(/\\(.)|\$\{([a-z]\w*)\}/gi, (m, p1, p2) => {
      if (p1) {
        // escaped character
        return p1;
      } else {
        // token
        if (!this.tokenMap.has(p2)) {
          throw new Error("Unknown token: '" + p2 + "'");
        } else {
          return this.tokenMap.get(p2);
        }
      }
    });
  }

  dump() {
    console.log(this.tokenMap);
  }
}

const eventTypes = new Map();
function registerEvent(name, type) {
  type.type = name;
  eventTypes.set(name, type);
  exports[type.name] = type;
}

class ShinyEvent {
  constructor(created = new Date()) {
    if (new.target === ShinyEvent) {
      throw new TypeError("ShinyEvent is an abstract type");
    }
    this.type = new.target.type;
    this.created = created;
  }

  parse(ctx) {
    throw new TypeError("parse() method must be implemented in subclasses");
  }

  async execute(ctx) {
    throw new TypeError("generate() method must be implemented in subclasses");
  }
}

class ShinyRequestEvent extends ShinyEvent {
  constructor(method, url, created = new Date()) {
    super(created);

    this.method = method;
    this.url = url;
  }

  static fromReq(req) {
    return new ShinyRequestEvent(req.method, req.url);
  }

  static fromJSON(obj) {
    return new ShinyRequestEvent(obj.method, obj.url, obj.created);
  }

  toJSON() {
    return {
      type: this.type,
      created: this.created,
      method: this.method,
      url: this.url
    };
  }

  parse(ctx) {
    this.url = ctx.tokens.insertTokenPlaceholders(this.url);
  }

  async execute(ctx) {
    const url = ctx.resolve(ctx.tokens.replaceTokenPlaceholders(this.url));
    const urlObj = parse(url);
    urlObj.method = this.method;
    urlObj.agent = false;
    // console.log(`Req: ${url}`);
    return new Promise((resolve, reject) => {
      const req = http.request(urlObj, async res => {
        if (res.statusCode !== 200) {
          const body = await this.handleResponse(ctx, res);
          reject(
            new Error(`Request failed with status ${res.statusCode}:\n${body}`)
          );
          return;
        }
        resolve(this.handleResponse(ctx, res));
      });
      req.on("error", err => {
        reject(err);
      });
      req.end();
    });
  }

  async handleResponse(ctx, res) {
    const writer = new streams.WritableStream();
    return new Promise((resolve, reject) => {
      res.on("data", chunk => {
        writer.write(chunk);
      });
      res.on("end", () => {
        resolve(writer.toString());
      });
    });
  }
}
registerEvent("REQ", ShinyRequestEvent);

class ShinyTokenRequestEvent extends ShinyRequestEvent {
  constructor(method, url, created = new Date()) {
    super(method, url, created);
  }

  static fromReq(req) {
    return /__token__/.test(req.url)
      ? new ShinyTokenRequestEvent(req.method, req.url)
      : null;
  }

  static fromJSON(obj) {
    return new ShinyTokenRequestEvent(obj.method, obj.url, obj.created);
  }

  async handleResponse(ctx, res) {
    const writer = new streams.WritableStream();
    return new Promise((resolve, reject) => {
      res.on("data", chunk => {
        writer.write(chunk);
        ctx.tokens.registerToken("TOKEN", chunk.toString());
      });
      res.on("end", () => {
        resolve(writer.toString());
      });
      res.on("error", reject);
    });
  }
}
registerEvent("REQ_TOK", ShinyTokenRequestEvent);

class ShinyHomeRequestEvent extends ShinyRequestEvent {
  constructor(method, url, created = new Date()) {
    super(method, url, created);
  }

  static fromReq(req) {
    return /(\/|\.rmd)($|\?)/i.test(req.url)
      ? new ShinyHomeRequestEvent(req.method, req.url)
      : null;
  }

  static fromJSON(obj) {
    return new ShinyHomeRequestEvent(obj.method, obj.url, obj.created);
  }

  async handleResponse(ctx, res) {
    const writer = new streams.WritableStream();

    return new Promise((resolve, reject) => {
      res.on("data", chunk => {
        writer.write(chunk);
        const m = /<base href="_w_([0-9a-z]+)\/" \/>/i.exec(chunk.toString());
        if (m) {
          ctx.tokens.registerToken("WORKER", m[1]);
        }
      });
      res.on("end", () => {
        resolve(writer.toString());
      });
      res.on("error", reject);
    });
  }
}
registerEvent("REQ_HOME", ShinyHomeRequestEvent);

class ShinySockJSInfoRequestEvent extends ShinyRequestEvent {
  constructor(method, url, created = new Date()) {
    super(method, url, created);
  }

  static fromReq(req) {
    return /__sockjs__.*\/info$/.test(req.url)
      ? new ShinySockJSInfoRequestEvent(req.method, req.url)
      : null;
  }

  static fromJSON(obj) {
    return new ShinySockJSInfoRequestEvent(obj.method, obj.url, obj.created);
  }

  parse(ctx) {
    const m = /\bn=(\w+)\//i.exec(this.url);
    if (m) {
      ctx.tokens.registerToken("ROBUST_ID", m[1]);
    }
    super.parse(ctx);
  }

  async execute(ctx) {
    const buf = new Buffer(16);
    await util.promisify(crypto.randomFill)(buf);
    ctx.tokens.registerToken("ROBUST_ID", buf.toString("hex"));

    return await super.execute(ctx);
  }
}
registerEvent("REQ_SINF", ShinySockJSInfoRequestEvent);

class ShinyWSOpenEvent extends ShinyEvent {
  constructor(url, created = new Date()) {
    super(created);
    this.url = url;
  }

  static fromReq(req) {
    return new ShinyWSOpenEvent(req.url);
  }

  static fromJSON(obj) {
    return new ShinyWSOpenEvent(obj.url, obj.created);
  }

  toJSON() {
    return {
      type: this.type,
      created: this.created,
      url: this.url
    };
  }

  parse(ctx) {
    const m = /\/(\w+\/\w+)\/websocket$/.exec(this.url);
    if (m) {
      ctx.tokens.registerToken("SOCKJSID", m[1]);
    }
    this.url = ctx.tokens.insertTokenPlaceholders(this.url);
  }

  async execute(ctx) {
    const buf = new Buffer(8);
    await util.promisify(crypto.randomFill)(buf);
    ctx.tokens.registerToken("SOCKJSID", `000/${buf.toString("hex")}`);

    const url = ctx.resolve(ctx.tokens.replaceTokenPlaceholders(this.url));
    // console.log(`WSOPEN: ${url}`);

    return new Promise((resolve, reject) => {
      const wsclient = new WebSocketClient();
      wsclient.on("connectFailed", err => {
        reject(err);
      });
      wsclient.on("connect", conn => {
        ctx.setWebsocket(conn);
        resolve();
      });
      wsclient.connect(url);
    });
  }
}
registerEvent("WS_OPEN", ShinyWSOpenEvent);

class ShinyWSSendEvent extends ShinyEvent {
  constructor(message, created = new Date()) {
    super(created);
    this.message = message;
  }

  static fromMessage(message) {
    if (typeof message !== "string") {
      throw new Error("Don't know how to handle non-UTF8 data!");
    }
    return new ShinyWSSendEvent(message);
  }

  static fromJSON(obj) {
    return new ShinyWSSendEvent(obj.message, obj.created);
  }

  toJSON() {
    return {
      type: this.type,
      created: this.created,
      message: this.message
    };
  }

  parse(ctx) {
    this.message = ctx.tokens.insertTokenPlaceholders(this.message);
  }

  async execute(ctx) {
    const message = ctx.tokens.replaceTokenPlaceholders(this.message);
    // console.log("WSSEND: " + message);
    ctx.sendWS(message);
  }
}
registerEvent("WS_SEND", ShinyWSSendEvent);

class ShinyWSReceiveEvent extends ShinyEvent {
  constructor(message, created = new Date()) {
    super(created);
    this.message = message;
  }

  static fromMessage(message) {
    if (typeof message !== "string") {
      throw new Error("Don't know how to handle non-UTF8 data!");
    }
    return new ShinyWSReceiveEvent(message);
  }

  static fromJSON(obj) {
    return new ShinyWSReceiveEvent(obj.message, obj.created);
  }

  toJSON() {
    return {
      type: this.type,
      created: this.created,
      message: this.message
    };
  }

  parse(ctx) {
    this.message = ctx.tokens.insertTokenPlaceholders(this.message);
  }

  async execute(ctx) {
    const msg = await ctx.nextMessage(this.message);
    // console.log(
    //   "WSRECV: ",
    //   parseMessage(msg) ? Object.keys(parseMessage(msg)) : msg
    // );
    this.handleMessage(ctx, msg);
    const msgTemplate = ctx.tokens.insertTokenPlaceholders(msg);
    if (!messageMatch(this.message, msgTemplate)) {
      throw new Error(
        "Messages do not match!\n\n" +
          `Expected:\n${this.message}\n\n` +
          `Actual:\n${msgTemplate}`
      );
    }
  }

  handleMessage(ctx, message) {}
}
registerEvent("WS_RECV", ShinyWSReceiveEvent);

class ShinyWSInitReceiveEvent extends ShinyWSReceiveEvent {
  constructor(message, created = new Date()) {
    super(message, created);
  }

  static fromMessage(message) {
    const msg = parseMessage(message);
    return msg && msg.config ? new ShinyWSInitReceiveEvent(message) : null;
  }

  static fromJSON(obj) {
    return new ShinyWSInitReceiveEvent(obj.message, obj.created);
  }

  parse(ctx) {
    const msg = parseMessage(this.message);
    ctx.tokens.registerToken("SESSION", msg.config.sessionId);
    super.parse(ctx);
  }

  handleMessage(ctx, message) {
    const msg = parseMessage(message);
    ctx.tokens.registerToken("SESSION", msg.config.sessionId);
  }
}
registerEvent("WS_RECV_INIT", ShinyWSInitReceiveEvent);

class ShinyWSCloseEvent extends ShinyEvent {
  constructor(created = new Date()) {
    super(created);
  }

  static fromReq(req) {
    return new ShinyWSCloseEvent();
  }

  static fromJSON(obj) {
    return new ShinyWSCloseEvent(obj.created);
  }

  toJSON() {
    return {
      type: this.type,
      created: this.created
    };
  }

  parse(ctx) {}

  async execute(ctx) {
    ctx.closeWS();
  }
}
registerEvent("WS_CLOSE", ShinyWSCloseEvent);

// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#Using_special_characters
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

// If an unparsed message is from a reconnect-enabled server, it will have a
// message ID on it. We want to ignore those for the purposes of looking at
// matches, because they can vary sometimes (based on ignorable messages
// sneaking into the message stream).
function normalizeMessage(msg) {
  return msg.replace(/^a\["[0-9A-F]+/, 'a["*');
}
function messageMatch(a, b) {
  return normalizeMessage(a) === normalizeMessage(b);
}

const ignorable = ["busy", "progress", "recalculating"];
function shouldIgnore(message) {
  if (/^a\["ACK /.test(message)) {
    return true;
  }

  const msg = parseMessage(message);
  if (!msg) {
    return false;
  }

  const keys = Object.keys(msg);
  if (!keys.find(key => !ignorable.includes(key))) {
    return true;
  }

  if (JSON.stringify(msg) === '{"errors":[],"values":[],"inputMessages":[]}') {
    return true;
  }

  return false;
}
exports.shouldIgnore = shouldIgnore;

function parseMessage(message) {
  const m = /^a\["([0-9A-F*]+#)?0\|m\|(.*)"\]$/.exec(message);
  if (m) {
    return JSON.parse(JSON.parse(`"${m[2]}"`));
  }
  try {
    return JSON.parse(message);
  } catch (err) {
    return null;
  }
}

function fromJSON(obj) {
  const type = obj.type;
  return eventTypes.get(type).fromJSON(obj);
}
exports.fromJSON = fromJSON;

const requestTypes = [
  ShinyTokenRequestEvent,
  ShinyHomeRequestEvent,
  ShinySockJSInfoRequestEvent,
  ShinyRequestEvent
];
function fromReq(req) {
  let res;
  requestTypes.find(reqType => {
    return (res = reqType.fromReq(req));
  });
  return res;
}
exports.fromReq = fromReq;

const messageTypes = [ShinyWSInitReceiveEvent, ShinyWSReceiveEvent];
function fromMessage(message) {
  let res;
  messageTypes.find(msgType => {
    return (res = msgType.fromMessage(message));
  });
  return res;
}
exports.fromMessage = fromMessage;
