FROM buildkite/puppeteer:10.0.0

# upgrade node
RUN npm install -g n && n 16

# install
WORKDIR /usr/src/plebbit-provider
COPY ./package.json /usr/src/plebbit-provider/package.json
COPY ./package-lock.json /usr/src/plebbit-provider/package-lock.json
RUN npm ci
COPY ./src /usr/src/plebbit-provider/src
COPY ./bin /usr/src/plebbit-provider/bin

# ipfs p2p port
EXPOSE 4001

CMD [ "node", "src/start.js" ]
