
"""
@author: Dusabe (Modified for InfluxDB + Grafana)
"""

import pandas as pd
from datetime import datetime, timedelta, timezone
import time
import env  #  file paths
from pysolar.solar import get_altitude
import os  # Add this import for environment variables
import math
import ssl
# Replace influxdb import with influxdb-client
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

ssl._create_default_https_context = ssl._create_unverified_context

# Updated InfluxDB connection parameters for InfluxDB 2.0
INFLUX_HOST = os.getenv('INFLUX_HOST', 'influxdb')  
INFLUX_PORT = 8086
INFLUX_TOKEN = os.getenv('INFLUXDB_TOKEN', 'DtxnhQbbkxRswMCwyCzumJOhNahvC1KR8FKtvEX3vL4xnhYCO7VAZTPAns3x6CRwgaHU3-gyraZDQh63tNBEuQ==') 
INFLUX_ORG = os.getenv('INFLUXDB_ORG', 'KSA')  # The org you specified in DOCKER_INFLUXDB_INIT_ORG
INFLUX_BUCKET = os.getenv('INFLUXDB_BUCKET', 'X-Ray Flux')  
INFLUX_URL = os.getenv('INFLUXDB_URL', f'http://{INFLUX_HOST}:{INFLUX_PORT}')

dtn = datetime.now()
# Fix deprecated warning by using timezone-aware objects
startdt = datetime.now(timezone.utc) - timedelta(days=7)

def getPrimaryDataframes():
   # dfP = pd.read_json(env.PrimaryData7Days, orient='columns', encoding='latin-1')
    dfP = pd.read_json(env.PrimaryData7Days, orient='columns', encoding='latin-1', convert_dates=['time_tag'])
    
    dfPLong = dfP[dfP['energy'] == "0.1-0.8nm"]
    dfPShort = dfP[dfP['energy'] == "0.05-0.4nm"]
    
    # Convert to datetime and make timezone-aware
    #dfPLong.loc[:, 'time_tag'] = pd.to_datetime(dfPLong['time_tag'], format='%Y-%m-%dT%H:%M:%SZ').dt.tz_localize('UTC')
    #dfPShort.loc[:, 'time_tag'] = pd.to_datetime(dfPShort['time_tag'], format='%Y-%m-%dT%H:%M:%SZ').dt.tz_localize('UTC')
        
    dfPLong = dfPLong[dfPLong['time_tag'] >= startdt]
    dfPShort = dfPShort[dfPShort['time_tag'] >= startdt]
    
    dfPLong.set_index('time_tag', inplace=True)
    dfPShort.set_index('time_tag', inplace=True)
    
    return dfPLong, dfPShort

def getSecondaryDataframes():
    dfP = pd.read_json(env.SecondaryData7Days, orient='columns', encoding='latin-1', convert_dates=['time_tag'])

    dfPLong = dfP[dfP['energy'] == "0.1-0.8nm"]
    dfPShort = dfP[dfP['energy'] == "0.05-0.4nm"]
    
    # Convert to datetime and make timezone-aware
    #dfPLong.loc[:, 'time_tag'] = pd.to_datetime(dfPLong['time_tag'], format='%Y-%m-%dT%H:%M:%SZ').dt.tz_localize('UTC')
    #dfPShort.loc[:, 'time_tag'] = pd.to_datetime(dfPShort['time_tag'], format='%Y-%m-%dT%H:%M:%SZ').dt.tz_localize('UTC')
    
    dfPLong = dfPLong[dfPLong['time_tag'] >= startdt]
    dfPShort = dfPShort[dfPShort['time_tag'] >= startdt]
    
    dfPLong.set_index('time_tag', inplace=True)
    dfPShort.set_index('time_tag', inplace=True)
    
    return dfPLong, dfPShort

def classify_flare(Fx):
    if Fx >= 1e-4:
        return f"X{Fx / 1e-4:.1f}"
    elif Fx >= 1e-5:
        return f"M{Fx / 1e-5:.1f}"
    elif Fx >= 1e-6:
        return f"C{Fx / 1e-6:.1f}"
    elif Fx >= 1e-7:
        return f"B{Fx / 1e-7:.1f}"
    else:
        return f"A{Fx / 1e-8:.1f}"

def assess_hf_blackout(dfPLong_p, lat=1.29, lon=36.82):  # Nairobi coordinates by default
    # Get latest Fx
    latest_entry = dfPLong_p.iloc[-1]
    latest_fx = latest_entry["flux"]
    utc_time = datetime.now(timezone.utc)

    # Get solar elevation angle
    solar_elevation_deg = get_altitude(lat, lon, utc_time)
    zenith_angle_deg = 90 - solar_elevation_deg
    sec_theta = 1 / math.cos(math.radians(zenith_angle_deg)) if solar_elevation_deg > 0 else 0

    # Absorption model constants
    k = 2.5e8
    threshold_db = 10
    hf_freqs = [30, 25, 20, 15, 12, 10, 7, 5, 3.5, 2.5]
    affected_freqs = []

    for f in hf_freqs:
        if sec_theta == 0:
            break
        A_f = (k * latest_fx * sec_theta) / (f ** 2)
        if A_f > threshold_db:
            affected_freqs.append(f)

    classification = classify_flare(latest_fx)
    
    # Store results for database
    result = {
        'time_tag': utc_time,
        'flux': latest_fx,
        'classification': classification,
        'solar_elevation': solar_elevation_deg,
        'affected_frequencies': ','.join(map(str, affected_freqs)) if affected_freqs else ''
    }
    
    # Print status
    print(f"[{utc_time.strftime('%Y-%m-%d %H:%M:%S UTC')}] Current Fx = {latest_fx:.2e}")
    if solar_elevation_deg <= 0:
        print("🌑 Nighttime in Kenya — HF disruptions not expected.")
    elif affected_freqs:
        print(f"{classification} flare in progress. Expected HF blackout of Frequencies below {max(affected_freqs)} MHz")
    else:
        print("Low X-ray Flux - No significant HF blackout expected at this time.")
    
    return result

def prepare_flux_data_for_influx(df, satellite, energy):
    """Convert DataFrame to InfluxDB format for InfluxDB 2.0"""
    points = []
    df_reset = df.reset_index()
    
    for _, row in df_reset.iterrows():
        point = Point("solar_xray_flux") \
            .tag("satellite", satellite) \
            .tag("energy", energy) \
            .field("flux", float(row['flux'])) \
            .time(row['time_tag'])
        points.append(point)
    
    return points

def prepare_blackout_data_for_influx(blackout_data):
    """Convert blackout assessment to InfluxDB format for InfluxDB 2.0"""
# Create the formatted status message
    status_message = ""
    if blackout_data['solar_elevation'] <= 0:
        status_message = "🌑 Nighttime in Kenya — HF disruptions not expected."
    elif blackout_data['affected_frequencies']:
        affected_freqs = blackout_data['affected_frequencies'].split(',')
        max_freq = max(map(float, affected_freqs)) if affected_freqs else 0
        status_message = f"{blackout_data['classification']} flare in progress. Expected HF blackout of Frequencies below {max_freq} MHz"
    else:
        status_message = "Low X-ray Flux - No significant HF blackout expected at this time."
    
    # Add the status message to your point
    point = Point("hf_blackout") \
        .tag("classification", blackout_data['classification']) \
        .field("flux", float(blackout_data['flux'])) \
        .field("solar_elevation", float(blackout_data['solar_elevation'])) \
        .field("affected_frequencies", blackout_data['affected_frequencies']) \
        .field("status_message", status_message) \
        .time(blackout_data['time_tag'])
    
    return [point]

def main_loop():
    try:
        # Connect to InfluxDB 2.0 with updated client
        url = INFLUX_URL
        
        print(f"Attempting to connect to InfluxDB at {url}...")
        
        client = InfluxDBClient(url=url, token=INFLUX_TOKEN, org=INFLUX_ORG)
        write_api = client.write_api(write_options=SYNCHRONOUS)
        
        # Check if connection is working
        health = client.health()
        print(f"InfluxDB health status: {health.status}")
        
        print(f"Successfully connected to InfluxDB. Organization: {INFLUX_ORG}, Bucket: {INFLUX_BUCKET}")
        
        while True:
             try:
                print("Fetching data at", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
                
                # Get data
                dfPLong_p, dfPShort_p = getPrimaryDataframes()
                dfPLong_s, dfPShort_s = getSecondaryDataframes()
                
                # Assess HF blackout
                blackout_data = assess_hf_blackout(dfPLong_p)
                
                # Prepare data points for InfluxDB
                points = []
                
                # Primary satellite data (GOES 16)
                points.extend(prepare_flux_data_for_influx(dfPLong_p, "GOES16", "0.1-0.8nm"))
                points.extend(prepare_flux_data_for_influx(dfPShort_p, "GOES16", "0.05-0.4nm"))
                
                # Secondary satellite data (GOES 17)
                points.extend(prepare_flux_data_for_influx(dfPLong_s, "GOES17", "0.1-0.8nm"))
                points.extend(prepare_flux_data_for_influx(dfPShort_s, "GOES17", "0.05-0.4nm"))
                
                # Blackout assessment
                points.extend(prepare_blackout_data_for_influx(blackout_data))
                
                # Write all data points to InfluxDB
                write_api.write(bucket=INFLUX_BUCKET, record=points)
                
                print(f"Data successfully stored in InfluxDB. Wrote {len(points)} data points.")
                
             except Exception as e:
                 print("Error during data processing:", e)
                 import traceback
                 traceback.print_exc()
            
             # Wait 5 minutes before next update
             time.sleep(300)

    except Exception as e:
        print("Fatal error in InfluxDB connection:", e)
        print(f"Details: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main_loop()
