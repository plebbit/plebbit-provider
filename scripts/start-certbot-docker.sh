#!/usr/bin/env bash

# go to current folder
cd "$(dirname "$0")"
cd ..

# add env vars
if [ -f .env ]; then
  export $(echo $(cat .env | sed 's/#.*//g'| xargs) | envsubst)
fi

# parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    --email)
      CERT_EMAIL="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1"
      exit 1
      ;;
  esac
done

# validate args
if [ -z "$DOMAIN" ] || [ -z "$CERT_EMAIL" ]; then
  echo "Usage: $0 --domain yourdomain.com --email you@example.com"
  exit 1
fi

# init certbot
mkdir -p letsencrypt
mkdir -p certbot-www

docker run --rm \
  -v $(pwd)/letsencrypt:/etc/letsencrypt \
  -v $(pwd)/certbot-www:/var/www/certbot \
  certbot/certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  -d $DOMAIN \
  --agree-tos \
  --non-interactive \
  --email $CERT_EMAIL \
  --preferred-challenges http \
  --server https://acme-v02.api.letsencrypt.org/directory

docker rm -f plebbit-provider-certbot-renew 2>/dev/null

# start certbot renewal loop
docker run \
  --detach \
  -v $(pwd)/letsencrypt:/etc/letsencrypt \
  -v $(pwd)/certbot-www:/var/www/certbot \
  --name plebbit-provider-certbot-renew \
  --restart always \
  --log-opt max-size=10m \
  --log-opt max-file=5 \
  --entrypoint "" \
  certbot/certbot sh -c '
    while :; do
      echo "checking for certificate renewal..."
      certbot renew --webroot --webroot-path /var/www/certbot --quiet
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

    # serve acme http‑01 challenge
    # not on port 80 because that's where the plebbit-provider is
    server {
        listen 48709;
        listen [::]:48709;
        server_name $DOMAIN;

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
    }

    # proxy https with http2 and http3 to port 80
    server {
        listen 443 ssl;
        listen [::]:443 ssl;
        http2 on;

        server_name $DOMAIN;

        ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

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
        }
    }
}
EOF

docker rm -f plebbit-provider-nginx-https-proxy 2>/dev/null

# start nginx proxy https to http port 80 (and serve webroot)
# -p 443:443/tcp -p 443:443/udp needed for http3 quic
docker run \
  --detach \
  -v $(pwd)/nginx:/etc/nginx \
  -v $(pwd)/letsencrypt:/etc/letsencrypt \
  -v $(pwd)/certbot-www:/var/www/certbot \
  --network host \
  --name plebbit-provider-nginx-https-proxy \
  --restart always \
  --log-opt max-size=10m \
  --log-opt max-file=5 \
  nginx:1.27.1

docker logs --follow plebbit-provider-nginx-https-proxy
