var async = require("async"),
    bencode = require("bencode-stream"),
    crypto = require("crypto"),
    events = require("events"),
    KBucket = require("k-bucket");

var DHTError = require("./error"),
    DHTNode = require("./node");

var DHT = module.exports = function DHT(options) {
  options = options || {};

  events.EventEmitter.call(this, options);

  this.id = options.id || Buffer.concat([Buffer("-DHT.JS-"), crypto.randomBytes(12)]);

  this.counter = Math.floor(Math.random() * 4294967295);
  this.waiting = {};
  this.queries = {};

  this.nodes = new KBucket({
    localNodeId: this.id,
  });

  if (Array.isArray(options.nodes)) {
    for (var i=0;i<options.nodes.length;++i) {
      this.addNode(options.nodes[i]);
    }
  }
};
DHT.prototype = Object.create(events.EventEmitter.prototype, {constructor: {value: DHT}});

DHT.Error = DHTError;
DHT.Node = DHTNode;

DHT.prototype.ensureNode = function ensureNode(info) {
  var node = this.nodes.get(info.id);

  if (!node) {
    node = new DHTNode(info);

    this.addNode(node);
  }

  return node;
};

DHT.prototype.addNode = function addNode(node) {
  if (!(node instanceof DHTNode)) {
    node = new DHTNode(node);
  }

  if (this.nodes.get(node.id)) {
    return;
  }

  node.firstSeen = Date.now();

  this.nodes.add(node);

  var self = this;
  node.on("status", function(status) {
    if (status === "bad") {
      self.removeNode(node);
    }
  });
};

DHT.prototype.addNodes = function addNodes(nodes) {
  var self = this;

  nodes.forEach(function(node) {
    if (!node.port) {
      return;
    }

    self.addNode(node);
  });
};

DHT.prototype.removeNode = function removeNode(node) {
  this.nodes.remove(node);
};

DHT.prototype.countNodes = function countNodes() {
  return this.nodes.count();
};

DHT.prototype.bootstrap = function bootstrap(node, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = null;
  }

  options = options || {};

  var self = this;

  var id = options.id || crypto.randomBytes(20);

  node = new DHTNode(node);

  this.findNodeQuery(node, id, options, function(err, res) {
    if (err) {
      return cb(err);
    }

    node.id = res.id;

    self.addNode(node);

    if (Array.isArray(res.nodes)) {
      self.addNodes(res.nodes);
    }

    return cb();
  });
};

DHT.prototype.query = function query(node, method, parameters, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = null;
  }

  options = options || {};

  var self = this;

  var id = Buffer(4);
  id.writeUInt32BE(this.counter++ % 4294967296, 0);

  this.sendQuery(node, id, method, parameters, null, function(err) {
    if (err) {
      return cb(err);
    }

    self.waiting[id.toString("hex")] = {
      method: method,
      parameters: parameters,
      node: node,
      cb: cb,
      timeout: setTimeout(function() {
        node.incrementFailures();

        delete self.waiting[id.toString("hex")];

        return cb(Error("timeout"));
      }, options.timeout || (30 * 1000)),
    };
  });
}

DHT.prototype.getPeers = function getPeers(infoHash, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = null;
  }

  options = options || {};

  var self = this;

  async.map(this.nodes.closest({id: infoHash}, 10), function(node, done) {
    self.getPeersQuery(node, infoHash, options, function(err, peers) {
      if (err) {
        return done(null, []);
      }

      return done(null, peers);
    });
  }, function(err, responses) {
    var peers = [];

    responses.reduce(function(i, v) { return i.concat(v); }, []).forEach(function(peer) {
      for (var i=0;i<peers.length;++i) {
        if (peers[i].host === peer.host && peers[i].port === peer.port) {
          return;
        }
      }

      peers.push(peer);
    });

    return cb(null, peers);
  });
};

DHT.prototype.findNodeQuery = function findNodeQuery(node, id, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = null;
  }

  options = options || {};

  this.query(node, "find_node", {id: this.id, target: id}, options, function(err, res) {
    if (err) {
      return cb(err);
    }

    if (!res.nodes || !Buffer.isBuffer(res.nodes) || res.nodes.length % 26 !== 0) {
      return cb(Error("`nodes' parameter was invalid"));
    }

    var nodes = [];
    for (var i=0;i<res.nodes.length/26;++i) {
      nodes.push({
        id: res.nodes.slice(i * 26, i * 26 + 20),
        host: [].slice.call(res.nodes, i * 26 + 20, i * 26 + 24).join("."),
        port: res.nodes.readUInt16BE(i * 26 + 24),
      });
    }

    return cb(null, {
      id: id,
      nodes: nodes,
    });
  });
};

DHT.prototype.getPeersQuery = function getPeersQuery(node, infoHash, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = null;
  }

  options = options || {};

  var self = this;

  this.query(node, "get_peers", {id: this.id, info_hash: infoHash}, options, function(err, res) {
    if (err) {
      return cb(err);
    }

    var nodes = [],
        peers = [],
        token = null;

    if (res.token && Buffer.isBuffer(res.token)) {
      token = res.token;
      node.token = token;
    }

    if (res.nodes && Buffer.isBuffer(res.nodes) && res.nodes.length % 26 === 0) {
      for (var i=0;i<res.nodes.length/26;++i) {
        nodes.push({
          id: res.nodes.slice(i * 26, i * 26 + 20),
          host: [].slice.call(res.nodes, i * 26 + 20, i * 26 + 24).join("."),
          port: res.nodes.readUInt16BE(i * 26 + 24),
        });
      }
    }

    if (res.values && Array.isArray(res.values)) {
      for (var i=0;i<res.values.length;++i) {
        peers.push({
          host: [].slice.call(res.values[i], 0, 4).join("."),
          port: res.values[i].readUInt16BE(4),
        });
      }
    }

    if (nodes.length > 0) {
      return async.map(nodes.filter(function(child) {
        return KBucket.distance(infoHash, node.id) > KBucket.distance(infoHash, child.id);
      }), function(info, done) {
        var node = new DHTNode(info);

        return self.getPeersQuery(node, infoHash, options, function(err, res) {
          if (err) {
            return done(null, []);
          }

          self.addNode(node);

          return done(null, res);
        });
      }, function(err, results) {
        if (err) {
          return cb(err);
        }

        return cb(null, results.reduce(function(i, v) { return i.concat(v); }, []));
      });
    }

    return cb(null, peers);
  });
};

DHT.prototype.respondTo = function respondTo(query, response, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = null;
  }

  options = options || {};

  if (response instanceof DHTError) {
    return this.sendError(query.node, query.id, response, options, cb);
  } else {
    return this.sendResponse(query.node, query.id, response, options, cb);  
  }
};

DHT.prototype.sendQuery = function sendQuery(node, id, method, parameters, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = null;
  }

  options = options || {};

  var self = this;

  var query = {
    t: id,
    y: "q",
    q: method,
    a: parameters,
  };

  this.sendMessage(node, query, function(err) {
    if (err) {
      return cb(err);
    }

    return cb();
  });
};

DHT.prototype.sendResponse = function sendResponse(node, id, parameters, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = null;
  }

  options = options || {};

  var response = {
    t: id,
    y: "r",
    r: parameters,
  };

  this.sendMessage(node, response, function(err) {
    if (err) {
      return cb(err);
    }

    return cb();
  });
};

DHT.prototype.sendError = function sendError(node, id, err, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = null;
  }

  options = options || {};

  var error = {
    t: id,
    y: "e",
    e: [err.type, err.message],
  };

  this.sendMessage(node, error, function(err) {
    if (err) {
      return cb(err);
    }

    return cb();
  });
};

DHT.prototype.recvQuery = function recvQuery(id, method, parameters, from) {
  var node = this.ensureNode({
    id: parameters.id,
    host: from.address,
    port: from.port,
  });

  node.setLastQuery(Date.now());

  var query = {
    id: id,
    method: method,
    parameters: parameters,
    node: node,
  };

  this.queries[id.toString("hex")] = query;

  this.emit("query", query);
};

DHT.prototype.recvResponse = function recvResponse(id, parameters, from) {
  id = id.toString("hex");

  if (!this.waiting[id]) {
    return this.emit("unassociatedResponse", {
      id: id,
      parameters: parameters,
      from: from,
    });
  }

  var node = this.ensureNode({
    id: parameters.id,
    host: from.address,
    port: from.port,
  });

  node.setLastResponse(Date.now());
  node.resetFailures();

  clearTimeout(this.waiting[id].timeout);

  this.waiting[id].cb.call(null, null, parameters);

  delete this.waiting[id];
};

DHT.prototype.recvError = function recvError(id, error, from) {
  id = id.toString("hex");

  if (!this.waiting[id]) {
    return this.emit("unassociatedError", {
      id: id,
      error: error,
      from: from,
    });
  }

  var node = this.ensureNode({
    id: parameters.id,
    host: from.address,
    port: from.port,
  });

  node.incrementFailures();

  clearTimeout(this.waiting[id].timeout);

  this.waiting[id].cb.call(null, error);

  delete this.waiting[id];
};

DHT.prototype.sendMessage = function sendMessage(node, message, cb) {
  var encoder = new bencode.Encoder(),
      liberator = new bencode.Liberator();

  var self = this;

  var chunks = [];

  liberator.on("error", cb).pipe(encoder).on("error", cb).on("data", function(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer(chunk);
    }

    chunks.push(chunk);
  }).on("end", function() {
    self.emit("outgoing", Buffer.concat(chunks), node);

    return cb();
  });

  liberator.end(message);
};

DHT.prototype.recvMessage = function recvMessage(buffer, from, cb) {
  var decoder = new bencode.Decoder(),
      accumulator = new bencode.Accumulator(),
      objectifier = new bencode.Objectifier();

  var self = this;

  decoder.on("error", cb).pipe(accumulator).on("error", cb).pipe(objectifier).on("error", cb).on("data", function(message) {
    if (typeof message !== "object" || message === null) {
      return cb(Error("root object type was invalid"));
    }

    if (!message.y || !Buffer.isBuffer(message.y)) {
      return cb(Error("`y' type is invalid"));
    }

    if (!message.t || !Buffer.isBuffer(message.t)) {
      return cb(Error("`t' type is invalid"));
    }

    if (message.y[0] !== 0x65 && message.y[0] !== 0x71 && message.y[0] !== 0x72) {
      return cb(Error("`y' value is invalid"));
    }

    if (message.y[0] === 0x65) {
      self.recvError(message.t, DHTError(message.e[0], message.e[1]), from);
    } else if (message.y[0] === 0x71) {
      if (!message.q || !Buffer.isBuffer(message.q)) {
        return cb(Error("`q' type is invalid"));
      }

      if (!message.a || typeof message.a !== "object" || message.a === null || Buffer.isBuffer(message.a)) {
        return cb(Error("`a' type is invalid"));
      }

      self.recvQuery(message.t, message.q, message.a, from);
    } else if (message.y[0] === 0x72) {
      if (!message.r || typeof message.r !== "object" || message.r === null || Buffer.isBuffer(message.r)) {
        return cb(Error("`r' type is invalid"));
      }

      self.recvResponse(message.t, message.r, from);
    }

    return cb(null, message);
  });

  decoder.end(buffer);
};
