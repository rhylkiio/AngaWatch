docker compose up -d --build

# Verify the Containers are Running
docker compose ps

# Monitor Live Logs
docker compose logs -f
docker compose logs -f ismr_ksa

# Shutting Down the Setup
docker compose down