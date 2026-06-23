#RealTime_Ionosonde.py

import json
import urllib.request
from datetime import datetime, timedelta
import time
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS
import os


# InfluxDB Configuration (from environment variables)
INFLUXDB_HOST = os.getenv('INFLUX_HOST', 'influxdb')  
INFLUXDB_PORT = 8086
INFLUXDB_TOKEN = os.getenv('INFLUXDB_TOKEN', 'DtxnhQbbkxRswMCwyCzumJOhNahvC1KR8FKtvEX3vL4xnhYCO7VAZTPAns3x6CRwgaHU3-gyraZDQh63tNBEuQ==')
INFLUXDB_ORG = os.getenv('INFLUXDB_ORG', 'KSA')
INFLUXDB_BUCKET = os.getenv('INFLUXDB_BUCKET', 'Malindi_Ionosonde_Autoscaled')
INFLUXDB_URL = os.getenv('INFLUXDB_URL', f'http://{INFLUXDB_HOST}:{INFLUXDB_PORT}')

# Data Collection Configuration
UPDATE_INTERVAL = int(os.getenv('UPDATE_INTERVAL', '300'))  # 5 minutes
LOOKBACK_HOURS = int(os.getenv('LOOKBACK_HOURS', '24'))

# Station Information
STATION_NAME = os.getenv('STATION_NAME', 'ML10L')
STATION_LOCATION = os.getenv('STATION_LOCATION', 'Malindi, Kenya')
# =======================================================

def get_time_range():
    """Get the time range for data fetching"""
    ending_time = datetime.utcnow()
    starting_time = ending_time - timedelta(hours=LOOKBACK_HOURS)
    
    starting_day = starting_time.strftime('%Y-%m-%d')
    starting_hour = starting_time.strftime('%H:%M')
    ending_day = ending_time.strftime('%Y-%m-%d')
    ending_hour = ending_time.strftime('%H:%M')
    
    return starting_day, starting_hour, ending_day, ending_hour

def fetch_data(starting_day, starting_hour, ending_day, ending_hour):
    """Fetch data from the INGV API"""
    starting_time = starting_day + '%20' + starting_hour
    ending_time = ending_day + '%20' + ending_hour
    
    url = 'http://ws-eswua.rm.ingv.it/ais.php/records/wsml10l_auto?filter=dt,bt,' + starting_time + ',' + ending_time + '&include=dt,fof2,fof1,ftes,aip_hmf2,aip_foe,aip_hme,h_es,muf3000f2,m3000f2' + '&order=dt'
    
    try:
        webURL = urllib.request.urlopen(url, timeout=30)
        downloaded_data = json.loads(webURL.read())
        return downloaded_data
    except Exception as e:
        print(f"Error fetching data: {e}")
        return None

def write_to_influxdb(records, write_api):
    """Write ALL records to InfluxDB with all available fields"""
    points = []
    records_written = 0
    field_stats = {
        'fof2': 0, 'fof1': 0, 'hmf2': 0, 'foe': 0, 
        'hme': 0, 'muf3000f2': 0, 'm3000f2': 0, 'ftes': 0, 'hes': 0
    }
    
    for record in records:
        try:
            # Parse timestamp
            dt_str = record['dt']
            timestamp = datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
            
            # Create a point for this record
            point = Point("ionospheric_data") \
                .tag("station", STATION_NAME) \
                .tag("location", STATION_LOCATION) \
                .time(timestamp)
            
            has_data = False
            
            # Add ALL available fields from the API
            
            # foF2 (Critical frequency of F2 layer)
            fof2_val = record.get('fof2')
            if fof2_val is not None:
                try:
                    point = point.field("fof2", float(fof2_val))
                    field_stats['fof2'] += 1
                    has_data = True
                except (ValueError, TypeError):
                    pass
            
            # foF1 (Critical frequency of F1 layer)
            fof1_val = record.get('fof1')
            if fof1_val is not None:
                try:
                    point = point.field("fof1", float(fof1_val))
                    field_stats['fof1'] += 1
                    has_data = True
                except (ValueError, TypeError):
                    pass
            
            # hmF2 (Height of F2 layer maximum)
            hmf2_val = record.get('aip_hmf2')
            if hmf2_val is not None:
                try:
                    point = point.field("hmf2", float(hmf2_val))
                    field_stats['hmf2'] += 1
                    has_data = True
                except (ValueError, TypeError):
                    pass
            
            # foE (Critical frequency of E layer)
            foe_val = record.get('aip_foe')
            if foe_val is not None:
                try:
                    point = point.field("foe", float(foe_val))
                    field_stats['foe'] += 1
                    has_data = True
                except (ValueError, TypeError):
                    pass
            
            # hmE (Height of E layer)
            hme_val = record.get('aip_hme')
            if hme_val is not None:
                try:
                    point = point.field("hme", float(hme_val))
                    field_stats['hme'] += 1
                    has_data = True
                except (ValueError, TypeError):
                    pass
            
            # MUF(3000)F2 (Maximum Usable Frequency)
            muf3000f2_val = record.get('muf3000f2')
            if muf3000f2_val is not None:
                try:
                    point = point.field("muf3000f2", float(muf3000f2_val))
                    field_stats['muf3000f2'] += 1
                    has_data = True
                except (ValueError, TypeError):
                    pass
            
            # M(3000)F2 factor
            m3000f2_val = record.get('m3000f2')
            if m3000f2_val is not None:
                try:
                    point = point.field("m3000f2", float(m3000f2_val))
                    field_stats['m3000f2'] += 1
                    has_data = True
                except (ValueError, TypeError):
                    pass
            
            # ftEs (Top frequency of sporadic E)
            ftes_val = record.get('ftes')
            if ftes_val is not None:
                try:
                    point = point.field("ftes", float(ftes_val))
                    field_stats['ftes'] += 1
                    has_data = True
                except (ValueError, TypeError):
                    pass
            
            # h'Es (Virtual height of sporadic E)
            hes_val = record.get('h_es')
            if hes_val is not None:
                try:
                    point = point.field("hes", float(hes_val))
                    field_stats['hes'] += 1
                    has_data = True
                except (ValueError, TypeError):
                    pass
            
            if has_data:
                points.append(point)
                records_written += 1
            
        except Exception as e:
            print(f"Error processing record: {e}")
            continue
    
    # Write all points to InfluxDB
    if points:
        try:
            write_api.write(bucket=INFLUXDB_BUCKET, record=points)
            return records_written, field_stats
        except Exception as e:
            print(f"Error writing to InfluxDB: {e}")
            return 0, field_stats
    
    return 0, field_stats

def initialize_influxdb():
    """Initialize InfluxDB client and write API"""
    max_retries = 5
    retry_delay = 5
    
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
                print("✓ InfluxDB connection successful")
                return client, write_api
            else:
                print(f"✗ InfluxDB health check failed (attempt {attempt + 1}/{max_retries})")
        except Exception as e:
            print(f"✗ Error connecting to InfluxDB (attempt {attempt + 1}/{max_retries}): {e}")
        
        if attempt < max_retries - 1:
            print(f"Retrying in {retry_delay} seconds...")
            time.sleep(retry_delay)
    
    return None, None

def main():
    """Main loop for real-time monitoring and InfluxDB writing"""
    print("=" * 70)
    print("Ionospheric Data Monitor - InfluxDB Writer")
    print("=" * 70)
    print(f"InfluxDB URL: {INFLUXDB_URL}")
    print(f"Bucket: {INFLUXDB_BUCKET}")
    print(f"Organization: {INFLUXDB_ORG}")
    print(f"Station: {STATION_NAME} ({STATION_LOCATION})")
    print(f"Update interval: {UPDATE_INTERVAL} seconds")
    print(f"Looking back: {LOOKBACK_HOURS} hours")
    print("=" * 70)
    
    # Initialize InfluxDB connection
    client, write_api = initialize_influxdb()
    
    if not client or not write_api:
        print("\n✗ Failed to initialize InfluxDB after multiple attempts")
        print("Exiting...")
        return
    
    print("\nStarting data collection loop...")
    print("Press Ctrl+C to stop")
    print("=" * 70)
    
    iteration = 0
    
    try:
        while True:
            iteration += 1
            print(f"\n[Update {iteration}] {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
            
            # Get time range
            starting_day, starting_hour, ending_day, ending_hour = get_time_range()
            print(f"Fetching data from {starting_day} {starting_hour} to {ending_day} {ending_hour}")
            
            # Fetch data
            downloaded_data = fetch_data(starting_day, starting_hour, ending_day, ending_hour)
            
            if downloaded_data and 'records' in downloaded_data:
                records = downloaded_data['records']
                print(f"Retrieved {len(records)} records from API")
                
                # Write ALL fields to InfluxDB
                records_written, field_stats = write_to_influxdb(records, write_api)
                
                if records_written > 0:
                    print(f"✓ Successfully wrote {records_written} records to InfluxDB")
                    print(f"  Field counts: foF2={field_stats['fof2']}, hmF2={field_stats['hmf2']}, "
                          f"MUF={field_stats['muf3000f2']}, foF1={field_stats['fof1']}, "
                          f"foE={field_stats['foe']}, hmE={field_stats['hme']}")
                else:
                    print("✗ No records written to InfluxDB")
                    
            else:
                print("✗ Failed to fetch data or no records available")
            
            print(f"Next update in {UPDATE_INTERVAL} seconds...")
            time.sleep(UPDATE_INTERVAL)
            
    except KeyboardInterrupt:
        print("\n\nMonitoring stopped by user")
        print("=" * 70)
        
        # Close InfluxDB connection
        if client:
            client.close()
            print("InfluxDB connection closed")

if __name__ == "__main__":
    main()
