const http = require('http')
const {toString} = require('uint8arrays/to-string')

const agent = new http.Agent({keepAlive: true, maxSockets: 99999})
const url = 'http://127.0.0.1:8000/api/v0'

;(async () => {
  const IpfsHttpClient = await import('kubo-rpc-client')
  const ipfsClient = IpfsHttpClient.create({agent, url})

  const onMessageReceived = (message) => {
    console.log(`received message from ${message.from}:`, toString(message.data))
  }
  await ipfsClient.pubsub.subscribe('plebbit test', onMessageReceived)
  console.log('subscribed')
  setInterval(async () => {
    const message = new Date().toISOString()
    try {
      await ipfsClient.pubsub.publish('plebbit test', Buffer.from(message))
      console.log('published message:', message)
    }
    catch (e) {
      console.log(e)
    }
  }, 1000)
})()
