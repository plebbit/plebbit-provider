#!/usr/bin/env bash

# go to current folder
cd "$(dirname "$0")"
cd ..

# add env vars
if [ -f .env ]; then
  export $(echo $(cat .env | sed 's/#.*//g'| xargs) | envsubst)
fi

# CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
CERT_EMAIL=estebanabaroa@protonmail.com
DOMAIN=ipfsgateway.xyz

# create directories for credentials
mkdir -p letsencrypt
mkdir -p cloudflare

# create cloudflare credentials file
cat > $(pwd)/cloudflare/cloudflare.ini <<EOF
dns_cloudflare_api_token = $CLOUDFLARE_API_TOKEN
EOF
chmod 600 cloudflare/cloudflare.ini

# start certbot
docker run --rm \
  -v $(pwd)/letsencrypt:/etc/letsencrypt \
  -v $(pwd)/cloudflare:/cloudflare \
  certbot/dns-cloudflare:v2.11.0 certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /cloudflare/cloudflare.ini \
  -d *.ipfs.${DOMAIN} -d *.ipns.${DOMAIN} \
  --agree-tos \
  --non-interactive \
  --email $CERT_EMAIL \
  --preferred-challenges dns-01 \
  --server https://acme-v02.api.letsencrypt.org/directory \
  --dns-cloudflare-propagation-seconds 60

docker run \
  --detach \
  -v $(pwd)/letsencrypt:/etc/letsencrypt \
  -v $(pwd)/cloudflare:/cloudflare \
  --name plebbit-provider-certbot-renew \
  --restart always \
  --log-opt max-size=10m \
  --log-opt max-file=5 \
  --entrypoint "" \
  certbot/dns-cloudflare sh -c '
    while :; do
      echo "checking for certificate renewal..."
      certbot renew --quiet
      echo "renewal check completed on $(date), sleeping for 1 day..."
      sleep 86400
    done'

docker logs --follow plebbit-provider-certbot-renew
