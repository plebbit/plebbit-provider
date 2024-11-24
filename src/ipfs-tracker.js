const http = require('http')
const Debug = require('debug')
const debug = Debug('plebbit-provider:ipfs-tracker')

const port = 29555

const startIpfsTracker = async () => {
  const {default: app} = await import('@plebbit/ipfs-tracker/app.js')
  app.set('port', port)
  const server = http.createServer(app)
  server.listen(port)
  console.log(`ipfs tracker listening on port ${port}`)
}
startIpfsTracker()

const proxyIpfsTracker = async (proxy, req, res) => {
  debug(req.method, req.url, req.rawHeaders)

  // fix error 'has been blocked by CORS policy'
  res.setHeader('Access-Control-Allow-Origin', '*')

  proxy.web(req, res, {target: `http://127.0.0.1:${port}`})
}

module.exports = {proxyIpfsTracker}
