# RealTime_Scintillation.py

import requests
import time
from datetime import datetime, timedelta
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
import os


# InfluxDB Configuration (from environment variables)
INFLUXDB_HOST = os.getenv('INFLUX_HOST', 'influxdb')  # Docker container name
INFLUXDB_PORT = 8086
INFLUXDB_TOKEN = os.getenv('INFLUXDB_TOKEN', 'DtxnhQbbkxRswMCwyCzumJOhNahvC1KR8FKtvEX3vL4xnhYCO7VAZTPAns3x6CRwgaHU3-gyraZDQh63tNBEuQ==')
INFLUXDB_ORG = os.getenv('INFLUXDB_ORG', 'KSA')
INFLUXDB_BUCKET = os.getenv('INFLUXDB_BUCKET', 'Malindi_Scintillation_Data')
INFLUXDB_URL = os.getenv('INFLUXDB_URL', f'http://{INFLUXDB_HOST}:{INFLUXDB_PORT}')

# Data Collection Configuration
UPDATE_INTERVAL = int(os.getenv('UPDATE_INTERVAL', '300'))  # 5 minutes
LOOKBACK_HOURS = int(os.getenv('LOOKBACK_HOURS', '24'))
STEP_MINUTES = int(os.getenv('STEP_MINUTES', '60'))  # API fetch interval

# Station Information
STATION_NAME = os.getenv('STATION_NAME', 'MAL2')
STATION_LOCATION = os.getenv('STATION_LOCATION', 'Malindi, Kenya')


def get_time_range():
    """Get the time range for data fetching"""
    ending_time = datetime.utcnow()
    starting_time = ending_time - timedelta(hours=LOOKBACK_HOURS)
    
    starting_str = starting_time.strftime('%Y-%m-%d %H:%M:%S')
    ending_str = ending_time.strftime('%Y-%m-%d %H:%M:%S')
    
    return starting_str, ending_str

def fetch_scintillation_data(st_time, en_time):
    """
    Fetch scintillation data from INGV web service
    Returns list of records with S4_L1_vert, S4_L2_vert, VTEC, PRN
    """
    all_data = []
    
    start_cycle = datetime.strptime(st_time, '%Y-%m-%d %H:%M:%S')
    end_cycle = datetime.strptime(en_time, '%Y-%m-%d %H:%M:%S')
    
    formatOut = '%Y-%m-%d %H:%M:%S'
    current_start = start_cycle
    
    while current_start <= end_cycle:
        new_start = current_start + timedelta(minutes=STEP_MINUTES)
        
        if new_start > end_cycle:
            dt_end = end_cycle.strftime(formatOut)
        else:
            dt_end = (new_start - timedelta(seconds=1)).strftime(formatOut)
        
        dt_start = current_start.strftime(formatOut)
        
        # Build API URL
        wsdata = (
            f"http://ws-eswua.rm.ingv.it/scintillation.php/records/wsmal0p?"
            f"filter=dt,bt,{dt_start},{dt_end}&"
            f"filter0=PRN,sw,&filter1=PRN,sw,N&filter2=PRN,sw,N&filter3=PRN,sw,N&"
            f"filter4=PRN,sw,N&filter5=PRN,sw,N&filter6=PRN,sw,N&"
            f"include=dt,PRN,vtec,s4_l2_vert,s4_l1_vert&order=dt"
        )
        
        try:
            response = requests.get(wsdata, timeout=30)
            data_struct = response.json()
            
            records = data_struct.get('records', [])
            if records:
                all_data.extend(records)
            
        except Exception as e:
            print(f"[ERROR] Fetching data for {dt_start}: {e}")
        
        current_start = new_start
        time.sleep(0.2)  # Rate limiting
    
    return all_data

def write_to_influxdb(records, write_api):
    """Write scintillation records to InfluxDB"""
    points = []
    records_written = 0
    
    for record in records:
        try:
            # Parse timestamp
            dt_str = record.get('dt')
            if not dt_str:
                continue
                
            timestamp = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
            
            # Get PRN (satellite identifier) as tag
            prn = record.get('PRN', 'Unknown')
            
            # Create InfluxDB point
            point = Point("scintillation_data") \
                .tag("station", STATION_NAME) \
                .tag("location", STATION_LOCATION) \
                .tag("PRN", str(prn)) \
                .time(timestamp)
            
            # Add S4_L1_vert field
            s4_l1_val = record.get('s4_l1_vert')
            if s4_l1_val is not None:
                try:
                    point = point.field("s4_l1_vert", float(s4_l1_val))
                except (ValueError, TypeError):
                    pass
            
            # Add S4_L2_vert field
            s4_l2_val = record.get('s4_l2_vert')
            if s4_l2_val is not None:
                try:
                    point = point.field("s4_l2_vert", float(s4_l2_val))
                except (ValueError, TypeError):
                    pass
            
            # Add VTEC field
            vtec_val = record.get('vtec')
            if vtec_val is not None:
                try:
                    point = point.field("vtec", float(vtec_val))
                except (ValueError, TypeError):
                    pass
            
            points.append(point)
            records_written += 1
            
        except Exception as e:
            print(f"[ERROR] Processing record: {e}")
            continue
    
    # Batch write to InfluxDB
    if points:
        try:
            write_api.write(bucket=INFLUXDB_BUCKET, record=points)
            return records_written
        except Exception as e:
            print(f"[ERROR] Writing to InfluxDB: {e}")
            return 0
    
    return 0

def initialize_influxdb():
    """Initialize InfluxDB client with connection verification"""
    max_retries = 5
    retry_delay = 10
    
    for attempt in range(max_retries):
        try:
            client = InfluxDBClient(
                url=INFLUXDB_URL,
                token=INFLUXDB_TOKEN,
                org=INFLUXDB_ORG
            )
            write_api = client.write_api(write_options=SYNCHRONOUS)
            
            # Test connection
            health = client.health()
            if health.status == "pass":
                print(f"[INFO] InfluxDB connection successful")
                return client, write_api
            else:
                print(f"[WARN] InfluxDB health check failed")
                
        except Exception as e:
            print(f"[WARN] Connection attempt {attempt + 1}/{max_retries} failed: {e}")
            if attempt < max_retries - 1:
                print(f"[INFO] Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
    
    print("[ERROR] Failed to connect to InfluxDB after all retries")
    return None, None

def get_data_statistics(records):
    """Calculate statistics for fetched data"""
    stats = {
        'total': len(records),
        's4_l1': sum(1 for r in records if r.get('s4_l1_vert') is not None),
        's4_l2': sum(1 for r in records if r.get('s4_l2_vert') is not None),
        'vtec': sum(1 for r in records if r.get('vtec') is not None),
        'prns': len(set(str(r.get('PRN')) for r in records if r.get('PRN')))
    }
    return stats

def main():
    """Main monitoring loop"""
    
    print("=" * 70)
    print("Scintillation Data Monitor - InfluxDB Writer")
    print("=" * 70)
    print(f"[CONFIG] InfluxDB URL: {INFLUXDB_URL}")
    print(f"[CONFIG] Organization: {INFLUXDB_ORG}")
    print(f"[CONFIG] Bucket: {INFLUXDB_BUCKET}")
    print(f"[CONFIG] Station: {STATION_NAME} ({STATION_LOCATION})")
    print(f"[CONFIG] Update interval: {UPDATE_INTERVAL}s")
    print(f"[CONFIG] Lookback period: {LOOKBACK_HOURS}h")
    print(f"[CONFIG] Parameters: S4_L1_vert, S4_L2_vert, VTEC")
    print("=" * 70)
    
    # Initialize InfluxDB
    client, write_api = initialize_influxdb()
    
    if not client or not write_api:
        print("[ERROR] Cannot proceed without InfluxDB connection")
        return
    
    print("[INFO] Starting monitoring loop (Ctrl+C to stop)")
    print("=" * 70)
    
    iteration = 0
    
    try:
        while True:
            iteration += 1
            cycle_start = time.time()
            
            print(f"\n[CYCLE {iteration}] {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
            
            # Get time range
            starting_time, ending_time = get_time_range()
            print(f"[INFO] Fetching: {starting_time} to {ending_time}")
            
            # Fetch data
            records = fetch_scintillation_data(starting_time, ending_time)
            
            if records:
                # Get statistics
                stats = get_data_statistics(records)
                print(f"[DATA] Retrieved {stats['total']} records")
                print(f"       S4_L1: {stats['s4_l1']} | S4_L2: {stats['s4_l2']} | VTEC: {stats['vtec']}")
                print(f"       Satellites (PRN): {stats['prns']}")
                
                # Write to InfluxDB
                written = write_to_influxdb(records, write_api)
                
                if written > 0:
                    print(f"[SUCCESS] Wrote {written} records to InfluxDB")
                else:
                    print(f"[WARN] No records written to InfluxDB")
            else:
                print("[WARN] No data retrieved from API")
            
            # Calculate sleep time
            cycle_duration = time.time() - cycle_start
            sleep_time = max(0, UPDATE_INTERVAL - cycle_duration)
            
            if sleep_time > 0:
                print(f"[INFO] Next update in {sleep_time:.0f}s")
                time.sleep(sleep_time)
            else:
                print(f"[WARN] Cycle took {cycle_duration:.1f}s (longer than {UPDATE_INTERVAL}s interval)")
            
    except KeyboardInterrupt:
        print("\n[INFO] Monitoring stopped by user")
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
    finally:
        if client:
            client.close()
            print("[INFO] InfluxDB connection closed")
        print("=" * 70)

if __name__ == "__main__":
    main()
