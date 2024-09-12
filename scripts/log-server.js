const http = require('http')
require('util').inspect.defaultOptions.depth = null

const hostname = '127.0.0.1'
const port = 8080

const server = http.createServer((req, res) => {
  let reqBody = ''
  req.on('data', chunk => {reqBody += chunk})
  req.on('end', () => {
    try {
      reqBody = JSON.parse(reqBody)
    }
    catch (e) {}
    console.log({method: req.method, url: req.url, headers: req.headers, body: reqBody})
  })
})

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`)
})
