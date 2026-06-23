# AngaWatch/db/Dockerfile

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ARG DEBUG=false

# Install debugpy for development
RUN if [ "$DEBUG" = "true" ; then pip install debugpy; fi

# Copy the entire application
COPY . .

# Set Python path
ENV PYTHONPATH=/app