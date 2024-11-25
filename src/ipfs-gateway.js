const fetch = require('node-fetch')
const debugGateway = require('debug')('plebbit-provider:ipfs-gateway')
const ipfsGatewayUseSubdomains = process.argv.includes('--ipfs-gateway-use-subdomains')

const maxSize = 1048576

const plebbitErrorMessage = 'this ipfs gateway only serves plebbit content'
const timeoutStatus = 504
const timeoutStatusText = 'Gateway Timeout'

const ipfsApiUrl = 'http://127.0.0.1:5001/api/v0'
const ipfsGatewayUrl = 'http://127.0.0.1:8080'

const rewriteIpfsGatewaySubdomainsHost = (proxy) => {
  // must selfHandleResponse: true even on non subdomain gateway, content-type error without it, not sure why, curl says "* Excess found in a read: excess"
  if (!ipfsGatewayUseSubdomains) {
    return
  }
  proxy.on('proxyRes', (proxyRes, req, res) => {
    // request is not a subdomain redirect, ignore it
    if (req.method !== 'GET' || !proxyRes.headers.location || (!req.url.startsWith('/ipfs') && !req.url.startsWith('/ipns'))) {
      res.writeHead(proxyRes.statusCode, proxyRes.headers)
      proxyRes.pipe(res)
      return
    }

    // wait for body
    let body = ''
    proxyRes.on('data', (chunk) => {body += chunk})
    proxyRes.on('end', () => {
      // rewrite 'localhost' in redirect header
      const location = proxyRes.headers.location
      const rewrittenLocation = location.replace('localhost', req.headers.host).replace('http://', 'https://')
      // rewrite 'localhost' in redirect body
      const rewrittenBody = body.replace(location, rewrittenLocation)

      // proxy headers
      Object.keys(proxyRes.headers).forEach((header) => res.setHeader(header, proxyRes.headers[header]))
      res.setHeader('location', rewrittenLocation)
      res.setHeader('content-length', Buffer.byteLength(rewrittenBody))
      // proxy body
      res.end(rewrittenBody)
    })
  })
}

const proxyIpfsGateway = async (proxy, req, res) => {
  debugGateway(req.method, req.headers.host, req.url, req.rawHeaders)

  // host must match kubo Gateway.PublicGateways config
  const rewriteHeaders = {host: 'localhost'}

  // fix error 'has been blocked by CORS policy'
  res.setHeader('Access-Control-Allow-Origin', '*')

  const subdomains = req.headers.host?.split('.') || []
  // if is subdomain redirect, redirect right away
  if (ipfsGatewayUseSubdomains && (subdomains[1] !== 'ipfs' && subdomains[1] !== 'ipns')) {
    proxy.web(req, res, {
      target: ipfsGatewayUrl, 
      headers: rewriteHeaders, // rewrite host header to match kubo Gateway.PublicGateways config
      selfHandleResponse: true // needed to rewrite response body and headers redirect location with original hostname
    })
    return
  }

  let cid, ipnsName
  if (subdomains[1] === 'ipfs' || subdomains[1] === 'ipns') {
    if (subdomains[1] === 'ipns') {
      ipnsName = subdomains[0]
    }
    else {
      cid = subdomains[0]
    }
    // host must match kubo Gateway.PublicGateways config
    rewriteHeaders.host = `${subdomains[0]}.${subdomains[1]}.localhost`
  }
  else {
    const params = req.url.split('/')
    if (params[1] === 'ipns') {
      ipnsName = params[2]
    }
    else {
      cid = params[2]
    }
  }

  let fetched, text, error, json
  try {
    if (ipnsName) {
      const fetched = await fetchWithTimeout(`${ipfsApiUrl}/name/resolve?arg=${ipnsName}`, {method: 'POST'})
      const text = await fetched.text()
      try {
        cid = JSON.parse(text).Path.split('/')[2]
      }
      catch (e) {
        throw Error('failed resolving ipns name')
      }
    }

    fetched = await fetchWithTimeout(`${ipfsApiUrl}/cat?arg=${cid}&length=${maxSize}`, {method: 'POST'})
    text = await fetched.text()
    json = JSON.parse(text)
  }
  catch (e) {
    error = e
  }

  debugGateway(req.method, req.headers.host, req.url, fetched?.status, fetched?.statusText, error?.message || '')

  // request timed out
  if (error?.message === 'request timed out') {
    res.statusCode = timeoutStatus
    res.statusText = timeoutStatusText
    res.end()
    return
  }

  // status was succeeded, but doesn't have json.signature, so is not plebbit content
  if (fetched?.status < 300 && !isPlebbitJson(json)) {
    res.statusCode = 403
    res.end(plebbitErrorMessage)
    return
  }

  proxy.web(req, res, {
    target: ipfsGatewayUrl, 
    headers: rewriteHeaders, // rewrite host header to match kubo Gateway.PublicGateways config
    selfHandleResponse: ipfsGatewayUseSubdomains // content-type error without selfHandleResponse: true with ipfsGatewayUseSubdomains, not sure why, curl says "* Excess found in a read: excess"
  })
}

// plebbit json either has signature or comments or allPostCount
const isPlebbitJson = (json) => json?.signature || json?.comments || json?.allPostCount

const maxTime = 180_000
const fetchWithTimeout = async (url, options) => {
  const AbortController = globalThis.AbortController || await import('abort-controller')

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, maxTime)

  options = {signal: controller.signal, ...options}

  try {
    const response = await fetch(url, options)
    return response
  } catch (e) {
    if (e.message === 'The user aborted a request.') {
      throw Error('request timed out')
    }
    throw (e)
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = {proxyIpfsGateway, rewriteIpfsGatewaySubdomainsHost}