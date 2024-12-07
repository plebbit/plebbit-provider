require('dotenv').config()
const http = require('http')
const httpProxy = require('http-proxy')
const {serverMetrics, sendMetrics} = require('./prometheus')
const Debug = require('debug')
const debugProxy = require('debug')('plebbit-provider:proxy')
const debugIpfs = require('debug')('plebbit-provider:ipfs')
Debug.enable('plebbit-provider:*')
const {execSync, exec} = require('child_process')
const ipfsBinaryPath = require('path').join(__dirname, '..', 'bin', 'ipfs')
const fs = require('fs')
const {URL} = require('url')
const pubsubLogs = process.argv.includes('--pubsub-logs')
if (pubsubLogs) {
  const {proxyLogs} = require('./start-logs')
}
const {proxySnsProvider} = require('./sns-provider')
const {proxyEnsProvider} = require('./ens-provider')
const {proxyIpfsGateway, rewriteIpfsGatewaySubdomainsHost} = require('./ipfs-gateway')
const {proxyIpfsTracker} = require('./ipfs-tracker')

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
})

proxy.on('error', (e, req, res) => {
  console.error(e)
  // if not ended, will hang forever
  res.statusCode = 502
  res.setHeader('Content-Type', 'text/plain')
  res.end(`502 Bad Gateway: ${e.message}`)
})

const isSnsProvider = (req) => 
  req.url === '/' 
  && (req.method === 'POST' || req.method === 'OPTIONS')
  && (req.headers['access-control-request-headers']?.includes('solana-client') || req.headers['solana-client'])

// start server
const startServer = (port) => {
  const server = http.createServer()
  serverMetrics(server)

  // never timeout the keep alive connection
  server.keepAliveTimeout = 0

  server.on('request', async (req, res) => {
    // rewrite ipfs gateway to be subdomain for testing
    // req.headers.host = 'bafybeihttekooxzx3ho3toosabl33jee7cmqon3jof2cd4zvzx26p3zoqu.ipfs.localhost'
    // req.url = '/'

    // unrelated endpoints
    if (req.url === '/service-worker.js' || req.url === '/manifest.json' || req.url === '/favicon.ico') {
      res.end()
      return
    }

    if (req.url === '/metrics') {
      return sendMetrics(req, res)
    }

    // .sol provider
    if (isSnsProvider(req)) {
      return proxySnsProvider(proxy, req, res)
    }

    // .eth provider
    if ((req.method === 'POST' || req.method === 'OPTIONS') && req.url === '/') {
      return proxyEnsProvider(proxy, req, res)
    }

    // ipfs gateway endpoints
    const subdomains = req.headers.host?.split('.') || []
    if (req.method === 'GET' && (subdomains[1] === 'ipfs' || subdomains[1] === 'ipns' || req.url.startsWith('/ipfs') || req.url.startsWith('/ipns'))) {
      return proxyIpfsGateway(proxy, req, res)
    }

    // ipfs tracker endpoints
    if (req.url.startsWith('/routing/v1/providers')) {
      return proxyIpfsTracker(proxy, req, res)
    }

    // logs endpoints
    if (pubsubLogs && req.url.startsWith('/logs')) {
      return proxyLogs(proxy, req, res)
    }

    // start of pubsub related endpoints
    debugProxy(req.method, req.url, req.rawHeaders)

    // basic auth allows any api
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

    // no basic auth allows only pubsub api
    else if (!reqHasBasicAuth && !req.url.startsWith('/api/v0/pubsub/pub') && !req.url.startsWith('/api/v0/pubsub/sub')) {
      debugProxy(`bad url '${req.url}' 403`)
      res.statusCode = 403
      res.end()
      return
    }

    // don't let plebbit-js call shutdown
    if (req.url === '/api/v0/shutdown') {
      res.end()
      return
    }

    // fix error 'has been blocked by CORS policy'
    res.setHeader('Access-Control-Allow-Origin', '*')

    proxy.web(req, res, {target: 'http://127.0.0.1:5001'})
  })
  server.on('error', console.error)
  server.listen(port)
  console.log(`proxy server listening on port ${port}`)
}
// listen on port 8000 because sometimes port 80 doesn't work
startServer(8000)
startServer(80)
