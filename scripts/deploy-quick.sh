#!/usr/bin/env bash

# deploy to a server

# go to current folder
cd "$(dirname "$0")"
cd ..

# add env vars
if [ -f .deploy-env ]; then
  export $(echo $(cat .deploy-env | sed 's/#.*//g'| xargs) | envsubst)
fi

# check creds
if [ -z "${DEPLOY_HOST+xxx}" ]; then echo "DEPLOY_HOST not set" && exit; fi
if [ -z "${DEPLOY_USER+xxx}" ]; then echo "DEPLOY_USER not set" && exit; fi
if [ -z "${DEPLOY_PASSWORD+xxx}" ]; then echo "DEPLOY_PASSWORD not set" && exit; fi

SCRIPT="
docker rm -f plebbit-provider 2>/dev/null

cd /home
git clone https://github.com/plebbit/plebbit-provider.git
cd plebbit-provider
git reset HEAD --hard
git pull --rebase
git log -1

docker run \
  --detach \
  --volume=\$(pwd):/usr/src/plebbit-provider \
  --workdir=/usr/src/plebbit-provider \
  --name plebbit-provider \
  --restart always \
  --log-opt max-size=100m \
  --log-opt max-file=20 \
  --publish 8000:8000 \
  --publish 80:80 \
  --publish 4001:4001 \
  --publish 4002:4002 \
  node:20 sh -c \"npm start -- --ipfs-gateway-use-subdomains\"

docker logs --follow plebbit-provider
"

echo "$SCRIPT" | sshpass -p "$DEPLOY_PASSWORD" ssh "$DEPLOY_USER"@"$DEPLOY_HOST"
