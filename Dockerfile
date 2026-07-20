# Node 24: nodig voor de ingebouwde node:sqlite-module.
FROM node:24-alpine

WORKDIR /app

# Alleen productie-dependencies installeren (nodemon is dev-only).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Applicatiebestanden. LET OP: nieuwe top-level .js-modules hier toevoegen,
# anders crasht de container op een ontbrekende require.
COPY server.js db.js quotes.js rates.js movers.js risk.js ./
COPY public ./public
COPY scripts ./scripts

ENV NODE_ENV=production
# Db (chat.db) en uploads/ leven onder /data — gekoppeld als volume.
ENV DATA_DIR=/data
EXPOSE 3000

CMD ["node", "server.js"]
