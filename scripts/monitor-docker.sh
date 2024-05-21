root_path=$(cd `dirname $0` && cd .. && pwd)
cd "$root_path"

docker rm -f plebbit-provider-monitor 2>/dev/null

docker build \
  --file config/Dockerfile \
  --no-cache \
  --tag plebbit-provider \
  .  2>/dev/null

docker run \
  --detach \
  --name plebbit-provider-monitor \
  --restart always \
  --log-opt max-size=10m \
  --log-opt max-file=5 \
  --volume=$(pwd)/telegram-bot.js:/usr/src/plebbit-provider/telegram-bot.js \
  --volume=$(pwd)/server-info.js:/usr/src/plebbit-provider/server-info.js \
  --volume=$(pwd)/scripts:/usr/src/plebbit-provider/scripts \
  --volume=$(pwd)/chrome-profile:/usr/src/plebbit-provider/chrome-profile \
  plebbit-provider \
  npm run monitor

docker logs --follow plebbit-provider-monitor
