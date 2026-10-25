const NodeCache = require('node-cache');

// Standard TTL: 5 minutes (300 seconds), Check period: 60 seconds
// useClones:false — deep-cloning the 193k-video array on every cache miss
// took 30s+ of CPU + GC thrash (clone package). Values are never mutated
// in place, so storing references is safe and instant.
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

const getCache = (key) => {
  return cache.get(key);
};

const setCache = (key, value, ttl = 300) => {
  return cache.set(key, value, ttl);
};

const deleteCache = (key) => {
  return cache.del(key);
};

const clearCache = () => {
  return cache.flushAll();
};

module.exports = {
  getCache,
  setCache,
  deleteCache,
  clearCache,
};
