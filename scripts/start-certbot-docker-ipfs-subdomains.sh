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

# check creds
if [ -z "${CLOUDFLARE_API_TOKEN+xxx}" ]; then echo "CLOUDFLARE_API_TOKEN not set" && exit; fi

# create certbot credentials files
mkdir -p letsencrypt
mkdir -p cloudflare
cat > $(pwd)/cloudflare/cloudflare.ini <<EOF
dns_cloudflare_api_token = $CLOUDFLARE_API_TOKEN
EOF
chmod 600 cloudflare/cloudflare.ini

# init certbot
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

docker rm -f plebbit-provider-certbot-renew 2>/dev/null

# start certbot renewal loop
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

docker logs --follow plebbit-provider-certbot-renew &

# create nginx config file
mkdir -p nginx
cat > nginx/nginx.conf <<EOF
user nginx;

# 1 worker per cpu, 1024 connections per worker, same as default, maybe change later
worker_processes auto;
events {
    worker_connections 1024;
}

http {
    # enable caching
    proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=plebbit-provider-cache:10m max_size=1g inactive=60m use_temp_path=off;

    # remove nginx header
    server_tokens off;
    add_header Server "";

    # logging
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # disabled since we don't run port 80 on docker
    # redirect http to https
    # server {
    #     listen 80;
    #     listen [::]:80;
    #     server_name .$DOMAIN;

    #     location / {
    #         return 301 https://\$host\$request_uri;
    #     }
    # }

    # proxy https with http2 and http3 to port 80
    server {
        listen 443 ssl;
        listen [::]:443 ssl;
        http2 on;

        server_name .$DOMAIN;

        # NOTE: certbot script creates the folder at /live/ipfs.example.com, not /live/example.com
        ssl_certificate /etc/letsencrypt/live/ipfs.$DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/ipfs.$DOMAIN/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_prefer_server_ciphers off;

        # enable http3 / quic
        add_header Alt-Svc 'h3-23=":443"';

        location / {
            proxy_pass http://127.0.0.1:80;
            proxy_set_header Host \$host;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;

            # enable caching
            proxy_cache plebbit-provider-cache;
            # make sure subdomain is included in cache keys
            proxy_cache_key "\$scheme\$host\$request_uri";
            # only cache if cache-control header is present
            proxy_cache_bypass \$http_cache_control;

            # fix pubsub http2 issue
            proxy_buffering off;
        }
    }
}
EOF

docker rm -f plebbit-provider-nginx-https-proxy 2>/dev/null

# start nginx proxy https to http port 80
# -p 443:443/tcp -p 443:443/udp needed for http3 quic
docker run \
  --detach \
  -v $(pwd)/nginx:/etc/nginx \
  -v $(pwd)/letsencrypt:/etc/letsencrypt \
  --network host \
  --name plebbit-provider-nginx-https-proxy \
  --restart always \
  --log-opt max-size=10m \
  --log-opt max-file=5 \
  nginx:1.27.1

docker logs --follow plebbit-provider-nginx-https-proxy
