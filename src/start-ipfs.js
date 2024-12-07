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
const ipfsClientVersion = '0.32.1'
const ipfsClientLinuxUrl = `https://dist.ipfs.io/kubo/v${ipfsClientVersion}/kubo_v${ipfsClientVersion}_linux-${ipfsClientArchitecture}.tar.gz`

// list of http routers to use
const httpRouterUrls = [
  'https://routing.lol',
  'https://peers.pleb.bot',
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
  await startIpfs()
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
    // execSync(`${ipfsBinaryPath} config --json Discovery.MDNS.Enabled false`, {env, stdio: 'inherit'})
    // execSync(`${ipfsBinaryPath} config --json Swarm.DisableNatPortMap true`, {env, stdio: 'inherit'})
    // execSync(`${ipfsBinaryPath} config --json Swarm.EnableHolePunching false`, {env, stdio: 'inherit'})
    // execSync(`${ipfsBinaryPath} config --json Swarm.RelayClient.Enabled false`, {env, stdio: 'inherit'})

    // disable helping network with autonat and relay service to save resources
    // execSync(`${ipfsBinaryPath} config AutoNAT.ServiceMode disabled`, {env, stdio: 'inherit'})
    // execSync(`${ipfsBinaryPath} config --json Swarm.RelayService.Enabled false`, {env, stdio: 'inherit'})
    // execSync(`${ipfsBinaryPath} config --json Swarm.Transports.Network.Relay false`, {env, stdio: 'inherit'})

    // disable metrics to save resources
    // execSync(`${ipfsBinaryPath} config --json Swarm.DisableBandwidthMetrics true`, {env, stdio: 'inherit'})

    // enable disable metrics to debug
    // execSync(`${ipfsBinaryPath} config --json Swarm.ResourceMgr.Enabled true`, {env, stdio: 'inherit'})
    // execSync(`${ipfsBinaryPath} config --json Swarm.DisableBandwidthMetrics false`, {env, stdio: 'inherit'})

    // enable delegated routing as part of plebbit provider
    // not needed because the reverse proxy can expose it
    // execSync(`${ipfsBinaryPath} config --json Gateway.ExposeRoutingAPI true`, {env, stdio: 'inherit'})

    // enable webrtc-direct to test it
    // execSync(`${ipfsBinaryPath} config --json Swarm.Transports.Network.WebRTCDirect true`, {env, stdio: 'inherit'})

    // disable TCP to test if it helps stability
    // execSync(`${ipfsBinaryPath} config --json Swarm.Transports.Network.TCP false`, {env, stdio: 'inherit'})
    // execSync(`${ipfsBinaryPath} config --json Swarm.Transports.Network.Websocket false`, {env, stdio: 'inherit'})
    // execSync(`${ipfsBinaryPath} config --json Swarm.Transports.Network.WebRTCDirect false`, {env, stdio: 'inherit'})

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

    // TODO: remove this, added dht temporarily
    // httpRoutersConfig.Dht = {Type: 'dht', Parameters: {
    //   Mode: 'auto',
    //   PublicIPNetwork: true
    // }}
    // httpRoutersConfig.HttpRoutersParallel.Parameters.Routers.push({
    //   RouterName: 'Dht',
    //   IgnoreErrors : true, // If any of the routers fails, the output will be an error by default. To avoid any error at the output, you must ignore all router errors.
    //   ExecuteAfter: '5s'
    // })

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

async function startIpfs() {
  // start ipfs daemon
  const ipfsProcess = exec(`IPFS_PATH="${ipfsDataPath}" ${ipfsBinaryPath} daemon --migrate --enable-pubsub-experiment --enable-namesys-pubsub`)
  console.log(`ipfs process started with pid ${ipfsProcess.pid}`)
  ipfsProcess.stderr.on('data', console.error)
  ipfsProcess.stdin.on('data', debugIpfs)
  ipfsProcess.stdout.on('data', debugIpfs)
  ipfsProcess.on('error', console.error)
  ipfsProcess.on('exit', () => {
    console.error(`ipfs process with pid ${ipfsProcess.pid} exited`)
    // process.exit(1)
  })
  process.on("exit", () => {
    // exec(`kill ${ipfsProcess.pid + 1}`)
  })
}

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
