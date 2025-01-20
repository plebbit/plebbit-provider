require('dotenv').config()
const WebSocket = require('ws')
const net = require('net')
const Debug = require('debug')
const debug = Debug('plebbit-provider:ens-provider-ws')
const {allowedMethods, allowedAddresses, plebbitErrorMessage} = require('./ens-provider')
const cache = require('./ens-cache')

const port = 29425

const chainProviderUrl = process.env.ETH_PROVIDER_URL_WS

const startWebSockerServer = () => {
  if (!chainProviderUrl) {
    return
  }

  const onChainProviderMessage = {}
  let chainProviderSocket
  const createChainProviderSocket = () => {
    // start chain provider websocket connection
    chainProviderSocket = new WebSocket(chainProviderUrl)
    chainProviderSocket.on('open', () => {
      debug('connected to chain provider websocket')
    })
    chainProviderSocket.on('close', () => {
      debug('disconnected from chain provider websocket, reconnecting in 5s...')
      setTimeout(() => {
        createChainProviderSocket()
      }, 5000)
    })
    chainProviderSocket.on('error', (error) => {
      console.error('chain provider websocket error:', error)
    })
    chainProviderSocket.on('message', (message) => {
      message = message.toString()
      let jsonMessage
      try {
        jsonMessage = JSON.parse(message)
      }
      catch (e) {
        debug(`couldn't parse chain provider websocket message: '${message}'`)
        return
      }
      debug('received from chain provider', jsonMessage)

      // proxy message from chain provider to the websocket client
      if (jsonMessage.id && onChainProviderMessage[jsonMessage.id]) {
        onChainProviderMessage[jsonMessage.id](jsonMessage)
      }
    })
  }
  const chainProviderSocketStates = {
    undefined: 'missing-chain-provider-url',
    0: 'connecting',
    1: 'open',
    2: 'closing',
    3: 'closed'
  }
  const getChainProviderSocketState = () => chainProviderSocketStates[chainProviderSocket?.readyState]

  createChainProviderSocket()

  // start websocket server
  const server = new WebSocket.Server({
    port, 
    maxPayload: 100000 // 100kb
  })
  console.log(`ens websocket proxy server listening on port ${port}`)

  let nextJsonRpcId = 0
  server.on('connection', (clientSocket) => {
    debug('websocket client connected')
    clientSocket.on('message', (message) => {
      message = message.toString()
      let jsonMessage
      try {
        jsonMessage = JSON.parse(message)
      }
      catch (e) {
        debug(`couldn't parse websocket client message: '${message}'`)
        return
      }

      if (!allowedMethods.has(jsonMessage.method) || !allowedAddresses.has(jsonMessage.params[0]?.to?.toLowerCase?.())) {
        debug('received from websocket client', jsonMessage, 'forbidden')
        clientSocket.send(JSON.stringify({...plebbitErrorMessage, id: jsonMessage.id}))
        return
      }

      const cacheKey = message.replace(/,"id":[^,]*/, '') // remove id field or caching wont work
      const cached = cache?.get(cacheKey)
      debug('received from websocket client', jsonMessage, {cached: !!cached, chainProviderSocketState: getChainProviderSocketState()})
      if (cached) {
        clientSocket.send(JSON.stringify({...cached, id: jsonMessage.id}))
        return
      }

      const id = nextJsonRpcId++
      chainProviderSocket.send(JSON.stringify({...jsonMessage, id}))
      onChainProviderMessage[id] = (chainProviderMessageJson) => {
        // cache successful response
        if (!chainProviderMessageJson.error) {
          cache?.set(cacheKey, chainProviderMessageJson)
        }

        // proxy message from chain provider to the websocket client
        clientSocket.send(JSON.stringify({...chainProviderMessageJson, id: jsonMessage.id}))

        // cleanup
        delete onChainProviderMessage[id]
      }
      // cleanup
      setTimeout(() => {
        delete onChainProviderMessage[id]
      }, 1000 * 60 * 10)
    })
    clientSocket.on('close', () => {
      debug('websocket client disconnected')
    })
    clientSocket.on('error', (error) => {
      console.error('websocket client error:', error)
    })
  })
}
startWebSockerServer()

// use this function in the proxy script
const proxyEnsProviderWs = (req, socket, head) => {
  const targetSocket = net.connect(port, '127.0.0.1', () => {
    // write head
    targetSocket.write(
      `GET ${req.url} HTTP/1.1\r\n` + 
      Object.entries(req.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n\r\n'
    )
    // proxy
    socket.pipe(targetSocket).pipe(socket)
  })
  targetSocket.on('error', (err) => {
    console.error('proxy target error:', err)
    socket.destroy()
  })
  socket.on('error', (err) => {
    console.error('proxy client error:', err)
    targetSocket.destroy()
  })
}

module.exports = {proxyEnsProviderWs}
