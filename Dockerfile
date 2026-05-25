# Stage 1: Build the app
FROM node:18-alpine AS build

# Install git so submodules can be fetched
RUN apk add --no-cache git

WORKDIR /app
COPY package*.json ./
RUN npm install

# We need the git history/metadata for submodule commands to work
COPY . .
RUN git submodule update --init --recursive --recommend-shallow || echo "Skipping private submodules..."
RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]