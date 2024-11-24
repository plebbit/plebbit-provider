const {execSync, exec} = require('child_process')
const ipfsBinaryPath = require('path').join(__dirname, '..', 'bin', 'ipfs')
const fs = require('fs-extra')
const path = require('path')
const logFolderPath = path.resolve(__dirname, '..', 'logs')
const assert = require('assert')
const waitOn = require('wait-on')
const debugLogs = require('debug')('plebbit-provider:logs')
const cborg = require('cborg')
const {toString} = require('uint8arrays/to-string')
const {fromString} = require('uint8arrays/from-string')
const IpfsHttpClient = require('ipfs-http-client')
const ipfsClient = IpfsHttpClient.create({url: 'http://127.0.0.1:5001/api/v0'})
const {resolveEnsTxtRecord} = require('./utils/ens')
const base64 = require('multiformats/bases/base64')

const subplebbits = [
  {
    "address": "plebtoken.eth",
  },
  {
    "address": "plebwhales.eth",
  },
  {
    "address": "pleblore.eth",
  },
  {
    "address": "politically-incorrect.eth",
  },
  {
    "address": "business-and-finance.eth",
  },
  {
    "address": "movies-tv-anime.eth",
  },
  {
    "address": "plebmusic.eth",
  },
  {
    "address": "videos-livestreams-podcasts.eth",
  },
  {
    "address": "health-nutrition-science.eth",
  },
  {
    "address": "censorship-watch.eth",
  },
  {
    "address": "reddit-screenshots.eth",
  },
  {
    "address": "weaponized-autism.eth",
  },
  {
    "address": "brasilandia.eth",
  },
  {
    "address": "plebpiracy.eth",
  },
  {
    "address": "technopleb.eth",
  },
  {
    "address": "plebbit-ukraine.eth",
  }
]

fs.ensureDirSync(logFolderPath)

const writeLog = async (subplebbitAddress, log) => {
  const timestamp = new Date().toISOString().split('.')[0]
  const date = timestamp.split('T')[0]
  const logFilePath = path.resolve(logFolderPath, subplebbitAddress, date)
  // try to parse message and delete useless fields
  try {
    const message = cborg.decode(log)
    delete message.encrypted
    delete message.acceptedChallengeTypes
    delete message.protocolVersion
    delete message.signature
    try {
      message.challengeRequestId = toString(message.challengeRequestId, 'base58btc')
    }
    catch (e) {}
    // sort the json props so they are easier to read in the logs
    const sorted = {}
    sorted.type = message.type
    sorted.challengeRequestId = message.challengeRequestId
    log = JSON.stringify({...sorted, ...message})
    debugLogs(subplebbitAddress, log)
  }
  catch (e) {
    try {log = toString(log)} catch (e) {}
    debugLogs(e, log?.substring?.(0, 200))
  }
  await fs.appendFile(logFilePath, `${timestamp} ${log}\r\n\r\n`)
}

// log using ipfs http client, possibly not as reliable because of http
// const pubsubLog = async (subplebbitAddress) => {
//   assert(subplebbitAddress)
//   let ipnsName = subplebbitAddress
//   if (ipnsName.includes('.eth')) {
//     ipnsName = await resolveEnsTxtRecord(subplebbitAddress, 'subplebbit-address')
//   }
//   const onMessage = (message) => writeLog(subplebbitAddress, message?.data)
//   await ipfsClient.pubsub.subscribe(ipnsName, onMessage)
// }

const pubsubLog = async (subplebbitAddress) => {
  assert(subplebbitAddress)
  let ipnsName = subplebbitAddress
  if (ipnsName.includes('.eth')) {
    ipnsName = await resolveEnsTxtRecord(subplebbitAddress, 'subplebbit-address')
  }
  const ipfsProcess = exec(`${ipfsBinaryPath} pubsub sub ${ipnsName} --enc=json`)
  ipfsProcess.stderr.on('data', data => debugLogs('stderr', data))
  ipfsProcess.stdin.on('data', data => debugLogs('stdin', data))
  const onMessage = (message) => {
    let data = JSON.parse(message).data
    data = base64.base64url.decode(data)
    return writeLog(subplebbitAddress, data)
  }
  ipfsProcess.stdout.on('data', onMessage)
  ipfsProcess.on('error', data => debugLogs('error', data))
  ipfsProcess.on('exit', () => {
    debugLogs(`ipfs process with pid ${ipfsProcess.pid} exited`)
  })
}

// start logging, after IPFS daemon is open
waitOn({resources: ['http://127.0.0.1:5001/webui']}).then(async () => {
  for (const subplebbit of subplebbits) {
    fs.ensureDirSync(path.resolve(logFolderPath, subplebbit.address))
    try {
      await pubsubLog(subplebbit.address)
      debugLogs('logging', subplebbit)
    }
    catch (e) {
      debugLogs('failed logging', subplebbit, e.message)
    }
  }
})

// start server
const port = 49302
const express = require('express')
const server = express()
const serveIndex = require('serve-index')
// make sure directories can be listed
server.use('/logs', serveIndex(logFolderPath, {'icons': true}))
// make sure files can be viewed in the browser
const setHeaders = (res, path) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
}
server.use('/logs', express.static(logFolderPath, {setHeaders, cacheControl: false}))
server.listen(port)

// use this function in the proxy script
const proxyLogs = (proxy, req, res) => {
  proxy.web(req, res, {target: `http://127.0.0.1:${port}`})
}

module.exports = {proxyLogs}
