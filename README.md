> Note: Cannot use the pubsub provider with Cloudflare to run a subplebbit because Cloudflare timesout the keepalive connection after 2 minutes, and the IPFS HTTP client doesn't automatically reconnect.

#### Install and start

```sh
npm install
node start [--ipfs-gateway-use-subdomains]
```

#### Install and start with Docker

```sh
./start-docker.sh
```

#### Guides

- Docker guide https://github.com/plebbit/pubsub-provider/blob/master/docs/docker-guide.md
