#!/bin/bash
set -e

echo "=== Automating InfluxDB Buckets Creation ==="

# Wait for InfluxDB to be ready
sleep 5

# Create all required buckets
influx bucket create -n "Malindi_Scintillation_Data" -o "$DOCKER_INFLUXDB_INIT_ORG" -t "$DOCKER_INFLUXDB_INIT_ADMIN_TOKEN" || echo "Bucket Malindi_Scintillation_Data may already exist"
influx bucket create -n "Malindi_Ionosonde_Autoscaled" -o "$DOCKER_INFLUXDB_INIT_ORG" -t "$DOCKER_INFLUXDB_INIT_ADMIN_TOKEN" || echo "Bucket Malindi_Ionosonde_Autoscaled may already exist"
influx bucket create -n "KSA_ISMR" -o "$DOCKER_INFLUXDB_INIT_ORG" -t "$DOCKER_INFLUXDB_INIT_ADMIN_TOKEN" || echo "Bucket KSA_ISMR may already exist"
influx bucket create -n "X-Ray Flux" -o "$DOCKER_INFLUXDB_INIT_ORG" -t "$DOCKER_INFLUXDB_INIT_ADMIN_TOKEN" || echo "Bucket X-Ray Flux may already exist"

echo "=== All Buckets Successfully Created! ==="