FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
# Bewusst keine Einzelaufzaehlung: die Liste wurde beim Hinzufuegen von
# simple-auth.js vergessen, das Backend startete danach nicht mehr.
COPY *.js ./
COPY drivers ./drivers
# Named Volume erbt Besitzer aus dem Image — sonst darf "node" nicht ins Audit-Log schreiben.
RUN mkdir -p /data && chown node:node /data
EXPOSE 3000
USER node
CMD ["node", "index.js"]
