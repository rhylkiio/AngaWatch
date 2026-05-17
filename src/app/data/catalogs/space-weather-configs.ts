// @app/app/data/catalogs/space-weather-configs.ts
import { Chart } from 'chart.js';

export const SENSOR_CHART_CONFIGS: Record<string, any> = {
    'TART': {
        bucketEnv: 'INFLUXDB_TART_BUCKET',
        fallbackBucket: 'TART-Kenya',
        yAxis: { type: 'linear', title: { display: true, text: 'Correlated Power', color: '#ddd' } },
        lineTension: 0.4,
        datasets: [
            { label: 'Median Baseline Power', borderColor: '#8c96c6', backgroundColor: 'rgba(140, 150, 198, 0.68)', fill: true },
            { label: 'Detection Threshold (6σ)', borderColor: 'orange', fill: false }
        ],
        // 1. Generate Queries
        queries: (baseQuery: string) => ({
            metrics: `${baseQuery} |> filter(fn: (r) => r["_measurement"] == "solar_radio_burst" and (r["_field"] == "median_power" or r["_field"] == "threshold")) |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)`,
            status: `${baseQuery} |> filter(fn: (r) => r["_measurement"] == "solar_radio_burst" and r["_field"] == "srb_detected") |> aggregateWindow(every: 5m, fn: max, createEmpty: false)`
        }),
        // 2. Parse Metrics
        parseMetrics: (lines: string[], chart: Chart) => {
            const h = lines[0].split(',');
            const [tIdx, vIdx, fIdx] = ['_time', '_value', '_field'].map(k => h.indexOf(k));
            for (let i = 1; i < lines.length; i++) {
                const p = lines[i].split(',');
                const val = parseFloat(p[vIdx] || '0');
                const tMs = new Date(p[tIdx]).getTime();
                const field = p[fIdx].replace(/"/g, '');
                if (field === 'median_power') (chart.data.datasets[0].data as any).push({ x: tMs, y: val });
                if (field === 'threshold') (chart.data.datasets[1].data as any).push({ x: tMs, y: val });
            }
        },
        // 3. Parse Status
        parseStatus: (lines: string[]) => {
            const h = lines[0].split(',');
            const [tIdx, vIdx] = [h.indexOf('_time'), h.indexOf('_value')];
            return lines.slice(1).map(line => {
                const p = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                const isDetected = parseFloat(p[vIdx]) === 1;
                return { time: new Date(p[tIdx]).getTime(), msg: isDetected ? 'SRB Detected' : 'Nominal', isAlert: isDetected };
            });
        }
    },

    'GOES': {
        bucketEnv: 'INFLUXDB_X_RAY_BUCKET',
        fallbackBucket: 'X_RAY',
        yAxis: {
            type: 'logarithmic',
            min: 1e-9,
            max: 1e-2,
            ticks: { color: '#ddd', callback: (value: any) => Number(value).toExponential() },
            grid: { color: 'rgba(255,255,255,0.1)' },
            title: { display: true, text: 'Watts m^-2', color: '#ddd' }
        },
        lineTension: 0,
        datasets: [
            { label: 'GOES-19 Long', borderColor: 'red', backgroundColor: 'rgba(255,100,100,0.2)', fill: false },
            { label: 'GOES-19 Short', borderColor: 'blue', backgroundColor: 'rgba(100,150,255,0.2)', fill: false },
            { label: 'GOES-18 Long', borderColor: 'orange', backgroundColor: 'rgba(255,180,100,0.2)', fill: false },
            { label: 'GOES-18 Short', borderColor: 'purple', backgroundColor: 'rgba(180,120,255,0.2)', fill: false }
        ],
        queries: (baseQuery: string) => ({
            metrics: `${baseQuery} |> filter(fn: (r) => r["_measurement"] == "solar_xray_flux" and r["_field"] == "flux") |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)`,
            status: `${baseQuery} |> filter(fn: (r) => r["_measurement"] == "hf_blackout" and r["_field"] == "status_message")`
        }),
        parseMetrics: (lines: string[], chart: Chart) => {
            const headerLine = lines[0];
            const dataLines = lines.slice(1).filter(line => line && !line.startsWith('#') && !line.startsWith(',result'));
            const h = headerLine.split(',');
            const [tIdx, vIdx, satIdx, energyIdx] = ['_time', '_value', 'satellite', 'energy'].map(k => h.indexOf(k));
            const keyMap: Record<string, number> = {
                'GOES16_0.1-0.8nm': 0,
                'GOES16_0.05-0.4nm': 1,
                'GOES17_0.1-0.8nm': 2,
                'GOES17_0.05-0.4nm': 3
            };

            for (const line of dataLines) {
                const p = line.split(',');
                const timeValue = p[tIdx];
                const value = parseFloat(p[vIdx] || '0');
                const satellite = (p[satIdx] || '').replace(/"/g, '');
                const energy = (p[energyIdx] || '').replace(/"/g, '');
                const key = `${satellite}_${energy}`;
                const datasetIndex = keyMap[key];

                if (datasetIndex != null && value > 0) {
                    (chart.data.datasets[datasetIndex].data as any).push({ x: new Date(timeValue).getTime(), y: value });
                }
            }
        },
        parseStatus: (lines: string[]) => {
            const h = lines[0].split(',');
            const [tIdx, vIdx] = [h.indexOf('_time'), h.indexOf('_value')];
            return lines.slice(1).map(line => {
                const parts = line.split(/,(?=(?:(?:[^\"]*"){2})*[^\"]*$)/);
                const rawValue = parts[vIdx] || '';
                const text = rawValue.replace(/^"|"$/g, '');
                return { time: new Date(parts[tIdx]).getTime(), msg: text || 'X-Ray Monitor', isAlert: /flare|blackout|warning|caution/i.test(text) };
            });
        }
    },

    'IONOSONDE': {
        bucketEnv: 'INFLUXDB_IONOSONDE_BUCKET',
        fallbackBucket: 'Malindi_Ionosonde_Autoscaled',
        yAxis: { type: 'linear', title: { display: true, text: 'MUF(3000)F2 (MHz)', color: '#ddd' } },
        lineTension: 0.4,
        datasets: [{ label: 'MUF over 3000km', borderColor: '#42f5ad', fill: false }],
        queries: (baseQuery: string) => ({
            metrics: `${baseQuery} |> filter(fn: (r) => r["_measurement"] == "ionospheric_data" and r["_field"] == "muf3000f2" and r["station"] == "ML10L") |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)`,
            status: null // No status alerts for Ionosonde yet
        }),
        parseMetrics: (lines: string[], chart: Chart) => {
            const h = lines[0].split(',');
            const [tIdx, vIdx] = ['_time', '_value'].map(k => h.indexOf(k));
            for (let i = 1; i < lines.length; i++) {
                const p = lines[i].split(',');
                (chart.data.datasets[0].data as any).push({ x: new Date(p[tIdx]).getTime(), y: parseFloat(p[vIdx] || '0') });
            }
        },
        parseStatus: () => [] // Returns empty array
    }
    // ... ADD GOES OR NEW SENSORS HERE Following the exact same structure!
};