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
import { countryCodeList } from '@app/app/data/catalogs/countries';
import { PluginRegistry } from '@app/engine/core/plugin-registry';
import { ServiceLocator } from '@app/engine/core/service-locator';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { KeepTrackPlugin } from '@app/engine/plugins/base-plugin';
import { KeyboardComponent } from '@app/engine/plugins/components/keyboard/keyboard-component';
import { html } from '@app/engine/utils/development/formatter';
import { getEl } from '@app/engine/utils/get-el';
import { settingsManager } from '@app/settings/settings';
import { WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { calcGmst, eci2lla, RAD2DEG, Satellite, SpaceObjectType } from '@ootk/src/main';
import { CloudsToggle } from '../clouds-toggle/clouds-toggle';
import { GraticuleToggle } from '../graticule-toggle/graticule-toggle';
import { NightToggle } from '../night-toggle/night-toggle';
import { CameraType } from '@app/engine/camera/camera-type';
import { PoliticalMapToggle } from '../political-map-toggle/political-map-toggle';
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



    // Geographic bounding boxes for highly accurate airspace filtering
    private readonly AIRSPACE_BOUNDS: Record<string, { minLat: number, maxLat: number, minLon: number, maxLon: number }> = {
        // East Africa (Kenya, Tanzania, Uganda, Rwanda, Burundi)
        "east-africa": { minLat: -11.0, maxLat: 5.0, minLon: 29.0, maxLon: 42.0 },

        // Continents
        // Replace your africa box with this wider one to catch more satellites
        "africa": { minLat: -35.0, maxLat: 38.0, minLon: -20.0, maxLon: 55.0 },
        "north-america": { minLat: 15.0, maxLat: 72.0, minLon: -170.0, maxLon: -52.0 },
        "south-america": { minLat: -56.0, maxLat: 13.0, minLon: -82.0, maxLon: -34.0 },
        "europe": { minLat: 34.0, maxLat: 72.0, minLon: -10.0, maxLon: 45.0 },
        "asia": { minLat: -10.0, maxLat: 78.0, minLon: 60.0, maxLon: 180.0 },
        "australia": { minLat: -45.0, maxLat: -10.0, minLon: 110.0, maxLon: 155.0 }
    };

    /**
     * Converts natural language ("Italian", "USA") into KeepTrack catalog codes ("IT", "US")
     */
    /**
     * Converts natural language ("Italian", "USA", "American") into KeepTrack catalog codes ("IT", "US")
     */
    private getCountryCode(searchName: string): string {
        if (!searchName || searchName === 'none') return '';
        const searchUpper = searchName.toUpperCase().trim();

        // 1. Quick fallbacks for common adjectives the AI might use
        if (searchUpper === 'USA' || searchUpper === 'AMERICAN' || searchUpper === 'UNITED STATES') return 'US';
        if (searchUpper === 'UK' || searchUpper === 'BRITISH') return 'UK';
        if (searchUpper === 'CHINA' || searchUpper === 'CHINESE') return 'PRC';
        if (searchUpper === 'RUSSIA' || searchUpper === 'RUSSIAN') return 'RU';

        // 2. Search KeepTrack's native countryCodeList mapping
        // 2. Search KeepTrack's native countryCodeList mapping
        for (const [countryName, codes] of Object.entries(countryCodeList)) {
            if (countryName.toUpperCase() === searchUpper) {
                return codes;
            }

            const splitCodes = codes.toUpperCase().split('|');
            if (splitCodes.includes(searchUpper)) {
                return codes; // <-- CHANGE THIS: Return the whole 'I|IT' string
            }
        }
        return '';
    }

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

        // Because we removed the grammar enforcer, this English prompt is now the
        // ONLY thing controlling the AI. Add new features just by typing them here!
        const systemPrompt = `You are Dira's AI assistant for the KeepTrack astrodynamics platform.
                You MUST respond with ONLY a valid raw JSON object. Do not include markdown formatting or conversational text.
                For 'find' actions, the 'target' property MUST be ONLY the satellite name or the raw 5-digit NORAD ID. Do not include labels like 'ID' or 'NORAD'

                CRITICAL: ONLY USE THESE EXACT JSON KEYS: "action", "country", "type", "status", "orbit", "size", "location". Do not invent new keys.
                For "country", ALWAYS output the official country NOUN (e.g., "China", not "Chinese").

                ALWAYS prioritize the 'filter' action for any request involving attributes (country, status, type, orbit, size, location).
                ONLY use 'find' when searching for a specific, single object name (e.g., 'Find ISS').

                CRITICAL: If a user asks for multiple satellites (e.g., 'all Italian satellites'), use the 'filter' action.

                Valid Filter Values:
                - type: 'debris', 'rocket', 'payload', 'none'
                - status: 'active', 'inactive', 'none'
                - orbit: 'LEO', 'MEO', 'GEO', 'HEO', 'none'
                - size: 'small', 'medium', 'large', 'none'

                EXAMPLES:

                User: "Find all the small chinese debris in LEO"
                {"commands": [{"action": "filter", "country": "China", "type": "debris", "status": "none", "orbit": "LEO", "size": "small", "location": "none"}]}

                User: "Show me active American payloads"
                {"commands": [{"action": "filter", "country": "United States", "type": "payload", "status": "active", "orbit": "none", "size": "none", "location": "none"}]}

                User: "Turn off the clouds"
                {"commands": [{"action": "toggle_layer", "layer": "clouds", "state": false}]}

                User: "Find the ISS"
                {"commands": [{"action": "find", "target": "ISS"}]}`;
        try {
            const response = await this.engine.chat.completions.create({
                model: this.SELECTED_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                // WE DELETED response_format ENTIRELY!
                temperature: 0.1, // Keep it low so the AI stays analytical and doesn't get creative
                max_tokens: 150,
            });

            clearTimeout(timeout);

            const rawJson = response.choices[0].message.content;
            if (rawJson) {
                this.executeAiCommands(rawJson);
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

    private executeAiCommands(jsonString: string): void {
        const resultsArea = getEl('ai-palette-results');

        console.log("🤖 Raw AI Output:", jsonString);

        try {
            let cleaned = jsonString;

            // 1. The Bulletproof JSON Extractor
            const startIdx = cleaned.indexOf('{');
            const endIdx = cleaned.lastIndexOf('}');

            if (startIdx !== -1 && endIdx !== -1) {
                cleaned = cleaned.substring(startIdx, endIdx + 1);
            } else {
                throw new Error("No JSON object found in response");
            }

            // 2. The Flexible JSON Parser
            const parsedJson = JSON.parse(cleaned);
            let commands: any[] = [];

            // Did the AI follow instructions and use the commands array?
            if (parsedJson.commands && Array.isArray(parsedJson.commands)) {
                commands = parsedJson.commands;
            }
            // Did the AI just return a raw array? [ {action...} ]
            else if (Array.isArray(parsedJson)) {
                commands = parsedJson;
            }
            // Did the AI just return a single bare object? { action... }
            else if (parsedJson.action) {
                commands = [parsedJson]; // Wrap it in an array for them!
            } else {
                throw new Error("Could not understand the JSON structure.");
            }

            if (resultsArea) resultsArea.innerHTML = '';

            commands.forEach((cmd: any) => {

                // --- FIND COMMAND ---
                if (cmd.action === 'find') {
                    const searchManager = ServiceLocator.getUiManager().searchManager;

                    // 1. Clean the target: remove non-numeric labels, whitespace, etc.
                    // This handles "NORAD ID 25544", "25544", or "The ISS (25544)"
                    const rawTarget = String(cmd.target);
                    const cleanTarget = rawTarget.replace(/NORAD|ID|target|the|\(|\)/gi, '').trim();

                    // 2. Perform the search with the cleaned string
                    searchManager.doSearch(cleanTarget, true);

                    // 3. Small delay to allow the searchManager to process the async search
                    setTimeout(() => {
                        const resultsCount = settingsManager.lastSearchResults?.length || 0;

                        if (resultsArea) {
                            if (resultsCount > 0) {
                                resultsArea.innerHTML += `<div style="color: #8bc34a; padding: 5px;">Found and focused: <b>${cleanTarget}</b></div>`;
                            } else {
                                resultsArea.innerHTML += `<div style="color: #f44336; padding: 5px;">Could not find: <b>${cleanTarget}</b></div>`;
                            }
                        }
                    }, 500);
                }

                // --- TOGGLE LAYER COMMAND ---
                else if (cmd.action === 'toggle_layer') {
                    const layerMap: Record<string, any> = {
                        'political_map': PoliticalMapToggle,
                        'clouds': CloudsToggle,
                        'grid': GraticuleToggle,
                        'night': NightToggle
                    };

                    const PluginClass = layerMap[cmd.layer];

                    if (PluginClass) {
                        const plugin = PluginRegistry.getPlugin(PluginClass) as any;

                        if (plugin) {
                            if (typeof plugin.onBottomIconClick === 'function') {
                                plugin.onBottomIconClick();
                            } else if (typeof plugin.bottomMenuClicked === 'function') {
                                plugin.bottomMenuClicked();
                            }

                            if (resultsArea) {
                                const stateText = cmd.state ? 'Enabled' : 'Disabled';
                                resultsArea.innerHTML += `<div style="color: #8bc34a; padding: 5px;">👁️ ${stateText} layer: <b>${cmd.layer}</b></div>`;
                            }
                        } else {
                            if (resultsArea) {
                                resultsArea.innerHTML += `<div style="color: #ff9800; padding: 5px;">⚠️ The '${cmd.layer}' layer is not currently loaded.</div>`;
                            }
                        }
                    }
                }
                // --- RESET ALL COMMAND ---
                else if (cmd.action === 'reset_all') {
                    const catalogManager = ServiceLocator.getCatalogManager();
                    const uiManager = ServiceLocator.getUiManager();
                    const searchManager = uiManager.searchManager;
                    const camera = ServiceLocator.getMainCamera();
                    const orbitManager = ServiceLocator.getOrbitManager();

                    // 1. Clear search and reset view
                    searchManager.doSearch("", true);

                    // 2. Clear orbits - This fixes the "value is never read" error!
                    orbitManager.clearInViewOrbit();
                    orbitManager.clearHoverOrbit();

                    // 3. Reset Camera
                    camera.cameraType = CameraType.FIXED_TO_EARTH;
                    camera.state.isPanReset = true;
                    camera.state.isLocalRotateReset = true;
                    camera.state.zoomTarget = 0.5;

                    // 4. Clear transient catalog state
                    catalogManager.initObjects();

                    // 5. Force a UI refresh
                    EventBus.getInstance().emit(EventBusEvent.uiManagerFinal);

                    if (resultsArea) {
                        resultsArea.innerHTML = `<div style="color: #4caf50; padding: 5px;">🔄 <b>System Reset:</b> View restored and catalog cleared.</div>`;
                    }
                }

                else if (cmd.action === 'filter') {
                    const catalogManager = ServiceLocator.getCatalogManager();
                    const timeManager = ServiceLocator.getTimeManager();
                    const searchManager = ServiceLocator.getUiManager().searchManager;

                    let matches: Satellite[] = catalogManager.getSats();

                    // Pre-compute
                    const reqType = cmd.type !== 'none' ? cmd.type?.toLowerCase() : null;
                    const reqStatus = cmd.status !== 'none' ? cmd.status?.toLowerCase() : null;
                    const reqOrbit = cmd.orbit !== 'none' ? cmd.orbit?.toUpperCase() : null;
                    const reqSize = cmd.size !== 'none' ? cmd.size?.toLowerCase() : null; // Now this is read!

                    let targetCountryCode: string | null = null;
                    if (cmd.country && cmd.country !== 'none') {
                        targetCountryCode = this.getCountryCode(cmd.country);
                    }

                    interface AirspaceZone { minLat: number; maxLat: number; minLon: number; maxLon: number; }
                    const targetZone: AirspaceZone | null = (cmd.location && cmd.location !== 'none')
                        ? (this.AIRSPACE_BOUNDS[cmd.location.toLowerCase()] || null)
                        : null;

                    const now = timeManager.simulationTimeObj;
                    const { gmst } = calcGmst(now);

                    matches = matches.filter((sat: Satellite) => {
                        // 1. Type check
                        if (reqType) {
                            if (reqType.includes('debris') && sat.type !== SpaceObjectType.DEBRIS) return false;
                            if (reqType.includes('rocket') && sat.type !== SpaceObjectType.ROCKET_BODY) return false;
                            if (reqType.includes('payload') && sat.type !== SpaceObjectType.PAYLOAD) return false;
                        }

                        // 2. Country check
                        if (targetCountryCode && !targetCountryCode.split('|').includes(sat.country)) return false;

                        // 3. Status check
                        if (reqStatus) {
                            const isDebris = sat.type === SpaceObjectType.DEBRIS || sat.type === SpaceObjectType.ROCKET_BODY;
                            const statusStr = sat.status ? String(sat.status).toUpperCase().trim() : '';
                            const isExplicitlyAlive = ['+', 'P', 'B', 'S', 'X'].includes(statusStr) || statusStr.includes('OP');
                            if (reqStatus === 'active' && (isDebris || !isExplicitlyAlive)) return false;
                            if (reqStatus === 'inactive' && (!isDebris && isExplicitlyAlive)) return false;
                        }

                        // 4. Orbit check
                        if (reqOrbit && sat.apogee) {
                            if (reqOrbit === 'LEO' && sat.apogee > 2000) return false;
                            if (reqOrbit === 'GEO' && (sat.apogee < 35000 || sat.apogee > 37000)) return false;
                        }

                        // 5. Size (RCS) check - THIS USES THE VARIABLE!
                        if (reqSize && sat.rcs !== undefined && sat.rcs !== null) {
                            // Small: < 0.1m^2 | Medium: 0.1 to 1.0m^2 | Large: > 1.0m^2
                            if (reqSize === 'small' && sat.rcs >= 0.1) return false;
                            if (reqSize === 'medium' && (sat.rcs < 0.1 || sat.rcs > 1.0)) return false;
                            if (reqSize === 'large' && sat.rcs <= 1.0) return false;
                        }

                        // 6. Location check
                        if (targetZone && sat.satrec) {
                            const satPos = SatMath.getEci(sat, now);
                            const lla = eci2lla(satPos.position, gmst);
                            const lat = lla.lat * RAD2DEG;
                            const lon = lla.lon * RAD2DEG;
                            if (lat < targetZone.minLat || lat > targetZone.maxLat || lon < targetZone.minLon || lon > targetZone.maxLon) return false;
                        }

                        return true;
                    });

                    // Render results
                    if (resultsArea) {
                        if (matches.length > 0) {
                            resultsArea.innerHTML += `<div style="color: #8bc34a; padding: 5px;">✅ Found ${matches.length} matching objects.</div>`;
                            searchManager.doSearch(matches.map(s => s.sccNum).join(','), true);
                        } else {
                            resultsArea.innerHTML += `<div style="color: #f44336; padding: 5px;">❌ No matches found.</div>`;
                        }
                    }
                }
            });

            const input = getEl('ai-palette-input') as HTMLInputElement;
            if (input) input.value = '';

        } catch (error) {
            if (resultsArea) {
                resultsArea.innerHTML = `<div style="color: #f44336; padding: 10px;">Failed to parse AI response. Try rephrasing your command.</div>`;
            }
        }
    }
}