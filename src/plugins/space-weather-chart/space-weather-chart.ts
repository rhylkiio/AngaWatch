import { MenuMode, ToastMsgType } from '@app/engine/core/interfaces';
import { ServiceLocator } from '@app/engine/core/service-locator';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { KeepTrackPlugin } from '@app/engine/plugins/base-plugin';
import { html } from '@app/engine/utils/development/formatter';
import { getEl } from '@app/engine/utils/get-el';
import swChartIcon from '@public/img/icons/solar-flare.png';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';

// Import our centralized configuration dictionary
import { spaceWeatherSensors } from '@app/app/data/catalogs/space-weather-sensors';
import { SENSOR_CHART_CONFIGS } from '../../app/data/catalogs/space-weather-configs';
import './space-weather-chart.css';
Chart.register(...registerables);

export class SpaceWeatherChartPlugin extends KeepTrackPlugin {
    readonly id = 'SpaceWeatherChartPlugin';

    private chart_: Chart | null = null;
    private activeSensor_: string | null = null;
    private activeFamily_: string | null = null; // e.g., 'TART', 'GOES', 'IONOSONDE'

    private statusCache_: { time: number, msg: string, isAlert: boolean }[] = [];
    private cacheValidBounds_ = { start: 0, end: 0 };
    private pollerId_: ReturnType<typeof setInterval> | null = null;

    // --- Plugin Setup ---
    menuMode: MenuMode[] = [MenuMode.ANALYSIS, MenuMode.ALL];
    bottomIconElementName = 'unified-sw-chart-bottom-icon';
    bottomIconLabel = 'SW Charts';
    bottomIconImg = swChartIcon;
    sideMenuElementName = 'unified-sw-chart-menu';
    sideMenuTitle = 'Space Weather Charts';
    isIconDisabled = true;
    isIconDisabledOnLoad = true;

    bottomIconCallback = () => {
        if (this.isMenuButtonActive) {
            setTimeout(() => {
                if (!this.chart_) this.initChart();
                this.applyChartConfig_();
            }, 350);
        }
    };

    sideMenuElementHtml = html`
    <div id="unified-sw-chart-menu" class="side-menu-parent start-hidden">
        <div class="side-menu sw-chart-container">
            <div class="sw-status-box">
                <span id="sw-status-message">Loading...</span>
                <div id="sw-last-updated" style="font-size: 0.7em; opacity: 0.7; margin-top: 4px;"></div>
            </div>

            <div class="plot-analysis-chart plot-analysis-menu-maximized">
                <canvas id="unified-sw-chart"></canvas>
            </div>

            <div style="font-size: 0.7em; text-align: center; padding: 10px; color: rgba(255,255,255,0.4);">
                Data provided via InfluxDB
            </div>
        </div>
    </div>`;

    addJs() {
        super.addJs();

        // 1. Listen for requests from the SpaceWeatherListPlugin (intentional "Graph" icon click)
        EventBus.getInstance().on('OPEN_SPACE_WEATHER_CHART' as any, (sensorId: string) => {
            const sensorObj = spaceWeatherSensors[sensorId];
            if (!sensorObj) return;

            // Ensure the chart icon is enabled and visible when opening from the SW sensor list.
            this.setBottomIconToEnabled();
            this.showBottomIcon();

            // Force update internal state immediately
            this.activeSensor_ = sensorId;
            let family = sensorObj.system?.toUpperCase();
            if (!family || !SENSOR_CHART_CONFIGS[family]) {
                family = sensorId.split('-')[0]?.toUpperCase();
            }
            this.activeFamily_ = family;

            if (!this.isMenuButtonActive) {
                // This triggers the sliding animation and the bottomIconCallback logic
                getEl(this.bottomIconElementName)?.click();
            } else {
                // If already open, just refresh for the new sensor
                if (!this.chart_) this.initChart();
                this.applyChartConfig_();
            }
        });

        // 2. Listen for global selection events (Globe click or List row click)
        EventBus.getInstance().on(EventBusEvent.selectSatData, () => {
            const sm = ServiceLocator.getSensorManager();
            const currentSensor = sm.currentSensors[0];
            const currentSensorId = currentSensor?.sensorId;
            const currentSensorKey = typeof currentSensorId === 'string'
                ? currentSensorId
                : currentSensorId != null
                    ? String(currentSensorId)
                    : undefined;

            if (currentSensor && currentSensorKey && spaceWeatherSensors[currentSensorKey]) {
                this.showBottomIcon();
                this.setActiveSensor_(currentSensor);
            } else {
                this.hideBottomIcon();
            }
        });

        // 3. Listen for Time Slider movements
        const refreshFn = () => this.refreshData_(false);
        EventBus.getInstance().on(EventBusEvent.updateDateTime, refreshFn);
        EventBus.getInstance().on(EventBusEvent.staticOffsetChange, refreshFn);

        // 4. Background Data Poller
        if (this.pollerId_) clearInterval(this.pollerId_);
        this.pollerId_ = setInterval(() => {
            if (this.activeSensor_ && this.isMenuButtonActive) {
                this.refreshData_(false, true);
            }
        }, 60000);
    }

    private setActiveSensor_(sensor: any) {
        if (!sensor) return;

        let family = sensor.system?.toUpperCase();
        if (!family || !SENSOR_CHART_CONFIGS[family]) {
            family = sensor.sensorId?.split('-')[0]?.toUpperCase();
        }

        if (family && SENSOR_CHART_CONFIGS[family]) {
            this.activeSensor_ = sensor.sensorId;
            this.activeFamily_ = family;

            if (this.isMenuButtonActive) {
                if (!this.chart_) this.initChart();
                this.applyChartConfig_();
            }
        }
    }

    private initChart() {
        const ctx = getEl('unified-sw-chart') as HTMLCanvasElement;
        if (!ctx) return;

        this.chart_ = new Chart(ctx, {
            type: 'line',
            data: { datasets: [] },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                elements: { point: { radius: 0, hitRadius: 10, hoverRadius: 4 } },
                scales: {
                    x: { type: 'time', time: { unit: 'hour' }, ticks: { color: '#ddd' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                    y: { ticks: { color: '#ddd' }, grid: { color: 'rgba(255,255,255,0.1)' } }
                },
                plugins: {
                    legend: { labels: { color: '#ddd', boxWidth: 12, font: { size: 10 } } },
                    tooltip: {
                        callbacks: {
                            label: (context: any) => {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';

                                const val = context.parsed.y;
                                if (val !== null && val !== undefined) {
                                    // Switch to scientific notation for extremely small or large numbers
                                    if (val !== 0 && (Math.abs(val) < 0.001 || Math.abs(val) >= 100000)) {
                                        label += val.toExponential(3);
                                    } else {
                                        // Otherwise use standard formatting (up to 3 decimal places)
                                        label += Number.isInteger(val) ? val.toString() : val.toFixed(3);
                                    }
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        }
        );
    }

    private applyChartConfig_() {
        const config = SENSOR_CHART_CONFIGS[this.activeFamily_!];
        if (!config || !this.chart_) {
            this.setStatus_('Configuration missing for this sensor', true);
            return;
        }

        const sensorName = spaceWeatherSensors[this.activeSensor_!]?.uiName || this.activeSensor_;
        const titleText = `${sensorName} Telemetry`;
        this.sideMenuTitle = titleText;
        const menuRoot = getEl(this.sideMenuElementName, true);
        const titleEl = menuRoot ? menuRoot.querySelector<HTMLHeadingElement>('.side-menu-title-text') : null;
        if (titleEl) {
            titleEl.innerText = titleText;
        }

        this.setStatus_('Loading data...', false);

        // Dynamically apply the specific Y-axis and Line properties from the config file
        this.chart_.options.scales!.y = { ...this.chart_.options.scales!.y, ...config.yAxis };
        if (this.chart_.options.elements?.line) {
            this.chart_.options.elements.line.tension = config.lineTension ?? 0.4;
        }

        // Map boilerplate settings to the configured datasets
        this.chart_.data.datasets = config.datasets.map((d: any) => ({
            ...d, data: [], borderWidth: d.borderWidth || 2, normalized: true, parsing: false, pointRadius: 0
        }));

        this.chart_.update('none');
        this.refreshData_(true, true); // Force a fresh data load
    }

    private refreshData_(showToast = false, forceFetch = false) {
        if (!this.activeSensor_ || !this.chart_ || !this.isMenuButtonActive) return;

        const timeMs = ServiceLocator.getTimeManager().simulationTimeObj.getTime();

        // Update the X-axis bounds continuously
        if (this.chart_.options.scales?.x) {
            this.chart_.options.scales.x.max = timeMs;
            this.chart_.options.scales.x.min = timeMs - (12 * 60 * 60 * 1000); // 12 hour lookback
            this.chart_.update('none');
        }

        const needsNewData = forceFetch || timeMs > this.cacheValidBounds_.end || (timeMs - (12 * 60 * 60 * 1000)) < this.cacheValidBounds_.start;

        if (needsNewData) {
            // Debounce the network fetch
            setTimeout(() => this.fetchInfluxData_(timeMs, showToast), 100);
        } else {
            this.updateStatusUI_(timeMs, showToast);
        }
    }

    // --- GENERIC INFLUX FETCHER ---
    private getInfluxEnv_() {
        return {
            url: process.env.INFLUXDB_URL ?? '',
            token: process.env.INFLUXDB_TOKEN ?? '',
            org: process.env.INFLUXDB_ORG ?? '',
            buckets: {
                INFLUXDB_X_RAY_BUCKET: process.env.INFLUXDB_X_RAY_BUCKET ?? '',
                INFLUXDB_TART_BUCKET: process.env.INFLUXDB_TART_BUCKET ?? '',
                INFLUXDB_IONOSONDE_BUCKET: process.env.INFLUXDB_IONOSONDE_BUCKET ?? ''
            },
            get hasCredentials() {
                return Boolean(this.url && this.token && this.org && this.url !== 'undefined' && this.token !== 'undefined' && this.org !== 'undefined');
            }
        };
    }

    private async fetchInfluxData_(targetMs: number, showToast: boolean) {
        const config = SENSOR_CHART_CONFIGS[this.activeFamily_!];
        if (!config) return;

        const influxEnv = this.getInfluxEnv_();
        if (!influxEnv.hasCredentials) {
            console.warn('SW Chart: InfluxDB Credentials missing or undefined in bundle.');
            return this.setStatus_('InfluxDB not configured', true);
        }

        const bucket = influxEnv.buckets[config.bucketEnv] || config.fallbackBucket;
        const startIso = new Date(targetMs - 12 * 60 * 60 * 1000).toISOString();
        const stopIso = new Date(targetMs + 12 * 60 * 60 * 1000).toISOString();
        this.cacheValidBounds_ = { start: targetMs - 12 * 60 * 60 * 1000, end: targetMs + 12 * 60 * 60 * 1000 };

        const baseUrl = (influxEnv.url || '').toString();
        if (!baseUrl) {
            console.warn('SW Chart: InfluxDB URL missing or empty.');
            return this.setStatus_('InfluxDB not configured', true);
        }
        const queryUrl = `${baseUrl.replace(/\/$/, '')}/api/v2/query?org=${encodeURIComponent(influxEnv.org)}`;
        const headers = { 'Authorization': `Token ${influxEnv.token}`, 'Content-Type': 'application/json', 'Accept': 'application/csv' };

        // Ask the config file to generate its specific Flux queries
        const baseQuery = `from(bucket: "${bucket}") |> range(start: ${startIso}, stop: ${stopIso})`;
        const queries = config.queries(baseQuery);

        try {
            const promises = [fetch(queryUrl, { method: 'POST', headers, body: JSON.stringify({ query: queries.metrics, type: 'flux' }) })];

            // Only fetch status if the config defined a status query
            if (queries.status) {
                promises.push(fetch(queryUrl, { method: 'POST', headers, body: JSON.stringify({ query: queries.status, type: 'flux' }) }));
            }

            const results = await Promise.all(promises);

            // Hand the raw CSV back to the config file's custom parsers
            if (results[0].ok) {
                this.parseGenericMetrics_(await results[0].text(), config);
            }

            if (queries.status && results[1] && results[1].ok) {
                this.parseGenericStatus_(await results[1].text(), config);
            } else if (!queries.status) {
                // Fallback if this sensor family doesn't have status alerts (like Ionosondes)
                this.statusCache_ = [{ time: targetMs, msg: 'Telemetry Online', isAlert: false }];
            }

            this.updateStatusUI_(targetMs, showToast);
        } catch (e) {
            if (window.location.protocol === 'https:' && influxEnv.url.startsWith('http:')) {
                this.setStatus_('Security Block (Use HTTPS)', true);
            } else {
                this.setStatus_(influxEnv.url.startsWith('http://192') ? 'Local IP Only' : 'Connection Error', true);
            }
            console.error('Space Weather Fetch Error:', e instanceof Error ? e.message : 'Unknown Error');
        }
    }

    // --- GENERIC PARSERS ---
    private parseGenericMetrics_(csv: string, config: any) {
        if (!this.chart_ || typeof csv !== 'string') return;

        const lines = csv.replace(/\r/g, '').trim().split('\n');
        const headerIndex = lines.findIndex(l => l.includes('_time') && l.includes('_value'));
        if (headerIndex === -1) return;

        // Clear existing data from the chart
        this.chart_.data.datasets.forEach((d: any) => d.data = []);

        // CRITICAL FIX: Explicitly keep the header line at index 0.
        // Only filter the rows that come *after* the header.
        const headerLine = lines[headerIndex];
        const rawData = lines.slice(headerIndex + 1).filter(l => l.trim() && !l.startsWith('#') && !l.startsWith(',result'));
        const dataLines = [headerLine, ...rawData];

        try {
            config.parseMetrics(dataLines, this.chart_);
        } catch (e) {
            console.error('SW Chart: Error inside config.parseMetrics:', e);
        }

        this.chart_.update('none');
    }

    private parseGenericStatus_(csv: string, config: any) {
        if (typeof csv !== 'string') return;

        const lines = csv.replace(/\r/g, '').trim().split('\n');
        const headerIndex = lines.findIndex(l => l.includes('_time') && l.includes('_value'));
        if (headerIndex === -1) return;

        // CRITICAL FIX: Explicitly keep the header line at index 0.
        const headerLine = lines[headerIndex];
        const rawData = lines.slice(headerIndex + 1).filter(l => l.trim() && !l.startsWith('#') && !l.startsWith(',result'));
        const dataLines = [headerLine, ...rawData];

        try {
            this.statusCache_ = config.parseStatus(dataLines) || [];
            this.statusCache_.sort((a, b) => a.time - b.time);
        } catch (e) {
            console.error('SW Chart: Error inside config.parseStatus:', e);
        }
    }

    // --- UI UPDATES ---
    private updateStatusUI_(targetMs: number, showToast: boolean) {
        const thresholdMs = targetMs - (15 * 60 * 1000); // 15 minute lookback for current status

        // Find the most recent status entry
        const validEntry = [...this.statusCache_].reverse().find(e => e.time <= targetMs && e.time >= thresholdMs);

        if (validEntry) {
            this.setStatus_(validEntry.msg, validEntry.isAlert);
            if (showToast) {
                ServiceLocator.getUiManager()?.toast(validEntry.msg, validEntry.isAlert ? ToastMsgType.caution : ToastMsgType.normal);
            }
        } else {
            this.setStatus_('No recent telemetry data', false);
        }
    }

    private setStatus_(msg: string, isAlert: boolean) {
        const el = getEl('sw-status-message');
        if (el) {
            el.innerText = msg;
            el.style.color = isAlert ? '#ff4444' : '#a3e4d7';
        }

        const timeEl = getEl('sw-last-updated');
        if (timeEl) {
            timeEl.innerText = `Updated: ${new Date().toLocaleTimeString()}`;
        }
    }
}