const http = require('http')
const https = require('https')
const {URL} = require('url')
const debug = require('debug')('plebbit-provider:pubsub-provider')

// NOTE: don't use http-proxy module for pubsub because it doesn't trigger kubo.pubsub.subscribe onError

const proxyTarget = new URL('http://127.0.0.1:5001')
const {request: httpRequest} = proxyTarget.protocol === 'https:' ? https : http

const proxyPubsubProvider = (req, res) => {
  debug(req.method, req.url, req.rawHeaders)

  const reqHeaders = {...req.headers}

  // delete proxying related headers
  delete reqHeaders['host']
  delete reqHeaders['connection']

  // remove headers that could potentially cause an ipfs 403 error
  delete reqHeaders['cf-ipcountry']
  delete reqHeaders['cf-ray']
  delete reqHeaders['x-forwarded-proto']
  delete reqHeaders['x-forwarded-for']
  delete reqHeaders['cf-visitor']
  delete reqHeaders['sec-ch-ua']
  delete reqHeaders['sec-ch-ua-mobile']
  delete reqHeaders['user-agent']
  delete reqHeaders['origin']
  delete reqHeaders['sec-fetch-site']
  delete reqHeaders['sec-fetch-mode']
  delete reqHeaders['sec-fetch-dest']
  delete reqHeaders['referer']
  delete reqHeaders['cf-connecting-ip']
  delete reqHeaders['cdn-loop']

  const requestOptions = {
    hostname: proxyTarget.hostname,
    port: proxyTarget.port,
    path: req.url,
    method: req.method,
    headers: reqHeaders
  }
  const proxyReq = httpRequest(requestOptions, (proxyRes) => {
    proxyRes.on('error', (e) => {
      debug('proxy res error:', e.message)
      res.writeHead(502)
      res.end(`Bad Gateway: ${e.message}`)
    })

    // fix error 'has been blocked by CORS policy'
    const resHeaders = {...proxyRes.headers}
    resHeaders['access-control-allow-origin'] = '*'

    res.writeHead(proxyRes.statusCode, resHeaders)
    res.flushHeaders() // send http headers right away, without it kubo.pubsub.subscribe onError not triggered
    proxyRes.pipe(res)
  })
  proxyReq.on('error', (e) => {
    debug('proxy req error:', e.message)
    res.writeHead(500)
    res.end(`Internal Server Error: ${e.message}`)
  })
  req.pipe(proxyReq)
}

module.exports = {proxyPubsubProvider}
