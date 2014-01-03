var DHTError = module.exports = function DHTError(type, message) {
  var e = Error(message);

  e.type = type;

  return e;
};
