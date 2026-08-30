# --- Build-Stufe ---
FROM node:18-alpine AS build
WORKDIR /app
ENV CI=false
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY public ./public
COPY src ./src
RUN npm run build

# --- Auslieferungs-Stufe ---
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
