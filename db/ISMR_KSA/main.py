import os
import time
import subprocess
import logging
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from influxdb_client import InfluxDBClient, Point
from influxdb_client.domain.write_precision import WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

INFLUXDB_URL    = os.getenv('INFLUXDB_URL',    'http://influxdb:8086')
INFLUXDB_TOKEN  = os.getenv('INFLUXDB_TOKEN',  'DtxnhQbbkxRswMCwyCzumJOhNahvC1KR8FKtvEX3vL4xnhYCO7VAZTPAns3x6CRwgaHU3-gyraZDQh63tNBEuQ==')
INFLUXDB_ORG    = os.getenv('INFLUXDB_ORG',    'KSA')
INFLUXDB_BUCKET = os.getenv('INFLUXDB_BUCKET', 'KSA_ISMR')
REMOTE          = os.getenv('RCLONE_REMOTE',   'autosw:GNSS/ISMR')
TEMP_DIR        = '/tmp/ismr'
CHECK_INTERVAL  = int(os.getenv('CHECK_INTERVAL', '60'))  # seconds
ELEVATION_MASK  = float(os.getenv('ELEVATION_MASK', '20.0'))


# LOGGING

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
log = logging.getLogger(__name__)


# SVID CONSTELLATION BOUNDARIES

GPS_SVID     = range(1,   38)
GLONASS_SVID = range(38,  71)
GALILEO_SVID = range(71,  107)
SBAS_SVID    = range(120, 141)
BEIDOU_SVID  = range(141, 178)


# COLUMN INDICES (0-based)

COL_WN        = 0
COL_TOW       = 1
COL_SVID      = 2
COL_ELEVATION = 5
COL_S4_SIG1   = 7
COL_TEC       = 22
COL_DTEC      = 23
COL_S4_SIG2   = 32
COL_S4_SIG3   = 46
COL_SIGMA_PHI_SIG1 = 9    # Phi01 Sig1
COL_SIGMA_PHI_SIG2 = 34   # Phi01 Sig2
COL_SIGMA_PHI_SIG3 = 48   # Phi01 Sig3


# GPS TIME TO DATETIME (EAT = UTC+3)

GPS_EPOCH = datetime(1980, 1, 6)

def gps_to_utc(wn, tow):
    return GPS_EPOCH + timedelta(weeks=int(wn), seconds=float(tow))


# CONSTELLATION LABELS

def get_constellation(svid):
    if svid in GPS_SVID:
        return "GPS"
    elif svid in GLONASS_SVID:
        return "GLONASS"
    elif svid in GALILEO_SVID:
        return "Galileo"
    elif svid in BEIDOU_SVID:
        return "BeiDou"
    return None

def safe_float(val):
    try:
        f = float(val)
        return f if not np.isnan(f) else None
    except (ValueError, TypeError):
        return None


# GETTING LATEST FILE FROM GOOGLE DRIVE

def get_latest_filename():
    result = subprocess.run(
        ["rclone", "lsf", REMOTE, "--format", "tp",
         "--config", "/root/.config/rclone/rclone.conf"],
        capture_output=True, text=True
    )
    if result.returncode != 0 or not result.stdout.strip():
        log.warning(f"Could not list Drive: {result.stderr}")
        return None
    lines = [l.strip() for l in result.stdout.strip().split("\n") if l.strip()]
    lines.sort(reverse=True)
    return lines[0].split(";")[-1].strip()


# DOWNLOADING FILES

def download_file(filename):
    os.makedirs(TEMP_DIR, exist_ok=True)
    result = subprocess.run(
        ["rclone", "copy",
         f"{REMOTE}/{filename}", TEMP_DIR,
         "--config", "/root/.config/rclone/rclone.conf"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        log.error(f"Download failed: {result.stderr}")
        return False
    return True


# PARSING ISMR FILE

def parse_ismr(filepath):
    rows = []
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            cols = [c.strip() for c in line.split(",")]
            if len(cols) < 48:
                continue
            try:
                wn        = int(cols[COL_WN])
                tow       = float(cols[COL_TOW])
                svid      = int(cols[COL_SVID])
                elevation = float(cols[COL_ELEVATION])
            except (ValueError, TypeError):
                continue

            if elevation < ELEVATION_MASK:
                continue

            constellation = get_constellation(svid)
            if constellation is None:
                continue

            rows.append({
                "timestamp":     gps_to_utc(wn, tow),
                "svid":          svid,
                "constellation": constellation,
                "elevation":     elevation,
                "s4_sig1":       safe_float(cols[COL_S4_SIG1]),
                "s4_sig2":       safe_float(cols[COL_S4_SIG2]),
                "s4_sig3":       safe_float(cols[COL_S4_SIG3]),
                "tec":           safe_float(cols[COL_TEC]),
                "dtec":          safe_float(cols[COL_DTEC]),
                "sigma_phi_sig1": safe_float(cols[COL_SIGMA_PHI_SIG1]),
                "sigma_phi_sig2": safe_float(cols[COL_SIGMA_PHI_SIG2]),
                "sigma_phi_sig3": safe_float(cols[COL_SIGMA_PHI_SIG3])
            })

    return pd.DataFrame(rows)


# WRITING TO INFLUXDB

def write_to_influxdb(df, client):
    write_api = client.write_api(write_options=SYNCHRONOUS)
    points = []

    for _, row in df.iterrows():
        p = (
            Point("ismr_nairobi")
            .tag("constellation", row["constellation"])
            .tag("svid", str(int(row["svid"])))
            .tag("station", "NAI0P")
            .tag("location", "Nairobi, Kenya")
            .field("elevation", float(row["elevation"]))
            .time(row["timestamp"], WritePrecision.S)
        )

        # only write fields that have valid values
        if row["tec"] is not None:
            p = p.field("tec", float(row["tec"]))
        if row["dtec"] is not None:
            p = p.field("dtec", float(row["dtec"]))
        if row["s4_sig1"] is not None:
            p = p.field("s4_sig1", float(row["s4_sig1"]))
        if row["s4_sig2"] is not None:
            p = p.field("s4_sig2", float(row["s4_sig2"]))
        if row["s4_sig3"] is not None:
            p = p.field("s4_sig3", float(row["s4_sig3"]))
        if row["sigma_phi_sig1"] is not None:
            p = p.field("sigma_phi_sig1", float(row["sigma_phi_sig1"]))
        if row["sigma_phi_sig2"] is not None:
            p = p.field("sigma_phi_sig2", float(row["sigma_phi_sig2"]))
        if row["sigma_phi_sig3"] is not None:
            p = p.field("sigma_phi_sig3", float(row["sigma_phi_sig3"]))

        points.append(p)

    write_api.write(bucket=INFLUXDB_BUCKET, org=INFLUXDB_ORG, record=points)
    log.info(f"Written {len(points)} points to InfluxDB bucket: {INFLUXDB_BUCKET}")


# MAIN LOOP

def main():
    log.info("KSA ISMR KSA Monitor starting...")
    log.info(f"InfluxDB: {INFLUXDB_URL} | Org: {INFLUXDB_ORG} | Bucket: {INFLUXDB_BUCKET}")
    log.info(f"Google Drive remote: {REMOTE}")
    log.info(f"Check interval: {CHECK_INTERVAL}s | Elevation mask: {ELEVATION_MASK} deg")

    os.makedirs(TEMP_DIR, exist_ok=True)

    # wait for InfluxDB to be ready
    log.info("Waiting for InfluxDB to be ready...")
    time.sleep(10)

    client = InfluxDBClient(
        url=INFLUXDB_URL,
        token=INFLUXDB_TOKEN,
        org=INFLUXDB_ORG
    )

    last_filename = None

    while True:
        try:
            log.info("Checking Google Drive for new ISMR file...")
            latest_filename = get_latest_filename()

            if latest_filename is None:
                log.warning("No files found on Drive or Drive unreachable.")

            elif latest_filename == last_filename:
                log.info(f"No new file. Latest is still: {latest_filename}")

            else:
                log.info(f"New file detected: {latest_filename}")

                if download_file(latest_filename):
                    local_path = os.path.join(TEMP_DIR, latest_filename)
                    log.info(f"Parsing: {local_path}")
                    df = parse_ismr(local_path)

                    if df.empty:
                        log.warning("No valid rows parsed from file.")
                    else:
                        log.info(f"Parsed {len(df)} rows. Constellations: {df['constellation'].value_counts().to_dict()}")
                        write_to_influxdb(df, client)
                        last_filename = latest_filename
                        log.info("Done. Waiting for next file...")

        except Exception as e:
            log.error(f"Unexpected error: {e}", exc_info=True)

        time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    main()
