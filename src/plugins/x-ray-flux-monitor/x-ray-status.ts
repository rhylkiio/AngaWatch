import { MenuMode, ToastMsgType } from '@app/engine/core/interfaces';
import { ServiceLocator } from '@app/engine/core/service-locator';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { KeepTrackPlugin } from '@app/engine/plugins/base-plugin';
import { html } from '@app/engine/utils/development/formatter';
import { getEl } from '@app/engine/utils/get-el';
import xrayIcon from '@public/img/icons/solar-flare.png';
import { Chart, registerables } from 'chart.js';
import 'chartjs-adapter-date-fns';
import './x-ray-status.css';

Chart.register(...registerables);

export class XRayFluxMonitor extends KeepTrackPlugin {
    readonly id = 'XRayFluxMonitor';
    private lastStatusMessage_ = 'Loading...';
    private chart_: Chart | null = null;

    private intervalId_: ReturnType<typeof setInterval> | null = null;
    private timeUpdateTimeout_: number | null = null;

    private cacheValidStartMs_ = 0;
    private cacheValidEndMs_ = 0;
    private cachedBlackoutStore_: { time: number, msg: string }[] = [];

    // --- Modern KeepTrack Plugin Properties ---
    menuMode: MenuMode[] = [MenuMode.EVENTS, MenuMode.ALL];
    bottomIconElementName = 'xray-flux-monitor-bottom-icon';
    bottomIconLabel = 'X-Ray Flux';
    bottomIconImg = xrayIcon;

    sideMenuElementName = 'xray-flux-monitor-menu';
    sideMenuTitle = 'Solar X-Ray Flux Monitor';
    sideMenuElementHtml: string = html`
    <div id="xray-flux-monitor-menu" class="side-menu-parent start-hidden">
        <div class="side-menu">
            <div class="plot-analysis-chart plot-analysis-menu-maximized">
                <canvas id="xray-flux-chart"></canvas>
            </div>
            <div style="font-size: 0.7em; text-align: center; padding: 10px; color: rgba(255,255,255,0.4);">
                Solar icons by orvipixel - Flaticon
            </div>
        </div>
    </div>`;

    bottomIconCallback = () => {
        if (this.isMenuButtonActive) {
            // Wait 350ms for KeepTrack's CSS menu slide-out animation to finish.
            setTimeout(() => {
                // Use requestIdleCallback so Chart.js only renders when the browser isn't busy
                const renderChartWhenIdle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));

                renderChartWhenIdle(() => {
                    if (!this.chart_) this.initChart();
                    this.refreshForTimeChange_(true);
                });
            }, 350);
        }
        // Notice we no longer destroy the chart when the menu closes.
        // Keeping it in memory makes re-opening the menu blazing fast!
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
                    <div id="xray-event-item" class="menu-item bmenu-item-error" style="cursor: pointer;">
                      <img src="${xrayIcon}" style="width: 25px; vertical-align: middle; margin-right: 8px;">
                      <span class="menu-title">Kenya HF Blackout</span>
                      <div id="hf-status-message" class="menu-value">${this.lastStatusMessage_}</div>
                      <div id="hf-last-updated" class="menu-value" style="font-size: 0.7em; opacity: 0.7;"></div>
                    </div>
                `;
                eventsPanel.insertAdjacentHTML('beforeend', itemHtml);
                this.updateUIInternal_();

                document.getElementById('xray-event-item')?.addEventListener('click', () => {
                    document.getElementById(this.bottomIconElementName)?.click();
                });
            }
        });

        // Event Listeners for Time Slider
        EventBus.getInstance().on(EventBusEvent.updateDateTime, () => this.refreshForTimeChange_());
        EventBus.getInstance().on(EventBusEvent.staticOffsetChange, () => this.refreshForTimeChange_());

        // Background poller
        if (this.intervalId_) clearInterval(this.intervalId_);
        this.intervalId_ = setInterval(() => {
            if (this.isMenuButtonActive) {
                this.refreshForTimeChange_(false, true);
            }
        }, 60000);
    }

    private initChart() {
        const canvas = getEl('xray-flux-chart') as HTMLCanvasElement;
        if (!canvas) return;

        this.chart_ = new Chart(canvas, {
            type: 'line',
            data: {
                datasets: [
                    { label: 'GOES-16 Long', borderColor: 'red', backgroundColor: 'red', data: [], borderWidth: 2, pointRadius: 0, normalized: true, parsing: false },
                    { label: 'GOES-16 Short', borderColor: 'blue', backgroundColor: 'blue', data: [], borderWidth: 2, pointRadius: 0, normalized: true, parsing: false },
                    { label: 'GOES-17 Long', borderColor: 'orange', backgroundColor: 'orange', data: [], borderWidth: 2, pointRadius: 0, normalized: true, parsing: false },
                    { label: 'GOES-17 Short', borderColor: 'purple', backgroundColor: 'purple', data: [], borderWidth: 2, pointRadius: 0, normalized: true, parsing: false }
                ]
            },
            options: {
                animation: false,
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                elements: { point: { radius: 0, hitRadius: 10, hoverRadius: 4 }, line: { tension: 0 } },
                scales: {
                    y: {
                        type: 'logarithmic',
                        min: 1e-9,
                        max: 1e-2,
                        ticks: { color: '#ddd', callback: (value) => Number(value).toExponential() },
                        grid: { color: 'rgba(255,255,255,0.1)' },
                        title: { display: true, text: 'Watts m^-2', color: '#ddd' }
                    },
                    x: { type: 'time', time: { unit: 'hour' }, ticks: { color: '#ddd' }, grid: { color: 'rgba(255,255,255,0.1)' } }
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
            this.updateBlackoutFromCache_(targetTimeMs, showToast);
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
        const INFLUX_X_RAY_BUCKET = process.env.INFLUXDB_X_RAY_BUCKET;
        const INFLUX_ORG = process.env.INFLUXDB_ORG;

        if (!INFLUX_URL || !INFLUX_TOKEN || !INFLUX_X_RAY_BUCKET || !INFLUX_ORG) return;

        const fetchStartMs = targetTimeMs - (12 * 60 * 60 * 1000);
        const fetchEndMs = targetTimeMs + (12 * 60 * 60 * 1000);

        const startIso = new Date(fetchStartMs).toISOString();
        const stopIso = new Date(fetchEndMs).toISOString();

        this.cacheValidStartMs_ = fetchStartMs;
        this.cacheValidEndMs_ = fetchEndMs;

        const fluxQueryBase = `from(bucket: "${INFLUX_X_RAY_BUCKET}") |> range(start: ${startIso}, stop: ${stopIso})`;
        const fluxDataQuery = `${fluxQueryBase} |> filter(fn: (r) => r["_measurement"] == "solar_xray_flux") |> filter(fn: (r) => r["_field"] == "flux") |> aggregateWindow(every: 5m, fn: mean, createEmpty: false)`;
        const blackoutQuery = `${fluxQueryBase} |> filter(fn: (r) => r._measurement == "hf_blackout") |> filter(fn: (r) => r._field == "status_message")`;

        try {
            const queryUrl = `${INFLUX_URL.replace(/\/$/, '')}/api/v2/query?org=${encodeURIComponent(INFLUX_ORG)}`;

            const [fluxRes, blackoutRes] = await Promise.all([
                fetch(queryUrl, { method: 'POST', headers: { 'Authorization': `Token ${INFLUX_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/csv' }, body: JSON.stringify({ query: fluxDataQuery, type: 'flux' }) }),
                fetch(queryUrl, { method: 'POST', headers: { 'Authorization': `Token ${INFLUX_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/csv' }, body: JSON.stringify({ query: blackoutQuery, type: 'flux' }) })
            ]);

            if (fluxRes.ok) this.parseFluxToCache_(await fluxRes.text());
            if (blackoutRes.ok) this.parseBlackoutToCache_(await blackoutRes.text());

            this.updateBlackoutFromCache_(targetTimeMs, showToast);
        } catch (error) {
            console.error('X-Ray Data Fetch Error:', error);
        }
    }

    private parseFluxToCache_(csv: string) {
        if (!this.chart_) return;

        setTimeout(() => {
            const cleanCsv = csv.replace(/\r/g, '');
            const lines = cleanCsv.trim().split('\n');

            const headerLine = lines.find(l => l.includes(',_time,') && l.includes(',_value,'));
            if (!headerLine) return;

            const headers = headerLine.split(',');
            const timeIdx = headers.indexOf('_time');
            const valIdx = headers.indexOf('_value');
            const satIdx = headers.indexOf('satellite');
            const energyIdx = headers.indexOf('energy');

            const store: Record<string, { x: number, y: number }[]> = {
                'GOES16_0.1-0.8nm': [], 'GOES16_0.05-0.4nm': [],
                'GOES17_0.1-0.8nm': [], 'GOES17_0.05-0.4nm': [],
            };

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('#') || line.startsWith(',result') || line === headerLine) continue;

                const p = line.split(',');
                const sat = (p[satIdx] || '').replace(/"/g, '');
                const energy = (p[energyIdx] || '').replace(/"/g, '');
                const key = `${sat}_${energy}`;

                if (store[key]) {
                    const val = parseFloat(p[valIdx] || '0');
                    if (val > 0) store[key].push({ x: new Date(p[timeIdx]).getTime(), y: val });
                }
            }

            this.chart_!.data.datasets[0].data = store['GOES16_0.1-0.8nm'];
            this.chart_!.data.datasets[1].data = store['GOES16_0.05-0.4nm'];
            this.chart_!.data.datasets[2].data = store['GOES17_0.1-0.8nm'];
            this.chart_!.data.datasets[3].data = store['GOES17_0.05-0.4nm'];
            this.chart_!.update('none');
        }, 10);
    }

    private parseBlackoutToCache_(csv: string) {
        this.cachedBlackoutStore_ = [];
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
                this.cachedBlackoutStore_.push({
                    time: new Date(parts[timeIdx]).getTime(),
                    msg: parts[valIdx].replace(/^"(.*)"$/, '$1')
                });
            }
        }

        this.cachedBlackoutStore_.sort((a, b) => a.time - b.time);
    }

    private updateBlackoutFromCache_(targetTimeMs: number, showToast = false) {
        const fifteenMinsAgoMs = targetTimeMs - (15 * 60 * 1000);
        let statusMessage = 'No recent blackout data';

        for (let i = this.cachedBlackoutStore_.length - 1; i >= 0; i--) {
            const entry = this.cachedBlackoutStore_[i];
            if (entry.time <= targetTimeMs && entry.time >= fifteenMinsAgoMs) {
                statusMessage = entry.msg;
                break;
            }
        }

        if (this.lastStatusMessage_ !== statusMessage || showToast) {
            this.lastStatusMessage_ = statusMessage;
            this.updateUIInternal_();

            if (showToast && statusMessage !== 'No recent blackout data') {
                let toastType = ToastMsgType.normal;
                if (statusMessage.toLowerCase().includes('flare') || statusMessage.toLowerCase().includes('blackout')) {
                    toastType = ToastMsgType.caution;
                }
                ServiceLocator.getUiManager()?.toast(statusMessage, toastType);
            }
        }
    }

    private updateUIInternal_() {
        const statusDiv = document.getElementById('hf-status-message');
        if (statusDiv) statusDiv.innerText = this.lastStatusMessage_;

        const lastUpdatedDiv = document.getElementById('hf-last-updated');
        if (lastUpdatedDiv) lastUpdatedDiv.innerText = `Last Updated: ${new Date().toLocaleTimeString()}`;
    }
}