require('dotenv').config()
const http = require('http')
const httpProxy = require('http-proxy')

// cli args
const shutdownKey = process.argv.includes('--shutdown-key') && process.argv[process.argv.indexOf('--shutdown-key') + 1]

// routes
const {serverMetrics, sendMetrics} = require('./prometheus')
const {proxySnsProvider, isSnsProvider} = require('./sns-provider')
const {proxyEnsProvider} = require('./ens-provider')
const {proxyEnsProviderWs} = require('./ens-provider-ws')
const {proxyIpfsGateway, rewriteIpfsGatewaySubdomainsHost} = require('./ipfs-gateway')
const {proxyIpfsTracker} = require('./ipfs-tracker')
const {proxyPlebbitPreviewer} = require('./plebbit-previewer')
const {proxyPubsubProvider} = require('./pubsub-provider')
const {proxyCerbot} = require('./certbot')

// logs
const Debug = require('debug')
const debugProxy = require('debug')('plebbit-provider:proxy')
Debug.enable('plebbit-provider:*')

// use basic auth to have access to any ipfs api and /debug/, not just pubsub
const basicAuthUsername = process.env.BASIC_AUTH_USERNAME
const basicAuthPassword = process.env.BASIC_AUTH_PASSWORD

// start ipfs
require('./start-ipfs')

// start proxy
const proxy = httpProxy.createProxyServer({})
rewriteIpfsGatewaySubdomainsHost(proxy)

// rewrite the request
proxy.on('proxyReq', function(proxyReq, req, res, options) {
  // rewrite ipfs gateway to be subdomain for testing
  // proxyReq.host = 'bafybeihttekooxzx3ho3toosabl33jee7cmqon3jof2cd4zvzx26p3zoqu.ipfs.localhost'
  // proxyReq.path = '/'
  // proxyReq.setHeader('host', 'bafybeihttekooxzx3ho3toosabl33jee7cmqon3jof2cd4zvzx26p3zoqu.ipfs.localhost:8080')

  // remove headers that could potentially cause an ipfs 403 error
  proxyReq.removeHeader('CF-IPCountry')
  proxyReq.removeHeader('CF-RAY')
  proxyReq.removeHeader('X-Forwarded-Proto')
  proxyReq.removeHeader('CF-Visitor')
  proxyReq.removeHeader('sec-ch-ua')
  proxyReq.removeHeader('sec-ch-ua-mobile')
  // proxyReq.removeHeader('user-agent')
  proxyReq.removeHeader('origin')
  proxyReq.removeHeader('sec-fetch-site')
  proxyReq.removeHeader('sec-fetch-mode')
  proxyReq.removeHeader('sec-fetch-dest')
  proxyReq.removeHeader('referer')
  proxyReq.removeHeader('CF-Connecting-IP')
  proxyReq.removeHeader('CDN-Loop')

  // ipfs tracker needs forwarded ip
  // TODO: add some option to not trust x-forwarded-for, for when not using a proxy like cloudflare
  // if (!req.url.startsWith('/routing/v1/providers')) {
  //   proxyReq.removeHeader('X-Forwarded-For')
  // }
  // else {
    if (!req.headers['x-forwarded-for']) {
      proxyReq.setHeader('x-forwarded-for', req.connection.remoteAddress)
    // }
  }
})

proxy.on('error', (e, req, res) => {
  console.error(e)
  // if not ended, will hang forever
  res.statusCode = 502
  res.setHeader('Content-Type', 'text/plain')
  res.end(`502 Bad Gateway: ${e.message}`)
})

// start server
const startServer = (port) => {
  const server = http.createServer()
  serverMetrics(server)

  // never timeout the keep alive connection
  server.keepAliveTimeout = 0

  server.on('upgrade', (req, socket, head) => {
    // .eth provider websocket
    return proxyEnsProviderWs(req, socket, head)
  })

  server.on('request', async (req, res) => {
    // rewrite ipfs gateway to be subdomain for testing
    // req.headers.host = 'bafybeihttekooxzx3ho3toosabl33jee7cmqon3jof2cd4zvzx26p3zoqu.ipfs.localhost'
    // req.url = '/'

    // unrelated endpoints
    if (req.url === '/service-worker.js' || req.url === '/manifest.json' || req.url === '/favicon.ico') {
      res.statusCode = 404
      res.end()
      return
    }

    // commit hash
    if (req.url === '/commit-hash') {
      res.end(require('./commit-hash'))
      return
    }

    // certbot nginx proxy
    if (req.url.startsWith('/.well-known/acme-challenge')) {
      console.log(req.method, req.url, req.rawHeaders)
      return proxyCerbot(req, res)
    }

    // secret shutdown endpoint, useful for healthcheck restarts
    if (shutdownKey && req.url === `/${shutdownKey}`) {
      res.end()
      console.log(req.method, req.url, req.rawHeaders)
      console.log('shutdown key requested, shutting down...')
      process.exit()
    }

    if (req.url === '/metrics') {
      return sendMetrics(req, res)
    }

    // ipfs gateway endpoints
    const subdomains = req.headers.host?.split('.') || []
    if ((req.method === 'GET' || req.method === 'OPTIONS') && (subdomains[1] === 'ipfs' || subdomains[1] === 'ipns' || req.url.startsWith('/ipfs') || req.url.startsWith('/ipns'))) {
      return proxyIpfsGateway(proxy, req, res)
    }

    // .sol provider
    if (isSnsProvider(req)) {
      return proxySnsProvider(proxy, req, res)
    }

    // .eth provider
    if ((req.method === 'POST' || req.method === 'OPTIONS') && req.url === '/') {
      return proxyEnsProvider(proxy, req, res)
    }

    // ipfs tracker endpoints
    if (req.url.startsWith('/routing/v1/providers')) {
      return proxyIpfsTracker(proxy, req, res)
    }

    // plebbit previewer endpoints
    if (req.url.startsWith('/c/') || req.url.startsWith('/p/')) {
      return proxyPlebbitPreviewer(proxy, req, res)
    }

    let reqHasBasicAuth = false
    const reqBasicAuthHeader = (req.headers.authorization || '').split(' ')[1] || ''
    const [reqBasicAuthUsername, reqBasicAuthPassword] = Buffer.from(reqBasicAuthHeader, 'base64').toString().split(':')
    if (basicAuthUsername && basicAuthPassword && basicAuthUsername === reqBasicAuthUsername && basicAuthPassword === reqBasicAuthPassword) {
      reqHasBasicAuth = true
    }

    // debug api for prometheus metrics https://github.com/ipfs/kubo/blob/master/docs/config.md#internalbitswap 
    // e.g. http://127.0.0.1:5001/debug/metrics/prometheus
    if (req.url.startsWith('/debug/')) {
      // handle basic auth properly to be compatible with prometheus scrape services
      if ((basicAuthUsername || basicAuthPassword) && !reqHasBasicAuth) {
        res.setHeader('WWW-Authenticate', 'Basic')
        res.statusCode = 401
        res.end()
        return
      }
    }

    // don't let plebbit-js call shutdown or change config
    if (req.url === '/api/v0/shutdown' || req.url.startsWith('/api/v0/config')) {
      debugProxy(`forbidden url '${req.url}' 403`)
      res.statusCode = 403
      res.end()
      return
    }

    // pubsub endpoints
    if (req.url.startsWith('/api/v0/pubsub/pub') || req.url.startsWith('/api/v0/pubsub/sub')) {
      proxyPubsubProvider(req, res)
      return
    }

    // ipfs api endpoints (with basic auth only)
    if (reqHasBasicAuth) {
      debugProxy(req.method, req.url, req.rawHeaders)
      // fix error 'has been blocked by CORS policy'
      res.setHeader('Access-Control-Allow-Origin', '*')
      proxy.web(req, res, {target: 'http://127.0.0.1:5001'})
      return
    }

    // no matches to proxy
    debugProxy(`bad url '${req.url}' 403`)
    res.statusCode = 403
    res.end()
  })
  server.on('error', console.error)
  server.listen(port)
  console.log(`proxy server listening on port ${port}`)
}
// listen on port 8000 because sometimes port 80 doesn't work
startServer(8000)
startServer(80)
