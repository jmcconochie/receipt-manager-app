#!/usr/bin/bash

# buildrun_docker.sh
# Build and run the Docker container for Receipt Scanner

# Define variables
IMAGE_NAME="receipt_scanner"
CONTAINER_NAME="receipt_scanner"
HOST_UPLOADS_DIR="/mnt/bu1/jason/receipt_scanner/static"
CONTAINER_UPLOADS_DIR="/app/static"
PORT_MAPPING="5000:5000"
ENV_FILE=".env"

# Step 1: Stop and remove any existing container with the same name
if docker ps -a | grep -q $CONTAINER_NAME; then
  echo "🛑 Stopping and removing old container: $CONTAINER_NAME"
  docker stop $CONTAINER_NAME > /dev/null 2>&1
  docker rm $CONTAINER_NAME > /dev/null 2>&1
fi

# Step 2: Build the new image
echo "🔨 Building Docker image: $IMAGE_NAME"
docker build -t $IMAGE_NAME .

# Step 3: Run the new container
echo "🚀 Running Docker container: $CONTAINER_NAME"
docker run -d \
  --name "$CONTAINER_NAME" \
  --network=bridge \
  -p "$PORT_MAPPING" \
  -v "$HOST_UPLOADS_DIR":"$CONTAINER_UPLOADS_DIR" \
  --env-file "$ENV_FILE" \
  -e CELERY_BROKER_URL="redis://172.17.0.1:6379/0" \
  "$IMAGE_NAME"

# Step 4: Check if the container is running
if docker ps | grep -q $CONTAINER_NAME; then
  echo "✅ Container $CONTAINER_NAME is running on port $PORT_MAPPING"
else
  echo "❌ Failed to start container $CONTAINER_NAME. Check logs with:"
  echo "docker logs $CONTAINER_NAME"
fi



