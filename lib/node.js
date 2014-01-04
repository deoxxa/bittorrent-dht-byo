var events = require("events");

var DHTNode = module.exports = function DHTNode(options) {
  events.EventEmitter.call(this, options);

  this.id = options.id || null;
  this.host = options.host || null;
  this.port = typeof options.port === "number" ? options.port : null;
  this.firstSeen = options.firstSeen || null;
  this.lastQuery = options.lastQuery || null;
  this.lastResponse = options.lastResponse || null;
  this.token = options.token || null;

  this.status = "questionable";
  this.failures = 0;

  if (typeof this.id === "string") {
    this.id = Buffer(this.id, "hex");
  } else if (Array.isArray(this.id)) {
    this.id = Buffer(this.id);
  }

  if (typeof this.token === "string") {
    this.token = Buffer(this.token, "hex");
  } else if (Array.isArray(this.token)) {
    this.token = Buffer(this.token);
  }
};
DHTNode.prototype = Object.create(events.EventEmitter.prototype, {constructor: {value: DHTNode}});

DHTNode.prototype.toJSON = function toJSON() {
  return {
    id: this.id ? this.id.toString("hex") : null,
    host: this.host,
    port: this.port,
    firstSeen: this.firstSeen,
    lastQuery: this.lastQuery,
    lastResponse: this.lastResponse,
    token: this.token ? this.token.toString("hex") : null,
  };
};

DHTNode.prototype.toPeerInfo = function toPeerInfo() {
  var p = Buffer(2),
      h = Buffer(this.host.split(".").map(function(e) { return parseInt(e, 10); }));

  p.writeUInt16BE(this.port);

  return Buffer.concat([h, p]);
};

DHTNode.prototype.toNodeInfo = function toNodeInfo() {
  return Buffer.concat([
    this.id,
    this.toPeerInfo(),
  ]);
};

DHTNode.prototype.setToken = function setToken(token) {
  this.token = token;

  this.emit("token", token);
};

DHTNode.prototype.setStatus = function setStatus(status) {
  if (this.status === status) {
    return;
  }

  this.status = status;

  this.emit("status", status);
};

DHTNode.prototype.setLastQuery = function setLastQuery(time) {
  this.lastQuery = time;

  if (this.lastResponse) {
    this.setStatus("good");

    if (this.questionableTimeout) {
      clearTimeout(this.questionableTimeout);
    }

    var self = this;
    this.questionableTimeout = setTimeout(function() {
      self.setStatus("questionable");
    }, 15 * 60 * 1000);
  }
};

DHTNode.prototype.setLastResponse = function setLastResponse(time) {
  this.lastResponse = time;

  this.setStatus("good");

  if (this.questionableTimeout) {
    clearTimeout(this.questionableTimeout);
  }

  this.questionableTimeout = setTimeout(function() {
    self.setStatus("questionable");
  }, 15 * 60 * 1000);
};

DHTNode.prototype.incrementFailures = function incrementFailures() {
  this.failures++;

  // if the node has failed more than 3 times, or it's never succeeded, mark it
  // as bad
  if (this.failures > 3 || this.lastResponse === null) {
    this.setStatus("bad");
  }
};

DHTNode.prototype.resetFailures = function resetFailures() {
  this.failures = 0;
};
