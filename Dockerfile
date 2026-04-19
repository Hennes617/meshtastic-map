FROM node:lts-alpine

WORKDIR /app

RUN apk add --no-cache git openssl

# Copy only package files and install deps
# This layer will be cached as long as package*.json don't change
COPY package*.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

# Copy the rest of your source
COPY . .
RUN npx prisma generate


EXPOSE 8080
