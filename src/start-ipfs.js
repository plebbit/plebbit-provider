require('dotenv').config()
const envHttpRouterUrls = process.env.HTTP_ROUTER_URLS ? process.env.HTTP_ROUTER_URLS.split(',').map(url => url.trim()) : []
const Debug = require('debug')
const debugIpfs = require('debug')('plebbit-provider:ipfs')
const {execSync, exec} = require('child_process')
const path = require('path')
const ipfsBinaryPath = path.join(__dirname, '..', 'bin', 'ipfs')
const ipfsDataPath = path.resolve(__dirname, '..', '.ipfs')
const env = {IPFS_PATH: ipfsDataPath}
const fs = require('fs-extra')
const https = require('https')
const ProgressBar = require('progress')
const decompress = require('decompress')
const ipfsGatewayUseSubdomains = process.argv.includes('--ipfs-gateway-use-subdomains')
const tcpPortUsed = require('tcp-port-used')
const ps = require('process')

const architecture = require('os').arch()
let ipfsClientArchitecture
if (architecture === 'ia32') {
  ipfsClientArchitecture = '386'
} else if (architecture === 'x64') {
  ipfsClientArchitecture = 'amd64'
} else if (architecture === 'arm64') {
  ipfsClientArchitecture = 'arm64'
} else if (architecture === 'arm') {
  ipfsClientArchitecture = 'arm'
} else {
  throw Error(`ipfs doesn't support architecture '${architecture}'`)
}
const ipfsClientVersion = '0.34.1'
const ipfsClientLinuxUrl = `https://dist.ipfs.io/kubo/v${ipfsClientVersion}/kubo_v${ipfsClientVersion}_linux-${ipfsClientArchitecture}.tar.gz`

// list of http routers to use
const httpRouterUrls = [
  'https://routing.lol',
  'https://peers.pleb.bot',
  'https://peers.plebpubsub.xyz',
  'https://peers.forumindex.com',
  ...envHttpRouterUrls,
]

;(async () => {
  // download or upgrade
  if (!fs.pathExistsSync(ipfsBinaryPath)) {
    console.log('downloading ipfs... might take a few minutes')
    await downloadIpfs()
  }
  const versionMessage = execSync(`${ipfsBinaryPath} version`, {env, encoding: 'utf-8'}).trim()
  if (!versionMessage.includes(ipfsClientVersion)) {
    console.log(`${versionMessage}, downloading version ${ipfsClientVersion}... might take a few minutes`)
    fs.removeSync(ipfsBinaryPath)
    fs.removeSync(ipfsDataPath)
    await downloadIpfs()
  }

  await initIpfs()

  const startIpfsAutoRestart = async () => {
    let pendingStart = false
    const start = async () => {
      if (pendingStart) {
        return
      }
      pendingStart = true
      try {
        const started = await tcpPortUsed.check(5001, '127.0.0.1')
        if (!started) {
          await startIpfs()
        }
      } catch (e) {
        console.log('failed starting ipfs', e)
      }
      pendingStart = false
    }

    // retry starting ipfs every 1 second,
    // in case it was started by another client that shut down and shut down ipfs with it
    start()
    setInterval(() => {
      start()
    }, 1000)
  }
  startIpfsAutoRestart()
})()

async function initIpfs() {
  // init ipfs binary
  try {
    execSync(`${ipfsBinaryPath} init`, {env, stdio: 'inherit'})
  }
  catch (e) {}

  // custom ipfs settings
  try {
    // turn off local discovery because sometimes causes hosting provider to terminate service
    execSync(`${ipfsBinaryPath} config profile apply server`, {env, stdio: 'inherit'})

    // config gateway
    let PublicGateways = {
      localhost: {Paths: ['/ipfs', '/ipns'], UseSubdomains: ipfsGatewayUseSubdomains}
    }
    execSync(`${ipfsBinaryPath} config  --json Gateway.PublicGateways '${JSON.stringify(PublicGateways)}'`, {env, stdio: 'inherit'})

    // create http routers config
    const httpRoutersConfig = {
      HttpRoutersParallel: {Type: 'parallel', Parameters: {Routers: []}},
      HttpRouterNotSupported: {Type: 'http', Parameters: {Endpoint: 'http://kubonotsupported'}}
    }
    for (const [i, httpRouterUrl] of httpRouterUrls.entries()) {
      const RouterName = `HttpRouter${i+1}`
      httpRoutersConfig[RouterName] = {Type: 'http', Parameters: {
        Endpoint: httpRouterUrl,
        // MaxProvideBatchSize: 1000, // default 100
        // MaxProvideConcurrency: 1 // default GOMAXPROCS
      }}
      httpRoutersConfig.HttpRoutersParallel.Parameters.Routers[i] = {
        RouterName: RouterName,
        IgnoreErrors : true, // If any of the routers fails, the output will be an error by default. To avoid any error at the output, you must ignore all router errors.
        Timeout: '10s'
      }
    }

    const httpRoutersMethodsConfig = {
      'find-providers': {RouterName: 'HttpRoutersParallel'},
      provide: {RouterName: 'HttpRoutersParallel'},
      // not supported by plebbit trackers
      'find-peers': {RouterName: 'HttpRouterNotSupported'},
      'get-ipns': {RouterName: 'HttpRouterNotSupported'},
      'put-ipns': {RouterName: 'HttpRouterNotSupported'}
    }
    execSync(`${ipfsBinaryPath} config Routing.Type custom`, {env, stdio: 'inherit'})
    execSync(`${ipfsBinaryPath} config  --json Routing.Routers '${JSON.stringify(httpRoutersConfig)}'`, {env, stdio: 'inherit'})
    execSync(`${ipfsBinaryPath} config  --json Routing.Methods '${JSON.stringify(httpRoutersMethodsConfig)}'`, {env, stdio: 'inherit'})

    execSync(`${ipfsBinaryPath} config show`, {env, stdio: 'inherit'})
    execSync(`${ipfsBinaryPath} id`, {env, stdio: 'inherit'})
  }
  catch (e) {
    console.log(e)
  }
}

const startIpfs = () => new Promise((resolve, reject) => {
  const ipfsProcess = exec(`IPFS_PATH="${ipfsDataPath}" ${ipfsBinaryPath} daemon --migrate --enable-pubsub-experiment --enable-namesys-pubsub`)
  console.log(`ipfs daemon process started with pid ${ipfsProcess.pid}`)
  let lastError
  ipfsProcess.stderr.on('data', (data) => {
    lastError = data.toString()
    console.error(data.toString())
  })
  ipfsProcess.stdin.on('data', debugIpfs)
  ipfsProcess.stdout.on('data', (data) => {
    data = data.toString()
    debugIpfs(data)
    if (data.includes('Daemon is ready')) {
      resolve()
    }
  })
  ipfsProcess.on('error', console.error)
  ipfsProcess.on('exit', () => {
    console.error(`ipfs process with pid ${ipfsProcess.pid} exited`)
    reject(Error(lastError))
  })
  const tryKill = () => {
    try {
      ps.kill(ipfsProcess.pid)
    } catch (e) {
      console.log(e)
    }
    try {
      // sometimes ipfs doesnt exit unless we kill pid +1
      ps.kill(ipfsProcess.pid + 1)
    } catch (e) {
      console.log(e)
    }
  }
  process.on('exit', () => {
    tryKill()
  })

  // healthcheck on gateway, sometimes stops working and needs restart, dont know why
  setInterval(async () => {
    let res
    try {
      res = await fetch(`http://127.0.0.1:8080/ipfs/abc`).then(res => res.text())
    }
    catch (e) {}
    if (!res?.match('invalid cid')) {
      console.log(`ipfs gateway healthcheck failed, response '${res}', killing ipfs...`)
      tryKill()
    }
  }, 1000 * 60)

  // healthcheck on kubo rpc, sometimes stops working and needs restart, dont know why
  setInterval(async () => {
    let res
    try {
      res = await fetch(`http://127.0.0.1:5001/api/v0/config/show`, {method: 'POST'}).then(res => res.json())
    }
    catch (e) {}
    if (!res?.Identity) {
      console.log(`kubo rpc healthcheck failed, response '${JSON.stringify(res)}', killing ipfs...`)
      tryKill()
    }
  }, 1000 * 60)
})

async function downloadIpfs() {
  const downloadWithProgress = (url) =>
    new Promise((resolve) => {
      const split = url.split('/')
      const fileName = split[split.length - 1]
      const chunks = []
      const req = https.request(url)
      req.on('response', (res) => {
        // handle redirects
        if (res.statusCode == 301 || res.statusCode === 302) {
          resolve(downloadWithProgress(res.headers.location))
          return
        }

        const len = parseInt(res.headers['content-length'], 10)
        console.log()
        const bar = new ProgressBar(`  ${fileName} [:bar] :rate/bps :percent :etas`, {
          complete: '=',
          incomplete: ' ',
          width: 20,
          total: len,
        })
        res.on('data', (chunk) => {
          chunks.push(chunk)
          bar.tick(chunk.length)
        })
        res.on('end', () => {
          console.log('\n')
          resolve(Buffer.concat(chunks))
        })
      })
      req.end()
    })

  // official kubo downloads need to be extracted
  const downloadAndExtract = async (url, destinationPath) => {
    const destinationFolderPath = path.dirname(destinationPath)
    const binName = path.basename(destinationPath)
    const binPath = destinationPath
    if (fs.pathExistsSync(binPath)) {
      return
    }
    const split = url.split('/')
    const fileName = split[split.length - 1]
    const dowloadPath = path.join(destinationFolderPath, fileName)
    const file = await downloadWithProgress(url)
    fs.ensureDirSync(destinationFolderPath)
    await fs.writeFile(dowloadPath, file)
    await decompress(dowloadPath, destinationFolderPath)
    const extractedPath = path.join(destinationFolderPath, 'kubo')
    const extractedBinPath = path.join(extractedPath, binName)
    fs.moveSync(extractedBinPath, binPath)
    fs.removeSync(extractedPath)
    fs.removeSync(dowloadPath)
  }

  await downloadAndExtract(ipfsClientLinuxUrl, ipfsBinaryPath)
}
