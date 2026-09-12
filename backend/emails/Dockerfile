# Imagen del backend de Emails para Cloud Run.
#
# No lleva ninguna credencial: la identidad la da la service account ADJUNTA al
# servicio, que el metadata server expone en runtime. No hay key que copiar.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
# Sin dependencias de runtime: el servicio usa sólo la librería estándar de Node.
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
