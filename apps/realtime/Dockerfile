# Gateway WebSocket do Aether.
#
# Imagem debian-slim e nao alpine de proposito: os engines do Prisma dependem
# de OpenSSL e glibc, e no alpine (musl) isso vira uma classe de erro que so
# aparece em producao.
FROM node:22-slim

WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Manifestos primeiro: enquanto as dependencias nao mudam, esta camada e
# reaproveitada e o build fica em segundos.
COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/access/package.json packages/access/
COPY apps/realtime/package.json apps/realtime/
COPY apps/web/package.json apps/web/

# `npm ci` instala o workspace inteiro, incluindo o app web que esta imagem nao
# executa. E desperdicio de espaco, nao de correcao — filtrar por workspace
# quebra os links entre @aether/*. Fica como otimizacao futura.
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/realtime ./apps/realtime

# `prisma generate` valida o datasource, entao precisa da variavel presente —
# mas nao conecta. O valor real chega por secret do Fly em tempo de execucao.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate --schema packages/db/prisma/schema.prisma

ENV NODE_ENV=production
ENV REALTIME_PORT=4000
EXPOSE 4000

# O gateway consome os pacotes @aether/* como fonte TypeScript, entao roda por
# tsx tambem em producao. Compilar antes seria mais enxuto e esta anotado como
# divida no README.
CMD ["npx", "tsx", "apps/realtime/src/index.ts"]
