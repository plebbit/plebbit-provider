root_path=$(cd `dirname $0` && cd .. && pwd)
cd "$root_path"

docker rm -f plebbit-provider 2>/dev/null

# listen on 8000 and 80 ports because sometimes 80 doesn't work
# 4001 is the ipfs p2p port
docker run \
  --detach \
  --volume=$(pwd):/usr/src/plebbit-provider \
  --workdir=/usr/src/plebbit-provider \
  --name plebbit-provider \
  --restart always \
  --log-opt max-size=100m \
  --log-opt max-file=20 \
  --publish 8000:8000 \
  --publish 80:80 \
  --publish 4001:4001 \
  --publish 4002:4002 \
  node:18 sh -c "npm ci && npm start -- $*"

docker logs --follow plebbit-provider
