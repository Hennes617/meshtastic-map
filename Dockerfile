FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache git openssl

# Install dependencies before application sources so this layer stays cacheable.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

# Application sources stay read-only at runtime. Only the optional protobuf
# checkout directory must be writable by the unprivileged Node user.
COPY . .
RUN mkdir -p /app/src/external && chown -R node:node /app/src/external

ENV NODE_ENV=production
USER node

STOPSIGNAL SIGTERM

EXPOSE 8080
