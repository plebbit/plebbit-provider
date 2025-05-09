const http = require('http')
const Debug = require('debug')
const debug = Debug('plebbit-provider:plebbit-previewer')

const port = 29556
process.env.PLEBBIT_PREVIEWER_PORT = port

const startPlebbitPreviewer = async () => {
  require('@plebbit/plebbit-previewer/start.js')
  console.log(`plebbit previewer listening on port ${port}`)
}
startPlebbitPreviewer()

const proxyPlebbitPreviewer = async (proxy, req, res) => {
  debug(req.method, req.url, req.rawHeaders)

  // fix error 'has been blocked by CORS policy'
  res.setHeader('Access-Control-Allow-Origin', '*')

  proxy.web(req, res, {target: `http://127.0.0.1:${port}`})
}

module.exports = {proxyPlebbitPreviewer}
