# Listener de WhatsApp interno (Fase 18).
#
# Una imagen chica y sin nada de más: el proceso no sirve HTTP público, no
# compila nada en runtime y no necesita herramientas.
#
# Lo que NO entra en la imagen, y es deliberado:
#   · `.whatsapp-auth/` — la sesión son CREDENCIALES. Va en un volumen, nunca
#     en la imagen: una imagen se copia, se sube a un registry y se comparte.
#   · los tests y los fixtures.
#   · el `.env`.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Sólo las dependencias de runtime: sin TypeScript ni vitest.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY --from=build /app/dist ./dist

# El estado de sesión vive acá y ACÁ SE MONTA EL VOLUMEN. Si el volumen no se
# monta, el proceso arranca, pide QR y nadie lo ve: por eso el healthcheck
# distingue `requiere_autenticacion` de `conectado`.
ENV WHATSAPP_AUTH_DIR=/datos/whatsapp-auth
RUN mkdir -p /datos/whatsapp-auth && chown -R node:node /datos

# Sin root: el proceso no necesita privilegios para abrir un websocket.
USER node

ENV HEALTH_PORT=8081
EXPOSE 8081

# `conectado` o `apagado` devuelven 200; `requiere_autenticacion` y
# `reconectando` devuelven 503, que es lo que hace que el orquestador avise.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/health >/dev/null || exit 1

CMD ["node", "dist/index.js", "--baileys"]
