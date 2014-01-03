#!/usr/bin/env node

var crypto = require("crypto"),
    dgram = require("dgram"),
    fs = require("fs");

var DHT = require("./lib/dht");

var socket = dgram.createSocket("udp4");
socket.bind(40000);

var dht = new DHT({
  nodes: fs.existsSync("./nodes.json") && require("./nodes.json").nodes,
});

console.log("starting up; nodeId is %s and we have %d nodes", dht.nodeId.toString("hex"), dht.countNodes());

socket.on("message", function(message, from) {
  // kind of interesting to see
  // console.log("incoming", from, message);

  return dht.recvMessage(message, from, function(err) {
    if (err) {
      return console.trace(err);
    }
  });
});

dht.on("outgoing", function(message, node) {
  // same here, a little bit useful
  // console.log("outgoing", node, message + "");

  if (!node.port) {
    console.log(message, node);
  }

  return socket.send(message, 0, message.length, node.port, node.host, function(err) {
    if (err) {
      return console.trace(err);
    }
  });
});

dht.on("query", function(query) {
  if (query.method.toString() === "ping") {
    console.log("responding to ping: %s from %s", query.id.toString("hex"), query.node.nodeId.toString("hex"));

    var response = {
      id: dht.nodeId,
    };

    return this.respondTo(query, response, null, function(err) {
      if (err) {
        console.trace(err);
      }
    });
  }

  if (query.method.toString() === "find_node") {
    console.log("responding to find_node: %s from %s for %s", query.id.toString("hex"), query.node.nodeId.toString("hex"), query.parameters.target.toString("hex"));

    var response = {
      id: dht.nodeId,
      nodes: Buffer(0),
    };

    return this.respondTo(query, response, null, function(err) {
      if (err) {
        console.trace(err);
      }
    });
  }

  if (query.method.toString() === "get_peers") {
    console.log("responding to get_peers: %s from %s for %s", query.id.toString("hex"), query.node.nodeId.toString("hex"), query.parameters.info_hash.toString("hex"));

    var response = {
      id: dht.nodeId,
      token: crypto.randomBytes(20),
      nodes: Buffer(0),
    };

    return this.respondTo(query, response, null, function(err) {
      if (err) {
        console.trace(err);
      }
    });

    console.log("generating more traffics!");

    this.getPeers(query.id, null, function(err) {
      if (err) {
        console.trace(err);
      }
    });
  }

  console.log("responding with error to %s: %s from %s", query.method.toString(), query.id.toString("hex"), query.node.nodeId.toString("hex"))

  var error = DHT.Error(204, "method not implemented");

  return this.respondTo(query, error, null, function(err) {
    if (err) {
      console.trace(err);
    }
  });
});

// lol, ghetto i know
setInterval(function() {
  fs.writeFileSync("./nodes.json", JSON.stringify({nodes: dht.nodes}, null, 2));
}, 5000);

var initiateSearch = function initiateSearch() {
  // a couple of ubuntu hashes to kick off some queries and responses
  [
    "e3811b9539cacff680e418124272177c47477157",
    "597a92f6eeed29e6028b70b416c847e51ba76c38",
  ].forEach(function(hash) {
    console.log("searching for peers for %s", hash);

    dht.getPeers(Buffer(hash, "hex"), {retries: 5}, function(err, peers) {
      if (err) {
        return console.trace(err);
      }

      return console.log("got %d peers for %s", peers.length, hash);
    });
  });
};

if (dht.countNodes()) {
  initiateSearch();
} else {
  console.log("bootstrapping because we have no nodes!");

  dht.bootstrap({host: "router.bittorrent.com", port: 6881}, function(err) {
    if (err) {
      return console.trace(err);
    }

    console.log("bootstrapped successfuly, we now have %d nodes", dht.countNodes());

    // dump the nodes out straight away
    fs.writeFileSync("./nodes.json", JSON.stringify({nodes: dht.nodes}, null, 2));

    initiateSearch();
  });
}
