const http = require('http')
const fs = require('fs').promises
const path = require('path')
const certbotPath = path.join(__dirname, '..', 'certbot-www')

const proxyCerbot = async (req, res) => {
  const requestedPath = path.join('/', decodeURIComponent(req.url))
  const filePath = path.resolve(certbotPath, '.' + requestedPath)

  try {
    if (!filePath.startsWith(certbotPath)) {
      throw Error('invalid file path')
    }
    const data = await fs.readFile(filePath, 'utf8')
    res.writeHead(200, {'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(data)})
    return res.end(data)
  } catch (e) {
    console.log(e)
    res.writeHead(404)
    return res.end(String(e))
  }
}

module.exports = {proxyCerbot}
