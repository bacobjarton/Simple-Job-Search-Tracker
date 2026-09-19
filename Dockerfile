FROM node:20-alpine

# su-exec drops privileges in the entrypoint, after the volume is chowned.
RUN apk add --no-cache su-exec

WORKDIR /app

COPY package*.json ./
# ci installs exactly what the lockfile pins, and skips dev dependencies.
RUN npm ci --omit=dev

COPY . .

# node:20-alpine already ships an unprivileged "node" user (uid 1000).
RUN mkdir -p /data && chown -R node:node /app /data

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
