# --- Stage 1: Base (Common Dependencies) ---
FROM node:20-alpine AS base
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN npm install

# --- Stage 2: Development ---
FROM base AS dev
# Installs nodemon or other dev tools if needed
# Ensure the container has the dev dependencies if needed
COPY . .
RUN npm run build
CMD ["npm", "run", "start"]

# --- Stage 3: Build (Production-ready) ---
FROM base AS build
COPY . .
# Using || echo to avoid crashing on missing private submodules
RUN git submodule update --init --recursive --recommend-shallow || echo "Skipping private submodules..."
RUN npm run build

# --- Stage 4: Production (Nginx) ---
FROM node:20-alpine AS prod
WORKDIR /app
RUN npm install -g serve    # lightweight static file server
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./public
EXPOSE 3000
CMD ["serve", "-s", "public", "-l", "3000"]