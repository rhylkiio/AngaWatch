/**
 * DIRA (Dynamic Integrated Resources for Astrodynamics)
 * Copyright (C) 2025 rhylkiio (AngaWatch)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * Based on KeepTrack™ (https://github.com/thkruz/keeptrack.space)
 * Copyright (C) 2025 Kruczek Labs LLC
 */
import { SatMath } from '@app/app/analysis/sat-math';
import { DetailedSensor } from '@app/app/sensors/DetailedSensor';
import { ServiceLocator } from '@app/engine/core/service-locator';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { KeepTrackPlugin } from '@app/engine/plugins/base-plugin';
import { KeyboardComponent } from '@app/engine/plugins/components/keyboard/keyboard-component';
import { html } from '@app/engine/utils/development/formatter';
import { getEl } from '@app/engine/utils/get-el';
import { settingsManager } from '@app/settings/settings';
import { WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { Degrees, Kilometers, Satellite, SpaceObjectType, ZoomValue } from '@ootk/src/main';

type PassSearchCommand = {
    action: 'pass_search';
    location: string;
    timeframe?: string;
    satellite?: string;
    type?: string;
    status?: string;
    maxResults?: number;
    elevationKm?: number;
};

type PassWindow = {
    startMs: number;
    endMs: number;
    label: string;
};

type PassResultRow = {
    sat: Satellite;
    riseTimeMs: number;
    setTimeMs: number;
    peakTimeMs: number;
    peakElevation: number;
    minRangeKm: number;
};

export class AiCommandPalettePlugin extends KeepTrackPlugin {
    readonly id = 'AiCommandPalettePlugin';
    dependencies_ = ['TopMenu'];

    private aiWorker: Worker | null = null;
    private engine: WebWorkerMLCEngine | null = null;
    private readonly SELECTED_MODEL = 'Phi-3.5-mini-instruct-q4f16_1-MLC';
    private isKeyboardSetup = false;
    private isModalOpen = false;
    private isAiEnabled = false;
    private isAiLoading = false;

    addHtml(): void {
        super.addHtml();

        EventBus.getInstance().on(EventBusEvent.uiManagerFinal, () => {
            const uiWrapper = getEl('ui-wrapper');

            const paletteHtml = html`
        <style>
          #ai-palette-modal {
            transition: box-shadow 0.3s ease;
          }
          #ai-palette-close {
            margin-left: 15px;
            color: #666;
            font-size: 1.8rem;
            line-height: 0.5;
            cursor: pointer;
            transition: color 0.2s ease;
          }
          #ai-palette-close:hover {
            color: #f44336; /* Matches the KeepTrack destructive/red theme */
          }

          #ai-palette-modal.ai-active {
            border-color: transparent !important;
            box-shadow: 0 10px 40px rgba(255, 0, 0, 0.15);
          }

          #ai-palette-modal.ai-active::before {
            content: '';
            position: absolute;
            top: -50%; left: -50%;
            width: 200%; height: 200%;
            background: conic-gradient(from 0deg, transparent 70%, #ff0000 90%, transparent 100%);
            animation: spin-light 3s linear infinite;
            z-index: 0;
          }

          #ai-palette-modal.ai-active::after {
            content: '';
            position: absolute;
            inset: 2px;
            background: var(--color-dark-ui-bg, #1e1e1e);
            border-radius: 7px;
            z-index: 1;
          }

          @keyframes spin-light {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>

        <div id="ai-palette-modal" style="display: none; position: fixed; top: 15%; left: 50%; transform: translateX(-50%); width: 600px; max-width: 90vw; background: var(--color-dark-ui-bg, #1e1e1e); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 9999; border: 1px solid #333; flex-direction: column; overflow: hidden;">

          <div id="ai-palette-header" style="position: relative; z-index: 2; display: flex; align-items: center; padding: 15px; border-bottom: 1px solid #333; cursor: move; user-select: none;">
            <input id="ai-palette-input" type="text" placeholder="Search satellites or type a command..." autocomplete="off" style="flex-grow: 1; width: 100%; border: none; background: transparent; color: #fff; font-size: 1.2rem; outline: none; margin: 0; border-bottom: none; box-shadow: none;" />

            <div class="switch" style="margin-left: 15px;">
              <label style="color: #aaa; font-size: 0.9rem;">
                AI
                <input id="ai-palette-toggle" type="checkbox" />
                <span class="lever"></span>
              </label>
            </div>

            <div id="ai-palette-close" title="Close Palette">&times;</div>
          </div>

          <div id="ai-palette-results" style="position: relative; z-index: 2; max-height: 400px; overflow-y: auto; padding: 10px;">
          </div>

        </div>
      `;

            uiWrapper?.insertAdjacentHTML('beforeend', paletteHtml);
        });
    }

    addJs(): void {
        super.addJs();

        EventBus.getInstance().on(EventBusEvent.uiManagerFinal, () => {
            this.setupSearchHijack();
            this.setupKeyboardShortcuts();
            this.setupPaletteListeners();
            this.setupDraggable();
        });
    }

    private setupDraggable(): void {
        const modal = getEl('ai-palette-modal');
        const header = getEl('ai-palette-header');

        if (!modal || !header) return;

        let isDragging = false;
        let startX = 0;
        let startY = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target instanceof HTMLInputElement || (e.target as HTMLElement).closest('.switch')) return;

            isDragging = true;
            const rect = modal.getBoundingClientRect();

            modal.style.left = `${rect.left}px`;
            modal.style.top = `${rect.top}px`;
            modal.style.transform = 'none';
            modal.style.margin = '0';

            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            modal.style.left = `${e.clientX - startX}px`;
            modal.style.top = `${e.clientY - startY}px`;
        });

        window.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    private setupSearchHijack(): void {
        const trigger = getEl('drawer-search-trigger');

        if (trigger) {
            const label = trigger.querySelector('.drawer-search-label');
            if (label) {
                label.textContent = 'AI Search…';
            }

            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                this.openPalette();
            });
        }
    }

    private setupKeyboardShortcuts(): void {
        if (this.isKeyboardSetup) return;
        this.isKeyboardSetup = true;

        const keyboard = new KeyboardComponent(this.id, [
            {
                key: 'K',
                ctrl: true,
                shift: true,
                callback: () => {
                    this.togglePalette();
                },
            },
            {
                key: 'Escape',
                ctrl: false,
                callback: () => {
                    if (this.isModalOpen) this.closePalette();
                }
            }
        ]);
        keyboard.init();
    }

    private togglePalette(): void {
        if (this.isModalOpen) {
            this.closePalette();
        } else {
            this.openPalette();
        }
    }

    private setupPaletteListeners(): void {
        const modal = getEl('ai-palette-modal');
        const input = getEl('ai-palette-input') as HTMLInputElement;
        const toggle = getEl('ai-palette-toggle') as HTMLInputElement;
        const closeBtn = getEl('ai-palette-close'); // 1. Grab the new button

        // 2. Handle the click to close the UI
        closeBtn?.addEventListener('click', () => {
            this.closePalette();
        });
        toggle?.addEventListener('change', (e) => {
            this.isAiEnabled = (e.target as HTMLInputElement).checked;

            if (this.isAiEnabled) {
                modal?.classList.add('ai-active');
                this.initializeWebLLM();
            } else {
                modal?.classList.remove('ai-active');
            }
        });

        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = input.value.trim();
                if (!query) return;

                if (this.isAiEnabled) {
                    this.processAiCommand(query);
                } else {
                    this.processStandardSearch(query);
                }
            }
        });
    }

    private openPalette(): void {
        this.isModalOpen = true;
        const modal = getEl('ai-palette-modal');
        const input = getEl('ai-palette-input') as HTMLInputElement;

        if (modal && input) {
            modal.style.display = 'flex';
            input.focus();
        }
    }

    private closePalette(): void {
        this.isModalOpen = false;
        const modal = getEl('ai-palette-modal');

        if (modal) {
            modal.style.display = 'none';
        }
    }

    private processStandardSearch(query: string): void {
        this.closePalette();
        const searchManager = ServiceLocator.getUiManager().searchManager;
        searchManager.openSearch(true);
        searchManager.doSearch(query);
    }

    private async initializeWebLLM(): Promise<void> {
        if (this.isAiLoading || this.engine) return;
        this.isAiLoading = true;

        const resultsArea = getEl('ai-palette-results');
        if (resultsArea) {
            resultsArea.innerHTML = `<div style="color: #00bcd4; padding: 10px;">Initializing Dira AI (first run requires a ~2.4GB download)...</div>`;
        }

        try {
            this.aiWorker = new Worker('/js/ai-palette-worker.js', { type: 'module' });
            this.engine = new WebWorkerMLCEngine(this.aiWorker);

            this.engine.setInitProgressCallback((progress) => {
                if (resultsArea) {
                    resultsArea.innerHTML = `<div style="color: #aaa; padding: 10px;">${progress.text}</div>`;
                }
            });

            await this.engine.reload(this.SELECTED_MODEL);

            if (resultsArea) {
                resultsArea.innerHTML = `<div style="color: #8bc34a; padding: 10px;">Dira AI Ready! Type a command above.</div>`;
            }
        } catch (error) {
            this.engine = null;
            if (resultsArea) {
                resultsArea.innerHTML = `<div style="color: #f44336; padding: 10px;">Dira AI failed: ${error}</div>`;
            }
        } finally {
            this.isAiLoading = false;
        }
    }

    private async processAiCommand(prompt: string): Promise<void> {
  const resultsArea = getEl('ai-palette-results');
  if (!this.engine) {
    if (resultsArea) {
      resultsArea.innerHTML = `<div style="color: #ff9800; padding: 10px;">⚠️ Dira AI is still loading. Please wait a moment!</div>`;
    }
    return;
  }

  if (resultsArea) {
    resultsArea.innerHTML = `<div style="color: #aaa; padding: 10px;">Thinking: "${prompt}"...</div>`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const systemPrompt = `You are Dira's AI assistant for the KeepTrack astrodynamics platform.
You MUST respond with ONLY a valid raw JSON object. Do not include markdown formatting or conversational text.

Allowed actions:
- find
- filter
- toggle_layer
- reset_all
- pass_search

For pass-over-location requests, ALWAYS use "pass_search".

Use only these keys:
"commands", "action", "target", "country", "type", "status", "orbit", "size", "location", "layer", "state", "timeframe", "satellite", "maxResults"

Examples:
User: "Find the ISS"
{"commands":[{"action":"find","target":"ISS"}]}

User: "Show me active American payloads"
{"commands":[{"action":"filter","country":"United States","type":"payload","status":"active","orbit":"none","size":"none","location":"none"}]}

User: "Turn off clouds"
{"commands":[{"action":"toggle_layer","layer":"clouds","state":false}]}

User: "Show me satellites that will pass Kitengela tomorrow"
{"commands":[{"action":"pass_search","location":"Kitengela","timeframe":"tomorrow","satellite":"none","type":"payload","status":"active","maxResults":20}]}`;

  try {
    const response = await this.engine.chat.completions.create({
      model: this.SELECTED_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 180,
    });

    clearTimeout(timeout);

    const rawJson = response.choices[0].message.content;
    if (rawJson) {
      await this.executeAiCommands(rawJson);
    }
  } catch (error: any) {
    clearTimeout(timeout);
    if (resultsArea) {
      const isTimeout = error?.name === 'AbortError';
      resultsArea.innerHTML = `<div style="color: #f44336; padding: 10px;">
        ${isTimeout ? '⏱️ Dira AI timed out.' : `AI Error: ${error}`}
      </div>`;
    }
  }
}

    private parsePassWindow_(timeframe?: string): PassWindow {
  const now = new Date();
  const normalized = (timeframe ?? 'next 24 hours').toLowerCase().trim();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (normalized.includes('tomorrow')) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + 1);
    return { startMs: start.getTime(), endMs: start.getTime() + oneDayMs, label: 'tomorrow' };
  }

  if (normalized.includes('today')) {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { startMs: now.getTime(), endMs: end.getTime(), label: 'today' };
  }

  const nextMatch = normalized.match(/next\s*(\d+)\s*(h|hr|hour|hours|d|day|days)/u);
  if (nextMatch) {
    const count = parseInt(nextMatch[1], 10);
    const unit = nextMatch[2];
    const durationMs = unit.startsWith('d') ? count * oneDayMs : count * 60 * 60 * 1000;
    return {
      startMs: now.getTime(),
      endMs: now.getTime() + durationMs,
      label: `next ${count} ${unit.startsWith('d') ? 'day(s)' : 'hour(s)'}`,
    };
  }

  return { startMs: now.getTime(), endMs: now.getTime() + oneDayMs, label: 'next 24 hours' };
}

private async geocodeLocation_(location: string): Promise<{ label: string; lat: number; lon: number } | null> {
  const q = location.trim();
  if (!q) return null;

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);

  const data = await res.json() as {
    results?: Array<{
      name: string;
      admin1?: string;
      country?: string;
      latitude: number;
      longitude: number;
    }>;
  };

  const best = data.results?.[0];
  if (!best) return null;

  const label = [best.name, best.admin1, best.country].filter(Boolean).join(', ');
  return { label, lat: best.latitude, lon: best.longitude };
}

private toDegrees_(value: number): Degrees {
  return value as Degrees;
}

private toKilometers_(value: number): Kilometers {
  return value as Kilometers;
}

private sanitizeElevationKm_(elevationKm?: number): Kilometers {
  if (typeof elevationKm !== 'number' || !Number.isFinite(elevationKm)) {
    return this.toKilometers_(0);
  }

  const nonNegative = Math.max(0, elevationKm);
  const normalizedKm = nonNegative > 20 ? nonNegative / 1000 : nonNegative;

  return this.toKilometers_(Math.min(normalizedKm, 10));
}

private async runWithoutToasts_<T>(work: () => Promise<T> | T): Promise<T> {
  const previous = settingsManager.isDisableToasts;
  settingsManager.isDisableToasts = true;

  try {
    return await work();
  } finally {
    settingsManager.isDisableToasts = previous;
  }
}

private createPassSearchSensor_(locationLabel: string, lat: number, lon: number, elevationKm?: number): DetailedSensor {
  return new DetailedSensor({
    lat: this.toDegrees_(lat),
    lon: this.toDegrees_(lon),
    alt: this.sanitizeElevationKm_(elevationKm),
    minAz: this.toDegrees_(0),
    maxAz: this.toDegrees_(360),
    minEl: this.toDegrees_(10),
    maxEl: this.toDegrees_(90),
    minRng: this.toKilometers_(0),
    maxRng: this.toKilometers_(1000000),
    type: SpaceObjectType.OPTICAL,
    name: 'Custom Sensor',
    uiName: `AI Sensor (${locationLabel})`,
    system: 'AI Pass Search',
    country: 'Custom Sensor',
    objName: `AI-Sensor-${Date.now()}`,
    operator: 'Dira AI',
    zoom: ZoomValue.LEO,
    volume: false,
  });
}

private satelliteMatchesPassFilters_(sat: Satellite, cmd: PassSearchCommand): boolean {
  const reqType = cmd.type && cmd.type !== 'none' ? cmd.type.toLowerCase() : null;
  const reqStatus = cmd.status && cmd.status !== 'none' ? cmd.status.toLowerCase() : null;

  if (reqType) {
    if (reqType.includes('payload') && sat.type !== SpaceObjectType.PAYLOAD) return false;
    if (reqType.includes('debris') && sat.type !== SpaceObjectType.DEBRIS) return false;
    if (reqType.includes('rocket') && sat.type !== SpaceObjectType.ROCKET_BODY) return false;
  }

  if (reqStatus === 'active' && !sat.active) return false;
  if (reqStatus === 'inactive' && sat.active) return false;

  return true;
}

private resolvePassSearchCandidates_(cmd: PassSearchCommand): Satellite[] {
  const catalogManager = ServiceLocator.getCatalogManager();
  const satQuery = (cmd.satellite ?? '').trim();

  let candidates: Satellite[];
  if (satQuery && satQuery.toLowerCase() !== 'none') {
    const normalized = satQuery.toUpperCase();
    const noradMatch = normalized.match(/\b\d{5,6}\b/u);
    const norad = noradMatch ? noradMatch[0].slice(-5) : null;

    candidates = catalogManager
      .getSats()
      .filter((sat) => sat.active)
      .filter((sat) => {
        if (norad && sat.sccNum === norad) return true;
        return sat.name.toUpperCase().includes(normalized) || sat.sccNum === normalized;
      });
  } else {
    candidates = catalogManager.getActiveSats();
  }

  return candidates
    .filter((sat) => this.satelliteMatchesPassFilters_(sat, cmd))
    .slice(0, 1200);
}

private findPassesForSatellite_(
  sat: Satellite,
  sensor: DetailedSensor,
  startMs: number,
  endMs: number,
): PassResultRow[] {
  const catalogManager = ServiceLocator.getCatalogManager();
  if (!sat.satrec) catalogManager.calcSatrec(sat);
  if (!sat.satrec) return [];

  const stepMs = 20 * 1000;
  const rows: PassResultRow[] = [];

  let inView = false;
  let rise = 0;
  let peak = 0;
  let peakEl = -999;
  let minRange = Number.POSITIVE_INFINITY;

  for (let t = startMs; t <= endMs; t += stepMs) {
    const now = new Date(t);
    const aer = SatMath.getRae(now, sat.satrec, sensor);
    const isInView = SatMath.checkIsInView(sensor, aer);

    if (isInView && !inView) {
      rise = t;
      peak = t;
      peakEl = aer.el ?? -999;
      minRange = aer.rng ?? Number.POSITIVE_INFINITY;
    }

    if (isInView) {
      if (typeof aer.el === 'number' && aer.el > peakEl) {
        peakEl = aer.el;
        peak = t;
      }
      if (typeof aer.rng === 'number' && aer.rng < minRange) {
        minRange = aer.rng;
      }
    }

    if (!isInView && inView) {
      rows.push({
        sat,
        riseTimeMs: rise,
        setTimeMs: t,
        peakTimeMs: peak,
        peakElevation: peakEl,
        minRangeKm: minRange,
      });
    }

    inView = isInView;
  }

  if (inView) {
    rows.push({
      sat,
      riseTimeMs: rise,
      setTimeMs: endMs,
      peakTimeMs: peak,
      peakElevation: peakEl,
      minRangeKm: minRange,
    });
  }

  return rows;
}

private formatUtc_(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

private renderPassSearchResults_(
  resultsArea: HTMLElement,
  rows: PassResultRow[],
  locationLabel: string,
  windowLabel: string,
): void {
  if (rows.length === 0) {
    resultsArea.innerHTML = `<div style="color:#f44336; padding:8px;">❌ No upcoming passes found for <b>${locationLabel}</b> (${windowLabel}).</div>`;
    return;
  }

  const body = rows.map((r, idx) => `
    <tr data-pass-row="${idx}" data-scc="${r.sat.sccNum}" data-rise="${r.riseTimeMs}" style="cursor:pointer;">
      <td>${r.sat.sccNum}</td>
      <td>${r.sat.name}</td>
      <td>${this.formatUtc_(r.riseTimeMs)}</td>
      <td>${this.formatUtc_(r.peakTimeMs)}</td>
      <td>${this.formatUtc_(r.setTimeMs)}</td>
      <td>${Math.max(0, r.peakElevation).toFixed(1)}°</td>
      <td>${Number.isFinite(r.minRangeKm) ? r.minRangeKm.toFixed(0) : 'N/A'} km</td>
    </tr>
  `).join('');

  resultsArea.innerHTML = `
    <div style="color:#8bc34a; padding:6px 0 10px 0;">
      ✅ Found <b>${rows.length}</b> pass(es) for <b>${locationLabel}</b> (${windowLabel}).
    </div>
    <div style="max-height:320px; overflow-y:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr>
            <th style="text-align:left;">NORAD</th>
            <th style="text-align:left;">Satellite</th>
            <th style="text-align:left;">Rise</th>
            <th style="text-align:left;">Peak</th>
            <th style="text-align:left;">Set</th>
            <th style="text-align:left;">Max El</th>
            <th style="text-align:left;">Min Rng</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div style="color:#aaa; padding-top:8px;">Tip: click a row to jump to that pass and focus the satellite.</div>
  `;

  resultsArea.querySelectorAll('tr[data-pass-row]').forEach((rowEl) => {
    rowEl.addEventListener('click', () => {
      const scc = (rowEl as HTMLElement).dataset.scc;
      const rise = Number((rowEl as HTMLElement).dataset.rise);
      if (!scc || Number.isNaN(rise)) return;

      const searchManager = ServiceLocator.getUiManager().searchManager;
      const timeManager = ServiceLocator.getTimeManager();

      void this.runWithoutToasts_(async () => {
        searchManager.doSearch(scc, true);
        timeManager.changeStaticOffset(rise - timeManager.realTime);
      });
    });
  });
}

private async executePassSearch_(cmd: PassSearchCommand, resultsArea: HTMLElement | null): Promise<void> {
  if (!resultsArea) return;

  if (!cmd.location || cmd.location.toLowerCase() === 'none') {
    resultsArea.innerHTML = '<div style="color:#f44336; padding:8px;">❌ Please provide a location.</div>';
    return;
  }

  resultsArea.innerHTML = `<div style="color:#aaa; padding:8px;">Resolving location: <b>${cmd.location}</b>...</div>`;
  const geocoded = await this.geocodeLocation_(cmd.location);

  if (!geocoded) {
    resultsArea.innerHTML = `<div style="color:#f44336; padding:8px;">❌ Could not geocode: <b>${cmd.location}</b>.</div>`;
    return;
  }

  await this.runWithoutToasts_(async () => {
    const window = this.parsePassWindow_(cmd.timeframe);
    const sensor = this.createPassSearchSensor_(geocoded.label, geocoded.lat, geocoded.lon, cmd.elevationKm);

    ServiceLocator.getSensorManager().addSecondarySensor(sensor, true);

    const candidates = this.resolvePassSearchCandidates_(cmd);
    const maxResults = Math.max(1, Math.min(50, Number(cmd.maxResults) || 20));
    const results: PassResultRow[] = [];

    resultsArea.innerHTML = `<div style="color:#aaa; padding:8px;">Searching passes over <b>${geocoded.label}</b> (${window.label})...</div>`;

    for (const sat of candidates) {
      const rows = this.findPassesForSatellite_(sat, sensor, window.startMs, window.endMs);
      if (rows.length > 0) results.push(rows[0]);
    }

    results.sort((a, b) => a.riseTimeMs - b.riseTimeMs);
    this.renderPassSearchResults_(resultsArea, results.slice(0, maxResults), geocoded.label, window.label);
  });
}

    private async executeAiCommands(jsonString: string): Promise<void> {
  const resultsArea = getEl('ai-palette-results');

  try {
    let cleaned = jsonString;
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');

    if (startIdx !== -1 && endIdx !== -1) {
      cleaned = cleaned.substring(startIdx, endIdx + 1);
    } else {
      throw new Error('No JSON object found in response');
    }

    const parsedJson = JSON.parse(cleaned);
    let commands: any[] = [];

    if (parsedJson.commands && Array.isArray(parsedJson.commands)) {
      commands = parsedJson.commands;
    } else if (Array.isArray(parsedJson)) {
      commands = parsedJson;
    } else if (parsedJson.action) {
      commands = [parsedJson];
    } else {
      throw new Error('Could not understand JSON structure.');
    }

    if (resultsArea) resultsArea.innerHTML = '';

    for (const cmd of commands) {
      if (cmd.action === 'find') {
        // keep your existing find block unchanged
      } else if (cmd.action === 'toggle_layer') {
        // keep your existing toggle_layer block unchanged
      } else if (cmd.action === 'reset_all') {
        // keep your existing reset_all block unchanged
      } else if (cmd.action === 'filter') {
        // keep your existing filter block unchanged
      } else if (cmd.action === 'pass_search') {
        await this.executePassSearch_(cmd as PassSearchCommand, resultsArea);
      }
    }

    const input = getEl('ai-palette-input') as HTMLInputElement;
    if (input) input.value = '';
  } catch {
    if (resultsArea) {
      resultsArea.innerHTML = `<div style="color: #f44336; padding: 10px;">Failed to parse AI response. Try rephrasing your command.</div>`;
    }
  }
}
}