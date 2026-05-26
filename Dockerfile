# --- Stage 1: Base (Common Dependencies) ---
FROM node:20-alpine AS base
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN npm install

# --- Stage 2: Development ---
FROM base AS dev
COPY . .
RUN git config --global --add safe.directory /app
RUN git submodule update --init --recursive --depth 1 || echo "Skipping private submodules..."
RUN npm run build
CMD ["npm", "run", "start"]

# --- Stage 3: Build (Production-ready) ---
FROM base AS build
COPY . .
RUN git config --global --add safe.directory /app
RUN git submodule update --init --recursive --recommend-shallow || echo "Skipping private submodules..."

# Declare build args
ARG KEEPTRACK_API_KEY
ARG INFLUXDB_URL
ARG INFLUXDB_TOKEN
ARG INFLUXDB_ORG
ARG INFLUXDB_X_RAY_BUCKET
ARG INFLUXDB_TART_BUCKET
ARG INFLUXDB_IONOSONDE_BUCKET

# Make them available to the build
ENV KEEPTRACK_API_KEY=$KEEPTRACK_API_KEY
ENV INFLUXDB_URL=$INFLUXDB_URL
ENV INFLUXDB_TOKEN=$INFLUXDB_TOKEN
ENV INFLUXDB_ORG=$INFLUXDB_ORG
ENV INFLUXDB_X_RAY_BUCKET=$INFLUXDB_X_RAY_BUCKET
ENV INFLUXDB_TART_BUCKET=$INFLUXDB_TART_BUCKET
ENV INFLUXDB_IONOSONDE_BUCKET=$INFLUXDB_IONOSONDE_BUCKET
RUN npx tsx ./build/generate-translation.ts 
RUN npm run build
# --- Stage 4: Production ---
FROM base AS prod
COPY . .
RUN git config --global --add safe.directory /app
RUN git submodule update --init --recursive --depth 1 || echo "Skipping private submodules..."
RUN npm run build
CMD ["npm", "run", "start"]
