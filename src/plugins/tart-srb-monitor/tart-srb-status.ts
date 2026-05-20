import { MenuMode, ToastMsgType } from '@app/engine/core/interfaces';
import { ServiceLocator } from '@app/engine/core/service-locator';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { KeepTrackPlugin } from '@app/engine/plugins/base-plugin';
import { html } from '@app/engine/utils/development/formatter';
import { getEl } from '@app/engine/utils/get-el';
// You can replace this icon with a generic radio/antenna icon later
import radioIcon from '@public/img/icons/solar-flare.png';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import './tart-srb-status.css';

Chart.register(...registerables);

export class TartSrbMonitor extends KeepTrackPlugin {
    readonly id = 'TartSrbMonitor';
    private lastStatusMessage_ = 'Loading...';
    private chart_: Chart | null = null;

    private intervalId_: ReturnType<typeof setInterval> | null = null;
    private timeUpdateTimeout_: number | null = null;

    private cacheValidStartMs_ = 0;
    private cacheValidEndMs_ = 0;
    private cachedDetectionStore_: { time: number, msg: string, isAlert: boolean }[] = [];

    // --- Modern KeepTrack Plugin Properties ---
    menuMode: MenuMode[] = [MenuMode.EVENTS, MenuMode.ALL];
    bottomIconElementName = 'tart-srb-monitor-bottom-icon';
    bottomIconLabel = 'SRB Detect';
    bottomIconImg = radioIcon;

    sideMenuElementName = 'tart-srb-monitor-menu';
    sideMenuTitle = 'TART TUK';
    sideMenuElementHtml: string = html`
    <div id="tart-srb-monitor-menu" class="side-menu-parent start-hidden">
        <div class="side-menu">
            <div class="plot-analysis-chart plot-analysis-menu-maximized">
                <canvas id="tart-srb-chart"></canvas>
            </div>
            <div style="font-size: 0.7em; text-align: center; padding: 10px; color: rgba(255,255,255,0.4);">
                TART Telescope Station Data
            </div>
        </div>
    </div>`;

    bottomIconCallback = () => {
        if (this.isMenuButtonActive) {
            setTimeout(() => {
                const renderChartWhenIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));

                renderChartWhenIdle(() => {
                    if (!this.chart_) this.initChart();
                    this.refreshForTimeChange_(true);
                });
            }, 350);
        }
    };

    addHtml() {
        super.addHtml();
    }

    addJs() {
        super.addJs();
        EventBus.getInstance().on(EventBusEvent.uiManagerFinal, () => {
            const eventsPanel = document.getElementById('events-menu-content');

            if (eventsPanel) {
                const itemHtml = `
                    <div id="tart-srb-event-item" class="menu-item bmenu-item-error" style="cursor: pointer;">
                      <img src="${radioIcon}" style="width: 25px; vertical-align: middle; margin-right: 8px;">
                      <span class="menu-title">TART SRB Status</span>
                      <div id="srb-status-message" class="menu-value">${this.lastStatusMessage_}</div>
                      <div id="srb-last-updated" class="menu-value" style="font-size: 0.7em; opacity: 0.7;"></div>
                    </div>
                `;
                eventsPanel.insertAdjacentHTML('beforeend', itemHtml);
                this.updateUIInternal_();

                document.getElementById('tart-srb-event-item')?.addEventListener('click', () => {
                    document.getElementById(this.bottomIconElementName)?.click();
                });
            }
        });

        EventBus.getInstance().on(EventBusEvent.updateDateTime, () => this.refreshForTimeChange_());
        EventBus.getInstance().on(EventBusEvent.staticOffsetChange, () => this.refreshForTimeChange_());

        if (this.intervalId_) clearInterval(this.intervalId_);
        this.intervalId_ = setInterval(() => {
            if (this.isMenuButtonActive) {
                this.refreshForTimeChange_(false, true);
            }
        }, 60000);
    }

    private initChart() {
        const canvas = getEl('tart-srb-chart') as HTMLCanvasElement;
        if (!canvas) return;

        this.chart_ = new Chart(canvas, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'Median Baseline Power',
                        borderColor: '#8c96c6', // Continuous-BlPu color representation
                        backgroundColor: 'rgba(140, 150, 198, 0.68)', // fillOpacity 68 from Grafana
                        data: [],
                        borderWidth: 1,
                        pointRadius: 0,
                        tension: 0.4, // Smooth interpolation
                        fill: true,
                        normalized: true,
                        parsing: false
                    },
                    {
                        label: 'Detection Threshold (6σ)',
                        borderColor: 'orange',
                        backgroundColor: 'transparent',
                        data: [],
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.4, // Smooth interpolation
                        fill: false,
                        normalized: true,
                        parsing: false
                    }
                ]
            },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                elements: { point: { radius: 0, hitRadius: 10, hoverRadius: 4 } },
                scales: {
                    y: {
                        type: 'linear', // Switched to linear per Grafana JSON
                        ticks: { color: '#ddd' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        title: { display: true, text: 'Correlated Power', color: '#ddd' }
                    },
                    x: {
                        type: 'time',
                        time: { unit: 'hour' },
                        ticks: { color: '#ddd' },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        title: { display: true, text: 'TIME [EAT]', color: '#ddd' }
                    }
                },
                plugins: { legend: { labels: { color: '#ddd', boxWidth: 12, font: { size: 10 } } } }
            }
        });
    }

    private refreshForTimeChange_(showToast = false, forceFetch = false) {
        if (!this.isMenuButtonActive) return;

        const targetTimeMs = ServiceLocator.getTimeManager().simulationTimeObj.getTime();

        if (this.chart_ && this.chart_.options.scales?.x) {
            this.chart_.options.scales.x.max = targetTimeMs;
            this.chart_.options.scales.x.min = targetTimeMs - (12 * 60 * 60 * 1000);
            this.chart_.update('none');
        }

        const needsNewData = targetTimeMs > this.cacheValidEndMs_ || (targetTimeMs - (12 * 60 * 60 * 1000)) < this.cacheValidStartMs_;

        if (!needsNewData && !forceFetch) {
            this.updateDetectionFromCache_(targetTimeMs, showToast);
            return;
        }

        if (this.timeUpdateTimeout_) window.clearTimeout(this.timeUpdateTimeout_);

        this.timeUpdateTimeout_ = window.setTimeout(() => {
            this.fetchAllData_(targetTimeMs, showToast);
            this.timeUpdateTimeout_ = null;
        }, 500);
    }

    private async fetchAllData_(targetTimeMs: number, showToast: boolean) {
        const INFLUX_URL = process.env.INFLUXDB_URL;
        const INFLUX_TOKEN = process.env.INFLUXDB_TOKEN;
        const INFLUX_ORG = process.env.INFLUXDB_ORG;
        const INFLUX_TART_BUCKET = process.env.INFLUXDB_TART_BUCKET || 'TART-Kenya'; // Fallback to 'TART-Kenya' if not set, but ideally this should be explicitly defined in the environment variables

        // Robust validation for environment variables
        if (!INFLUX_URL || INFLUX_URL === 'undefined' ||
            !INFLUX_TOKEN || INFLUX_TOKEN === 'undefined' ||
            !INFLUX_ORG || INFLUX_ORG === 'undefined') return;


        const fetchStartMs = targetTimeMs - (12 * 60 * 60 * 1000);
        const fetchEndMs = targetTimeMs + (12 * 60 * 60 * 1000);

        const startIso = new Date(fetchStartMs).toISOString();
        const stopIso = new Date(fetchEndMs).toISOString();

        this.cacheValidStartMs_ = fetchStartMs;
        this.cacheValidEndMs_ = fetchEndMs;

        const fluxQueryBase = `from(bucket: "${INFLUX_TART_BUCKET}") |> range(start: ${startIso}, stop: ${stopIso}) |> filter(fn: (r) => r["_measurement"] == "solar_radio_burst")`;

        // Query for power and threshold means
        const metricsDataQuery = `${fluxQueryBase} |> filter(fn: (r) => r["_field"] == "median_power" or r["_field"] == "threshold") |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)`;

        // Query for detection utilizing max
        const detectionQuery = `${fluxQueryBase} |> filter(fn: (r) => r["_field"] == "srb_detected") |> aggregateWindow(every: 5m, fn: max, createEmpty: false)`;

        try {
            const queryUrl = `${INFLUX_URL.replace(/\/$/, '')}/api/v2/query?org=${encodeURIComponent(INFLUX_ORG)}`;

            const [metricsRes, detectionRes] = await Promise.all([
                fetch(queryUrl, { method: 'POST', headers: { 'Authorization': `Token ${INFLUX_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/csv' }, body: JSON.stringify({ query: metricsDataQuery, type: 'flux' }) }),
                fetch(queryUrl, { method: 'POST', headers: { 'Authorization': `Token ${INFLUX_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/csv' }, body: JSON.stringify({ query: detectionQuery, type: 'flux' }) })
            ]);

            if (metricsRes.ok) this.parseMetricsToCache_(await metricsRes.text());
            if (detectionRes.ok) this.parseDetectionToCache_(await detectionRes.text());

            this.updateDetectionFromCache_(targetTimeMs, showToast);
        } catch (error) {
            if (window.location.protocol === 'https:' && INFLUX_URL.startsWith('http:')) {
                this.lastStatusMessage_ = 'Security Block (Use HTTPS)';
            } else {
                this.lastStatusMessage_ = INFLUX_URL.startsWith('http://192') ? 'Local IP Only' : 'Connection Error';
            }
            this.updateUIInternal_();
            console.error(`TART SRB Data Fetch Error: ${error instanceof Error ? error.message : 'Unknown Error'}`);
        }
    }

    private parseMetricsToCache_(csv: string) {
        if (!this.chart_) return;

        setTimeout(() => {
            const cleanCsv = csv.replace(/\r/g, '');
            const lines = cleanCsv.trim().split('\n');

            const headerLine = lines.find(l => l.includes(',_time,') && l.includes(',_value,'));
            if (!headerLine) return;

            const headers = headerLine.split(',');
            const timeIdx = headers.indexOf('_time');
            const valIdx = headers.indexOf('_value');
            const fieldIdx = headers.indexOf('_field');

            const store: Record<string, { x: number, y: number }[]> = {
                'median_power': [], 'threshold': []
            };

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('#') || line.startsWith(',result') || line === headerLine) continue;

                const p = line.split(',');
                const field = (p[fieldIdx] || '').replace(/"/g, '');

                if (store[field]) {
                    const val = parseFloat(p[valIdx] || '0');
                    store[field].push({ x: new Date(p[timeIdx]).getTime(), y: val });
                }
            }

            this.chart_!.data.datasets[0].data = store['median_power'];
            this.chart_!.data.datasets[1].data = store['threshold'];
            this.chart_!.update('none');
        }, 10);
    }

    private parseDetectionToCache_(csv: string) {
        this.cachedDetectionStore_ = [];
        const cleanCsv = csv.replace(/\r/g, '');
        const lines = cleanCsv.trim().split('\n');

        const headerLine = lines.find((l) => l.includes(',_value,'));
        if (!headerLine) return;

        const headers = headerLine.split(',');
        const valIdx = headers.indexOf('_value');
        const timeIdx = headers.indexOf('_time');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('#') || line.startsWith(',result') || line === headerLine) continue;

            const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (parts[timeIdx] && parts[valIdx]) {
                const val = parseFloat(parts[valIdx]);
                const isDetected = val === 1;

                this.cachedDetectionStore_.push({
                    time: new Date(parts[timeIdx]).getTime(),
                    msg: isDetected ? 'Solar Radio Burst Detected' : 'Nominal TART Operations',
                    isAlert: isDetected
                });
            }
        }

        this.cachedDetectionStore_.sort((a, b) => a.time - b.time);
    }

    private updateDetectionFromCache_(targetTimeMs: number, showToast = false) {
        const fifteenMinsAgoMs = targetTimeMs - (15 * 60 * 1000);
        let statusMessage = 'No recent SRB data';
        let isAlert = false;

        for (let i = this.cachedDetectionStore_.length - 1; i >= 0; i--) {
            const entry = this.cachedDetectionStore_[i];
            if (entry.time <= targetTimeMs && entry.time >= fifteenMinsAgoMs) {
                statusMessage = entry.msg;
                isAlert = entry.isAlert;
                break;
            }
        }

        if (this.lastStatusMessage_ !== statusMessage || showToast) {
            this.lastStatusMessage_ = statusMessage;
            this.updateUIInternal_();

            if (showToast && statusMessage !== 'No recent SRB data') {
                const toastType = isAlert ? ToastMsgType.caution : ToastMsgType.normal;
                ServiceLocator.getUiManager()?.toast(statusMessage, toastType);
            }
        }
    }

    private updateUIInternal_() {
        const statusDiv = document.getElementById('srb-status-message');
        if (statusDiv) {
            statusDiv.innerText = this.lastStatusMessage_;
            statusDiv.style.color = this.lastStatusMessage_.includes('Detected') ? '#ff4444' : '';
        }

        const lastUpdatedDiv = document.getElementById('srb-last-updated');
        if (lastUpdatedDiv) lastUpdatedDiv.innerText = `Last Updated: ${new Date().toLocaleTimeString()}`;
    }
}