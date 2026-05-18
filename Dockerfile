# Node 24: nodig voor de ingebouwde node:sqlite-module.
FROM node:24-alpine

WORKDIR /app

# Alleen productie-dependencies installeren (nodemon is dev-only).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Applicatiebestanden.
COPY server.js db.js ./
COPY public ./public

ENV NODE_ENV=production
# Db (chat.db) en uploads/ leven onder /data — gekoppeld als volume.
ENV DATA_DIR=/data
EXPOSE 3000

CMD ["node", "server.js"]
