FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY index.js actions.js jobs.js auth.js settings.js portal-tools.js ./
COPY drivers ./drivers
# Named Volume erbt Besitzer aus dem Image — sonst darf "node" nicht ins Audit-Log schreiben.
RUN mkdir -p /data && chown node:node /data
EXPOSE 3000
USER node
CMD ["node", "index.js"]
