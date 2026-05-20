import { ServiceLocator } from '@app/engine/core/service-locator';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { KeepTrackPlugin } from '@app/engine/plugins/base-plugin';
import { KeyboardComponent } from '@app/engine/plugins/components/keyboard/keyboard-component';
import { html } from '@app/engine/utils/development/formatter';
import { getEl } from '@app/engine/utils/get-el';
import { WebWorkerMLCEngine } from '@mlc-ai/web-llm';

export class AiCommandPalettePlugin extends KeepTrackPlugin {
    readonly id = 'AiCommandPalettePlugin';
    dependencies_ = ['TopMenu'];

    private aiWorker: Worker | null = null;
    private engine: WebWorkerMLCEngine | null = null;
    // Centralize the model ID to ensure consistency between reload and create
    private readonly SELECTED_MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';

    private isModalOpen = false;
    private isAiEnabled = false;

    addHtml(): void {
        super.addHtml();

        EventBus.getInstance().on(EventBusEvent.uiManagerFinal, () => {
            const uiWrapper = getEl('ui-wrapper');

            const paletteHtml = html`
        <div id="ai-palette-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); z-index: 9998; backdrop-filter: blur(3px);"></div>

        <div id="ai-palette-modal" style="display: none; position: fixed; top: 15%; left: 50%; transform: translateX(-50%); width: 600px; max-width: 90vw; background: var(--color-dark-ui-bg, #1e1e1e); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); z-index: 9999; border: 1px solid #333; display: flex; flex-direction: column;">

          <div style="display: flex; align-items: center; padding: 15px; border-bottom: 1px solid #333;">
            <input id="ai-palette-input" type="text" placeholder="Search satellites or type a command..." autocomplete="off" style="flex-grow: 1; border: none; background: transparent; color: #fff; font-size: 1.2rem; outline: none; margin: 0; border-bottom: none; box-shadow: none;" />

            <div class="switch" style="margin-left: 15px;">
              <label style="color: #aaa; font-size: 0.9rem;">
                AI
                <input id="ai-palette-toggle" type="checkbox" />
                <span class="lever"></span>
              </label>
            </div>
          </div>

          <div id="ai-palette-results" style="max-height: 400px; overflow-y: auto; padding: 10px;">
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
        });
    }

    private setupSearchHijack(): void {
        const originalSearch = getEl('search') as HTMLInputElement;

        if (originalSearch) {
            originalSearch.addEventListener('focus', (e) => {
                e.preventDefault();
                // 1. Immediately remove focus so the standard SearchManager doesn't take over
                originalSearch.blur();
                // 2. Open our spotlight modal
                this.openPalette();
            });
        }
    }

    private setupKeyboardShortcuts(): void {
        // Allows Cmd+K or Ctrl+K to open the palette from anywhere
        const keyboard = new KeyboardComponent(this.id, [
            {
                key: 'k',
                ctrl: true,
                // Removed the 'e' parameter to match KeepTrack's strict callback signature
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

    // Add this missing helper method to handle the toggling logic
    private togglePalette(): void {
        if (this.isModalOpen) {
            this.closePalette();
        } else {
            this.openPalette();
        }
    }

    private setupPaletteListeners(): void {
        const overlay = getEl('ai-palette-overlay');
        const input = getEl('ai-palette-input') as HTMLInputElement;
        const toggle = getEl('ai-palette-toggle') as HTMLInputElement;

        // Close when clicking outside the modal
        overlay?.addEventListener('click', () => this.closePalette());

        // Handle AI Toggle
        toggle?.addEventListener('change', (e) => {
            this.isAiEnabled = (e.target as HTMLInputElement).checked;
            if (this.isAiEnabled) {
                this.initializeWebLLM();
            }
        });

        // Handle User Input Submission
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const query = input.value.trim();
                if (!query) return;

                if (this.isAiEnabled) {
                    this.processAiCommand(query);
                } else {
                    // Fallback to standard search if AI is off
                    this.processStandardSearch(query);
                }
            }
        });
    }
    private openPalette(): void {
        this.isModalOpen = true;
        const overlay = getEl('ai-palette-overlay');
        const modal = getEl('ai-palette-modal');
        const input = getEl('ai-palette-input') as HTMLInputElement;

        if (overlay && modal && input) {
            overlay.style.display = 'block';
            modal.style.display = 'flex';
            input.focus();
        }
    }

    private closePalette(): void {
        this.isModalOpen = false;
        const overlay = getEl('ai-palette-overlay');
        const modal = getEl('ai-palette-modal');

        if (overlay && modal) {
            overlay.style.display = 'none';
            modal.style.display = 'none';
        }
    }

    private processStandardSearch(query: string): void {
        // If AI is off, we can route the string back to the standard SearchManager
        this.closePalette();
        const searchManager = ServiceLocator.getUiManager().searchManager; // or via PluginRegistry
        searchManager.openSearch(true);
        searchManager.doSearch(query);
    }

    // --- AI Integration Stubs ---

    // Note: This is now an async function!
    private async initializeWebLLM(): Promise<void> {
        const resultsArea = getEl('ai-palette-results');
        if (resultsArea) {
            resultsArea.innerHTML = `<div style="color: #00bcd4; padding: 10px;">Initializing WebLLM Web Worker (This may download a ~2GB model on first run)...</div>`;
        }

        try {
            // 1. Create the standard worker. Note: type: 'module' may be required depending on your bundler setup.
            this.aiWorker = new Worker('/js/ai-palette-worker.js', { type: 'module' });
            // 2. Wrap it in WebLLM's official proxy engine
            this.engine = new WebWorkerMLCEngine(this.aiWorker);

            // 3. Pipe the loading progress to the UI
            this.engine.setInitProgressCallback((progress) => {
                if (resultsArea) {
                    resultsArea.innerHTML = `<div style="color: #aaa; padding: 10px;">${progress.text}</div>`;
                }
            });

            // 4. Load the model
            await this.engine.reload(this.SELECTED_MODEL); // ~400MB

            if (resultsArea) {
                resultsArea.innerHTML = `<div style="color: #8bc34a; padding: 10px;">AI Ready! Type a command above.</div>`;
            }
        } catch (error) {
            if (resultsArea) {
                resultsArea.innerHTML = `<div style="color: #f44336; padding: 10px;">Worker Error: ${error}</div>`;
            }
        }
    }

    private async processAiCommand(prompt: string): Promise<void> {
        const resultsArea = getEl('ai-palette-results');
        if (!this.engine) return;

        if (resultsArea) {
            resultsArea.innerHTML = `<div style="color: #aaa; padding: 10px;">Thinking: "${prompt}"...</div>`;
        }

        const systemPrompt = `You are an AI assistant built into the KeepTrack.space astrodynamics platform.
    Your job is to translate natural language into structured application commands.
    Respond ONLY with a JSON array of command objects.

    Available commands:
    1. Find a satellite: { "action": "find", "target": "<satellite_name_or_id>" }
    2. Toggle a UI layer: { "action": "toggle_layer", "layer": "<sensor|grid|clouds|atmosphere>", "state": <boolean> }`;

        try {
            // We can now call the AI exactly like the OpenAI API, but it runs locally in the worker!
            const response = await this.engine.chat.completions.create({
                model: this.SELECTED_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.1,
            });

            const rawJson = response.choices[0].message.content;
            if (rawJson) {
                this.executeAiCommands(rawJson);
            }
        } catch (error) {
            if (resultsArea) resultsArea.innerHTML = `<div style="color: #f44336; padding: 10px;">AI Processing Error.</div>`;
        }
    }

    private executeAiCommands(jsonString: string): void {
        const resultsArea = getEl('ai-palette-results');

        try {
            // The AI might return an object with an array, or just an array. Standardize it.
            const parsed = JSON.parse(jsonString);
            const commands = Array.isArray(parsed) ? parsed : (parsed.commands || []);

            if (resultsArea) resultsArea.innerHTML = ''; // Clear "Thinking..." text

            commands.forEach((cmd: any) => {
                if (cmd.action === 'find') {
                    // Utilize KeepTrack's existing SearchManager to find the object
                    const searchManager = ServiceLocator.getUiManager().searchManager;
                    searchManager.doSearch(cmd.target, true); // true = prevent dropdown

                    if (resultsArea) {
                        resultsArea.innerHTML += `<div style="color: #fff; padding: 5px;">🔍 Searching for: <b>${cmd.target}</b></div>`;
                    }
                }
                else if (cmd.action === 'toggle_layer') {
                    // You can expand this to use KeepTrack's specific UI toggles
                    if (resultsArea) {
                        const stateText = cmd.state ? 'Enabled' : 'Disabled';
                        resultsArea.innerHTML += `<div style="color: #fff; padding: 5px;">👁️ ${stateText} layer: <b>${cmd.layer}</b></div>`;
                    }
                }
            });

            // Clear the input box after successful execution
            const input = getEl('ai-palette-input') as HTMLInputElement;
            if (input) input.value = '';

        } catch (error) {
            if (resultsArea) {
                resultsArea.innerHTML = `<div style="color: #f44336; padding: 10px;">Failed to parse AI response.</div>`;
            }
        }
    }

}