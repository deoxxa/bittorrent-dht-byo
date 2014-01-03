bittorrent-dht
==============

A middle-level library for interacting with the BitTorrent DHT network

Overview
--------

This library implements all of the parsing, some of the logic, and none of the
networking required to talk to the BitTorrent DHT network. It knows how to parse
and serialise messages, keep track of nodes and their health, correlate queries
and responses, and (currently quite badly) traverse the network to find peers
for a specific info_hash.

Usage
-----

```js
var Bitfield = require("opaque-bitfield");

var bf = new Bitfield();

bf.set(0, true);

console.log(bf.get(0));
```

API
---

### DHT (constructor)

```js
DHT(options);
```

```js
var dht = new DHT({
  nodeId: Buffer("12345678901234567890"),
  nodes: [...],
});
```

Arguments

* **options** - an object specifying options
  * **nodeId** - a 20-byte buffer; the node ID (optional)
  * **nodes** - an array of `DHTNode`-compatible objects - they will be turned
    into `DHTNode` objects if they're not already (optional)

### DHT.countNodes

```js
countNodes();
```

Use this to get the number of known nodes. Using this, you can decide whether
or not to bootstrap from a public router or something.

```js
var count = dht.countNodes();

if (count === 0) {
  dht.bootstrap(...);
}
```

### DHT.bootstrap

```js
bootstrap(node, options, cb);
```

Use `bootstrap` to get your DHT primed and ready for use if you don't know of
any nodes yet. You need to point it at a known-good DHT node. There are a few
floating around that aren't too hard to find.

```js
var node = new DHT.Node({
  host: "public.dht.router",
  port: 12345,
});

var nodeId = Buffer("01234567890123456789");

dht.bootstrap(node, {nodeId: nodeId}, function(err) {
  if (err) {
    // there was an error bootstrapping, things probably won't work well
  } else {
    // you should be good to go!
  }
});
```

Arguments

* **node** - a known-good `DHTNode`
* **options** - an object specifying options
  * **nodeId** - the initial node ID to use as a "dummy" search
* **cb** - a function that's called on completion or failure

### DHT.getPeers

```js
getPeers(infoHash, options, cb);
```

Use `getPeers` to get a list of peers for a given info_hash.

```js
var hash = Buffer("597a92f6eeed29e6028b70b416c847e51ba76c38", "hex"),
    options = {retries: 3};

dht.getPeers(hash, options, function gotPeers(err, peers) {
  console.log(err, peers);
});
```

Arguments

* **hash** - a buffer specifying the info_hash to get peers for
* **options** - an object specifying options
  * **retries** - how many times to retry the search operation if no peers are
    found (optional, default 1)
* **cb** - a function that will be called upon completion or failure

### DHT.on("outgoing")

```js
on("outgoing", function(message, node) { ... });
```

This event tells you when the DHT is trying to send a message to a remote node.

```js
dht.on("outgoing", function(message, node) {
  socket.send(message, 0, message.length, node.port, node.host, function(err) { ... });
});
```

Parameters

* **message** - a buffer containing the serialised message
* **node** - a `DHTNode` object; the intended recipient of the message

### DHT.on("query")

```js
on("query", function(query) { ... });
```

This event is fired when a query is received and parsed correctly.

```js
dht.on("query", function(query) {
  console.log(query.method.toString());
});
```

Parameters

* **query** - an object representing the query
  * **method** - a buffer; the query method
  * **id** - a buffer; the ID of the query
  * **node** - a `DHTNode` object; the sender of the query
  * **parameters** - an object; named parameters for the query

### DHT.on("unassociatedResponse")

```js
on("unassociatedResponse", function(response) { ... });
```

This event fires when a response is received that doesn't correlate with a known
query of ours. This can happen if a response is sent after a timeout has already
fired, for example, or if a remote node is just confused or broken.

```js
dht.on("unassociatedResponse", function(response) {
  console.log(response.id);
});
```

Parameters

* **response** - an object representing the response
  * **id** - a buffer; the ID of the response
  * **parameters** - an object; named parameters of the response
  * **from** - an object; the sender of the response (*not* a `DHTNode` object!)

### DHT.on("unassociatedError")

```js
on("unassociatedError", function(error) { ... });
```

This is the same as the `unassociatedResponse` event, in that it fires when an
error is received under similar conditions.

```js
dht.on("unassociatedError", function(error) {
  console.log(error.id);
});
```

Parameters

* **response** - an object representing the response
  * **id** - a buffer; the ID of the response
  * **error** - a `DHTError` object; the error content
  * **from** - an object; the sender of the response (*not* a `DHTNode` object!)

License
-------

3-clause BSD. A copy is included with the source.

Contact
-------

* GitHub ([deoxxa](http://github.com/deoxxa))
* Twitter ([@deoxxa](http://twitter.com/deoxxa))
* Email ([deoxxa@fknsrs.biz](mailto:deoxxa@fknsrs.biz))
