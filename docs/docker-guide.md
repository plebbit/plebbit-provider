#### 1. Install Docker

```
sudo apt update && sudo apt install docker.io
```

> NOTE: if that doesn't work, try https://docs.docker.com/engine/install/ubuntu/


#### 2. Clone the repo

```sh
git clone https://github.com/plebbit/plebbit-provider.git && cd plebbit-provider
```

#### 3. Start docker

```sh
scripts/start-docker.sh
```

> NOTE: this starts docker on port 80, to start on another port, edit start-docker.sh

#### 4. Test that it works

```sh
curl localhost:80/ipns/12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu

# or

curl <ip-of-your-server>:80/ipns/12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu

# you should receive some JSON
```

> NOTE: if it doesn't work, maybe port 80 or 4001 isn't open on your server, tcp or udp 4001 must be open, preferably both

#### 5. Add SSL

- Buy a domain name, e.g. namecheap.com accepts BTC
- Link your domain name with your server https://www.namecheap.com/support/knowledgebase/article.aspx/434/2237/how-do-i-set-up-host-records-for-a-domain/
- 2 options:
1. Start certbot docker with arguments `--domain yourdomain.com --email you@example.com` (replace with your domain name and email)
```sh
scripts/start-certbot-docker.sh --domain yourdomain.com --email you@example.com
```

or

2. Add SSL to your domain using a service like cloudflare https://www.namecheap.com/support/knowledgebase/article.aspx/9607/2210/how-to-set-up-dns-records-for-your-domain-in-cloudflare-account/

> NOTE: if it doesn't work, maybe port 443 isn't open on your server, also pubsub doesn't work with services like cloudflare unless "response buffering" is off, (only available on paid plan), other providers work with cloudflare.

#### 5. Test that it works

```sh
curl https://<your-domain-name>/ipns/12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu

# e.g.

curl https://ipfs.io/ipns/12D3KooWG3XbzoVyAE6Y9vHZKF64Yuuu4TjdgQKedk14iYmTEPWu
```

> NOTE: it can take a few hours for DNS to propagate, so if it doesn't work, try again later

#### 6. Add IPFS gateway subdomains (optional)

1. Add cloudflare DNS record for `*.ipfs.<your-domain>` and `*.ipns.<your-domain>`
  - Go to https://dash.cloudflare.com
  - Choose your domain, then choose the DNS Records section
  - Add record: Type: `A`, Name: `*.ipfs`, IPv4 address: `<ip-of-your-server>`, Proxy status: `unchecked (DNS only)`, TTL: `Auto`
  - Add record: Type: `A`, Name: `*.ipns`, IPv4 address: `<ip-of-your-server>`, Proxy status: `unchecked (DNS only)`, TTL: `Auto`
  - Save

2. Create a cloudflare API token
  - Go to https://dash.cloudflare.com/profile/api-tokens
  - Choose "Edit zone DNS"
  - Under "Zone Resources", select your domain name
  - Continue

3. Run the SSL certificate script (certbot)
  - Run the script `scripts/start-certbot-docker-ipfs-subdomains.sh --domain yourdomain.com --email you@example.com --cloudflare-api-token abc...` (replace with your domain name, email and cloudflare api token)
  - Check the output to see if it succeeded

4. Restart docker with the `--ipfs-gateway-use-subdomains` option

```sh
scripts/start-docker.sh --ipfs-gateway-use-subdomains
```

5. Test that it works
  - If you run `docker ps` you should see 3 containers running `plebbit-provider`, `plebbit-provider-certbot-renew`, `plebbit-provider-nginx-https-proxy`
  - They should autorestart, but if they don't you can start them again with `scripts/start-docker.sh --ipfs-gateway-use-subdomains` and `scripts/start-certbot-docker-ipfs-subdomains.sh --domain yourdomain.com --email you@example.com --cloudflare-api-token abc...`

```sh
curl https://k51qzi5uqu5dihlrq05s0wwl56znhdakocms4ttmb89g4zslkww5ij2wbievra.ipns.<your-domain-name>

# e.g.

curl https://k51qzi5uqu5dihlrq05s0wwl56znhdakocms4ttmb89g4zslkww5ij2wbievra.ipns.ipfsgateway.xyz
```

> NOTE: it can take a few hours for DNS to propagate, so if it doesn't work, try again later
