const http = require('http')
const fs = require('fs').promises
const path = require('path')
const certbotPath = path.join(__dirname, 'certbot-www')

const proxyCerbot = async (req, res) => {
  const safePath = path.normalize(req.url).replace(/^(\.\.[\/\\])+/, '')
  const filePath = path.join(certbotPath, safePath)
  try {
    const data = await fs.readFile(filePath, 'utf8')
    res.writeHead(200, {'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(data)})
    return res.end(data)
  } catch (e) {
    res.writeHead(404)
    return res.end(e)
  }
}

module.exports = {proxyCerbot}
