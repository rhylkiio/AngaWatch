// @app/app/data/catalogs/space-weather-configs.ts
import { Chart } from 'chart.js';

// --- CONFIG GENERATOR FOR IONOSONDES ---
// Prevents massive code duplication by standardizing the Ionosonde config structure
const createIonosondeConfig = (field: string, label: string, yAxisTitle: string, color: string) => ({
    bucketEnv: 'INFLUXDB_IONOSONDE_BUCKET',
    fallbackBucket: 'Malindi_Ionosonde_Autoscaled',
    yAxis: { type: 'linear', title: { display: true, text: yAxisTitle, color: '#ddd' } },
    lineTension: 0.4,
    datasets: [{ label: label, borderColor: color, fill: false }],
    queries: (baseQuery: string) => ({
        // Matches your exact Grafana filtering
        metrics: `${baseQuery} |> filter(fn: (r) => r["_measurement"] == "ionospheric_data" and r["_field"] == "${field}" and r["location"] == "Malindi, Kenya" and r["station"] == "ML10L") |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)`,
        status: null // No status alerts for Ionosonde yet
    }),
    parseMetrics: (lines: string[], chart: Chart) => {
        if (!lines || lines.length <= 1) return;
        const cleanHeader = lines[0].startsWith(',') ? lines[0].substring(1) : lines[0];
        const safeSplit = (str: string) => str.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

        const h = safeSplit(cleanHeader);
        const [tIdx, vIdx] = ['_time', '_value'].map(k => h.indexOf(k));

        if (tIdx === -1 || vIdx === -1) return;

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            const cleanLine = lines[i].startsWith(',') ? lines[i].substring(1) : lines[i];
            const p = safeSplit(cleanLine);
            if (p.length <= Math.max(tIdx, vIdx)) continue;

            const tMs = new Date(p[tIdx]).getTime();
            if (isNaN(tMs)) continue;

            (chart.data.datasets[0].data as any).push({ x: tMs, y: parseFloat(p[vIdx] || '0') });
        }
    },
    parseStatus: () => []
});

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
        queries: (baseQuery: string) => ({
            metrics: `${baseQuery} |> filter(fn: (r) => r["_measurement"] == "solar_radio_burst" and (r["_field"] == "median_power" or r["_field"] == "threshold")) |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)`,
            status: `${baseQuery} |> filter(fn: (r) => r["_measurement"] == "solar_radio_burst" and r["_field"] == "srb_detected") |> aggregateWindow(every: 5m, fn: max, createEmpty: false)`
        }),
        parseMetrics: (lines: string[], chart: Chart) => {
            if (!lines || lines.length <= 1) return;
            const h = lines[0].split(',');
            const [tIdx, vIdx, fIdx] = ['_time', '_value', '_field'].map(k => h.indexOf(k));

            if (tIdx === -1 || vIdx === -1 || fIdx === -1) return;

            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;

                const p = lines[i].split(',');
                if (p.length <= Math.max(tIdx, vIdx, fIdx)) continue;

                const val = parseFloat(p[vIdx] || '0');
                const tMs = new Date(p[tIdx]).getTime();

                if (isNaN(tMs)) continue;

                const field = (p[fIdx] || '').replace(/"/g, '');

                if (field === 'median_power') (chart.data.datasets[0].data as any).push({ x: tMs, y: val });
                if (field === 'threshold') (chart.data.datasets[1].data as any).push({ x: tMs, y: val });
            }
        },
        parseStatus: (lines: string[]) => {
            if (!lines || lines.length <= 1) return [];
            const h = lines[0].split(',');
            const [tIdx, vIdx] = [h.indexOf('_time'), h.indexOf('_value')];

            if (tIdx === -1 || vIdx === -1) return [];

            return lines.slice(1).reduce((acc, line) => {
                if (!line.trim()) return acc;

                const p = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
                if (p.length <= Math.max(tIdx, vIdx)) return acc;

                const tMs = new Date(p[tIdx]).getTime();
                if (!isNaN(tMs)) {
                    const isDetected = parseFloat(p[vIdx] || '0') === 1;
                    acc.push({ time: tMs, msg: isDetected ? 'SRB Detected' : 'Nominal', isAlert: isDetected });
                }
                return acc;
            }, [] as any[]);
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
            if (!lines || lines.length <= 1) return;
            const headerLine = lines[0];
            const dataLines = lines.slice(1).filter(line => line && line.trim() !== '' && !line.startsWith('#') && !line.startsWith(',result'));

            const h = headerLine.split(',');
            const [tIdx, vIdx, satIdx, energyIdx] = ['_time', '_value', 'satellite', 'energy'].map(k => h.indexOf(k));

            if (tIdx === -1 || vIdx === -1 || satIdx === -1 || energyIdx === -1) return;

            const keyMap: Record<string, number> = {
                'GOES16_0.1-0.8nm': 0, 'GOES16_0.05-0.4nm': 1,
                'GOES17_0.1-0.8nm': 2, 'GOES17_0.05-0.4nm': 3
            };

            for (const line of dataLines) {
                const p = line.split(',');
                if (p.length <= Math.max(tIdx, vIdx, satIdx, energyIdx)) continue;

                const timeValue = p[tIdx];
                const tMs = new Date(timeValue).getTime();
                if (isNaN(tMs)) continue;

                const value = parseFloat(p[vIdx] || '0');
                const satellite = (p[satIdx] || '').replace(/"/g, '');
                const energy = (p[energyIdx] || '').replace(/"/g, '');
                const key = `${satellite}_${energy}`;
                const datasetIndex = keyMap[key];

                if (datasetIndex != null && value > 0) {
                    (chart.data.datasets[datasetIndex].data as any).push({ x: tMs, y: value });
                }
            }
        },
        parseStatus: (lines: string[]) => {
            if (!lines || lines.length <= 1) return [];
            const h = lines[0].split(',');
            const [tIdx, vIdx] = [h.indexOf('_time'), h.indexOf('_value')];

            if (tIdx === -1 || vIdx === -1) return [];

            return lines.slice(1).reduce((acc, line) => {
                if (!line.trim()) return acc;

                const parts = line.split(/,(?=(?:(?:[^\"]*"){2})*[^\"]*$)/);
                if (parts.length <= Math.max(tIdx, vIdx)) return acc;

                const tMs = new Date(parts[tIdx]).getTime();
                if (!isNaN(tMs)) {
                    const rawValue = parts[vIdx] || '';
                    const text = rawValue.replace(/^"|"$/g, '');
                    acc.push({ time: tMs, msg: text || 'X-Ray Monitor', isAlert: /flare|blackout|warning|caution/i.test(text) });
                }
                return acc;
            }, [] as any[]);
        }
    },

    // Dynamically generated configs using the helper
    'IONOSONDE_MUF3000F2': createIonosondeConfig('muf3000f2', 'MUF over 3000km', 'MUF(3000)F2 (MHz)', '#42f5ad'),
    'IONOSONDE_M3000F2': createIonosondeConfig('m3000f2', 'M(3000)F2 Factor', 'M(3000)F2', '#36a2eb'),
    'IONOSONDE_FOF2': createIonosondeConfig('fof2', 'foF2 Critical Freq', 'foF2 (MHz)', '#ff6384'),
    'IONOSONDE_HMF2': createIonosondeConfig('hmf2', 'hmF2 Peak Height', 'hmF2 (km)', '#ff9f40'),
    'IONOSONDE_FOE': createIonosondeConfig('foe', 'foE Critical Freq', 'foE (MHz)', '#9966ff'),
    'IONOSONDE_FOF1': createIonosondeConfig('fof1', 'foF1 Critical Freq', 'foF1 (MHz)', '#ffcd56'),
    'IONOSONDE_HME': createIonosondeConfig('hme', 'hmE Peak Height', 'hmE (km)', '#c9cbcf')
};