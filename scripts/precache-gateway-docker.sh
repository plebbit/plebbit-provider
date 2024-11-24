root_path=$(cd `dirname $0` && cd .. && pwd)
cd "$root_path"

docker rm -f precache-gateway 2>/dev/null

docker build \
  --file config/Dockerfile \
  --no-cache \
  --tag plebbit-provider \
  .  2>/dev/null

docker run \
  --detach \
  --name precache-gateway \
  --restart always \
  --log-opt max-size=10m \
  --log-opt max-file=5 \
  --volume=$(pwd)/scripts:/usr/src/plebbit-provider/scripts \
  plebbit-provider \
  node scripts/precache-gateway

docker logs --follow precache-gateway
