# --- Stage 1: Base (Common Dependencies) ---
FROM node:18-alpine AS base
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
RUN npm install

# --- Stage 2: Development ---
FROM base AS dev
# Installs nodemon or other dev tools if needed
CMD ["npm", "run", "dev"]

# --- Stage 3: Build (Production-ready) ---
FROM base AS build
COPY . .
# Using || echo to avoid crashing on missing private submodules
RUN git submodule update --init --recursive --recommend-shallow || echo "Skipping private submodules..."
RUN npm run build

# --- Stage 4: Production (Nginx) ---
FROM nginx:alpine AS prod
# Copy only the compiled static files
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]