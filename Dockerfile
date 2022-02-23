FROM node:14-alpine AS builder

WORKDIR /opt/mx-puppet-steam

RUN apk add --no-cache \
        python3 \
        g++ \
        build-base \
        cairo-dev \
        jpeg-dev \
        pango-dev \
        musl-dev \
        giflib-dev \
        pixman-dev \
        pangomm-dev \
        libjpeg-turbo-dev \
        freetype-dev

# run build process as user in case of npm pre hooks
# pre hooks are not executed while running as root

COPY package.json package-lock.json ./
RUN chown -R node:node /opt/mx-puppet-steam
USER node
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

RUN rm -r node_modules/typescript

FROM node:14-alpine

VOLUME /data

ENV CONFIG_PATH=/data/config.yaml \
    REGISTRATION_PATH=/data/steam-registration.yaml

# su-exec is used by docker-run.sh to drop privileges
RUN apk add --no-cache su-exec pixman cairo pango giflib libjpeg

WORKDIR /opt/mx-puppet-steam
COPY docker-run.sh ./
COPY --from=builder /opt/mx-puppet-steam/node_modules/ ./node_modules/
COPY --from=builder /opt/mx-puppet-steam/build/ ./build/

# change workdir to /data so relative paths in the config.yaml
# point to the persisten volume
WORKDIR /data
ENTRYPOINT ["/opt/mx-puppet-steam/docker-run.sh"]
