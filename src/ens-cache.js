// use a shared cache for http and ws

const cacheMaxAge = 1000 * 60 * 5

let _cache
import('quick-lru').then(QuickLRU => {
  _cache = new QuickLRU.default({maxSize: 10000, maxAge: cacheMaxAge})
})

const cache = {
  set: (...args) => _cache?.set(...args),
  get: (...args) => _cache?.get(...args)
}

module.exports = cache
