const http = require('http')
const httpProxy = require('http-proxy')
require('dotenv').config()
const Debug = require('debug')
const debug = Debug('plebbit-provider:ens-provider')
const streamify = require('stream-array')

const cacheMaxAge = 1000 * 60 * 5

const chainProviderUrl = process.env.ETH_PROVIDER_URL
let chainProvider
try {
  chainProvider = new URL(chainProviderUrl)
}
catch (e) {}

const allowedMethods = new Set([
  // ethers.js sometimes calls this method
  'eth_chainId', 
  // needed to resolve domains
  'eth_call',
  // viem sometimes calls this method
  'net_version'
])
const allowedAddresses = new Set([
  // eth_chainId doesn't have a "to" field
  undefined,
  // ENS PublicResolver (used by ethers.js)
  '0x4976fb03c32e5b8cfe2b6ccb31c09ba78ebaba41',
  // ENSRegistryWithFallback (used by ethers.js)
  '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e',
  // UniversalResolver (used by viem)
  '0xc0497e381f536be9ce14b0dd3817cbcae57d2f62',
  '0xce01f8eee7e479c928f8919abd53e553a36cef67',
])
const plebbitErrorMessage = {
  jsonrpc: '2.0',
  error: {
    code: 429,
    event: -33200,
    message: 'Forbidden Plebbit Content Only, Method Or Address Not Allowed',
    details: 'This RPC serves plebbit content only. Contact RPC admin to have method or address whitelisted.'
  }
}
const noChainProviderUrlErrorMessage = `env variable 'ETH_PROVIDER_URL' not defined`

let cache
import('quick-lru').then(QuickLRU => {
  cache = new QuickLRU.default({maxSize: 10000, maxAge: cacheMaxAge})
})

// start proxy
const proxy = httpProxy.createProxyServer({})

// rewrite the request
proxy.on('proxyReq', function(proxyReq, req, res, options) {
  // remove headers that could potentially cause an ipfs 403 error
  proxyReq.removeHeader('CF-IPCountry')
  proxyReq.removeHeader('X-Forwarded-For')
  proxyReq.removeHeader('CF-RAY')
  proxyReq.removeHeader('X-Forwarded-Proto')
  proxyReq.removeHeader('CF-Visitor')
  proxyReq.removeHeader('sec-ch-ua')
  proxyReq.removeHeader('sec-ch-ua-mobile')
  proxyReq.removeHeader('user-agent')
  proxyReq.removeHeader('origin')
  proxyReq.removeHeader('sec-fetch-site')
  proxyReq.removeHeader('sec-fetch-mode')
  proxyReq.removeHeader('sec-fetch-dest')
  proxyReq.removeHeader('referer')
  proxyReq.removeHeader('CF-Connecting-IP')
  proxyReq.removeHeader('CDN-Loop')

  // easier caching logic without encoding
  proxyReq.removeHeader('Accept-Encoding')

  // fix bug where path name has extra / added after
  proxyReq.path = chainProvider.pathname + chainProvider.search
})
proxy.on('error', (e, req, res) => {
  console.error(e)
  // if not ended, will hang forever
  res.statusCode = 502
  res.setHeader('Content-Type', 'text/plain')
  res.end(`502 Bad Gateway: ${e.message}`)
})
proxy.on('proxyRes', async (proxyRes, req, res) => {
  // cache response
  if (proxyRes.statusCode === 200) {
    try {
      const chunks = await getBodyChunks(proxyRes)
      const resBody = chunks.join('')
      if (!resBody.includes('"error":')) { // shouldn't happen with res.statusCode === 200, but just in case
        const reqBody = req.jsonBody.replace(/,"id":[^,]*/, '') // remove id field or caching wont work
        cache?.set(reqBody, resBody)
      }
    }
    catch (e) {}
  }
})
proxy.on('upgrade', (req, socket, head) => {
  // proxy.ws(req, socket, head)
  debug('ws upgrade')
})

// start server
const startServer = (port) => {
  const server = http.createServer()

  // never timeout the keep alive connection
  server.keepAliveTimeout = 0

  server.on('request', async (req, res) => {
    // unrelated endpoints
    if (req.url === '/service-worker.js' || req.url === '/manifest.json' || req.url === '/favicon.ico') {
      res.end()
      return
    }

    if (!chainProviderUrl) {
      debug(req.method, req.url, req.headers, noChainProviderUrlErrorMessage)
      res.statusCode = 500
      res.end(noChainProviderUrlErrorMessage)
      return
    }

    // fix error 'has been blocked by CORS policy'
    res.setHeader('Access-Control-Allow-Origin', '*')

    // fix preflight cors
    if (req.method === 'OPTIONS') {
      debug(req.method, req.url, req.headers)
      res.setHeader('Access-Control-Allow-Methods', 'POST')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      proxy.web(req, res, {target: chainProviderUrl, changeOrigin: true})
      return
    }

    let body
    let bodyChunks = []
    let jsonBody
    try {
      bodyChunks = await getBodyChunks(req)
      jsonBody = bodyChunks.join('')
      body = JSON.parse(jsonBody)
    }
    catch (e) {
      debug(req.method, req.url, req.headers, 'failed parsing body')
      res.end()
      return
    }

    if (!allowedMethods.has(body.method) || !allowedAddresses.has(body.params[0]?.to?.toLowerCase?.())) {
      debug(req.method, req.url, req.headers, body, 'forbidden')
      res.statusCode = 403
      res.end(JSON.stringify({...plebbitErrorMessage, id: body.id}))
      return
    }

    // handle cache
    const cached = cache?.get(jsonBody.replace(/,"id":[^,]*/, '')) // remove id field or caching wont work)
    debug(req.method, req.url, req.headers, body, `cached: ${!!cached}`)
    if (cached) {
      res.setHeader('Content-Type', 'application/json')
      res.statusCode = 200
      res.end(cached.replace(/,"id":[^,]*/, `,"id":${body.id}`)) // add back original id field
      return
    }
    req.jsonBody = jsonBody

    // expires after 5 minutes (300 seconds), must revalidate if expired
    // ENS must not be cached for too long otherwise user can't see his changes reflected
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate')

    proxy.web(req, res, {
      target: chainProviderUrl,
      // must re-stream the post body when you read it with getBodyChunks(req)
      buffer: streamify(bodyChunks),
      // the proxy changes the host to localhost without changeOrigin
      changeOrigin: true,
    })
  })
  server.on('error', console.error)
  server.listen(port)
  console.log(`ens proxy server listening on port ${port}`)
}
const port = 29553
startServer(port)

const getBodyChunks = (req) => new Promise((resolve, reject) => {
  let body = ''
  const chunks = []
  req.on('data', (data) => {
    body += data
    chunks.push(data)
    // Too much POST data, kill the connection!
    // 1e6 === 1 * Math.pow(10, 6) === 1 * 1000000 ~~~ 1MB
    if (body.length > 1e6) {
      req.connection.destroy()
      return reject(Error('body too big'))
    }
  })
  req.on('end', () => {
    resolve(chunks)
  })
  setTimeout(resolve, 5000)
})

// use this function in the proxy script
const proxyEnsProvider = (proxy, req, res) => {
  proxy.web(req, res, {target: `http://127.0.0.1:${port}`})
}

module.exports = {proxyEnsProvider, allowedMethods, allowedAddresses, plebbitErrorMessage}
