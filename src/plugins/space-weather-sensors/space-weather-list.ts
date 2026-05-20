import { spaceWeatherSensors } from '@app/app/data/catalogs/space-weather-sensors';
import { MenuMode, ToastMsgType } from '@app/engine/core/interfaces';
import { ServiceLocator } from '@app/engine/core/service-locator';
import { EventBus } from '@app/engine/events/event-bus';
import { EventBusEvent } from '@app/engine/events/event-bus-events';
import { ICommandPaletteCapable, ICommandPaletteCommand } from '@app/engine/plugins/core/plugin-capabilities';
import { html } from '@app/engine/utils/development/formatter';
import { errorManagerInstance } from '@app/engine/utils/errorManager';
import { getEl } from '@app/engine/utils/get-el';
import { HideOtherSatellitesPlugin } from '@app/plugins/hide-other-sats/hide-other-sats';
import { ZoomValue } from '@ootk/src/main';
import solarFlarePng from '@public/img/icons/space-weather.png';
import { SpaceWeatherGroup, spaceWeatherGroups } from '../../app/data/catalogs/space-weather-groups';
import { ClickDragOptions, KeepTrackPlugin } from '../../engine/plugins/base-plugin';
import { DateTimeManager } from '../date-time-manager/date-time-manager';
import { keepTrackApi } from './../../keepTrackApi';
import './space-weather-list.css';

export class SpaceWeatherListPlugin extends KeepTrackPlugin implements ICommandPaletteCapable {
  readonly id = 'SpaceWeatherListPlugin';
  dependencies_ = [DateTimeManager.name];
  private isSpaceWeatherListInitialized_ = false;

  dragOptions: ClickDragOptions = { isDraggable: true, minWidth: 550, maxWidth: 800 };
  menuMode: MenuMode[] = [MenuMode.ALL];
  bottomIconElementName = 'space-weather-list-bottom-icon';
  bottomIconLabel = 'Space Weather List';
  bottomIconImg = solarFlarePng;
  sideMenuElementName = 'space-weather-list-menu';
  sideMenuTitle = 'Space Weather Sensors';

  sideMenuElementHtml = html`
    <div id="space-weather-list-menu" class="side-menu-parent start-hidden">
        <div id="space-weather-list-content" class="side-menu">
          <div class="sw-list-header-actions">
            <button id="sw-showcase-btn" class="btn btn-ui waves-effect">Showcase Mode</button>
          </div>
          <ul id="list-of-sw-sensors">
            ${spaceWeatherGroups.map(g => this.renderGroup_(g)).join('')}
          </ul>
      </div>
    </div>`;

  getCommandPaletteCommands(): ICommandPaletteCommand[] {
    return Object.entries(spaceWeatherSensors).map(([key, sensor]) => ({
      id: `SpaceWeatherListPlugin.setSensor.${key}`,
      label: `Focus Space Weather Sensor: ${sensor.uiName}`,
      category: 'Space Weather',
      callback: () => this.handleSensorFocus_(key)
    }));
  }

  addJs(): void {
    super.addJs();
    if (this.isSpaceWeatherListInitialized_) return;

    EventBus.getInstance().on(EventBusEvent.uiManagerFinal, () => {
      // Handle Showcase Toggle
      getEl('sw-showcase-btn')?.addEventListener('click', () => {
        const btn = getEl('sw-showcase-btn');
        const isShowcaseActive = btn?.classList.contains('btn-active');
        const hideOtherSatsPlugin = keepTrackApi.getPlugin(HideOtherSatellitesPlugin);

        if (hideOtherSatsPlugin) {
          if (isShowcaseActive) {
            hideOtherSatsPlugin.showOtherSats();
          } else {
            hideOtherSatsPlugin.hideOtherSats();
          }
        } else {
          errorManagerInstance.warn('Showcase Mode requires HideOtherSatellitesPlugin to be loaded.');
        }

        btn?.classList.toggle('btn-active');
        ServiceLocator.getUiManager()?.toast(isShowcaseActive ? 'Showing All Objects' : 'Showcasing SW Sensors Only', ToastMsgType.normal);
      });

      // Handle List Clicks
      getEl('space-weather-list-content')?.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        if (!target) return;

        const sensorId = target.dataset.sensor || target.closest('.menu-selectable')?.getAttribute('data-sensor');
        if (!sensorId) return;

        ServiceLocator.getSoundManager()?.play('click' as any);

        if (target.classList.contains('sw-graph-btn')) {
          e.stopPropagation();

          // Always open the shared Space Weather chart for listed sensors.
          if (this.isMenuButtonActive) {
            getEl(this.bottomIconElementName)?.click();
          }
          EventBus.getInstance().emit('OPEN_SPACE_WEATHER_CHART' as any, sensorId);
        } else {
          this.handleSensorFocus_(sensorId);
        }
      });
    });
    this.isSpaceWeatherListInitialized_ = true;
  }

  private handleSensorFocus_(sensorId: string) {
    const sm = ServiceLocator.getSensorManager();
    sm.clearSecondarySensors();

    let targetSensor = spaceWeatherSensors[sensorId];

    // If not found, check if it's a group ID (e.g., clicking the "TART" header)
    if (!targetSensor) {
      const group = spaceWeatherGroups.find(g => g.name === sensorId);
      if (group && group.list.length > 0) {
        targetSensor = spaceWeatherSensors[group.list[0]]; // Focus first site in group
      }
    }

    if (!targetSensor) return errorManagerInstance.debug(`Space weather item ${sensorId} not found.`);

    // Update the side menu title to reflect selection
    const titleEl = getEl(`side-menu-title-${this.sideMenuElementName}`);
    if (titleEl) {
      titleEl.innerText = `Space Weather: ${targetSensor.uiName || sensorId}`;
    }

    // Slide the menu back in after selection
    if (this.isMenuButtonActive) {
      getEl(this.bottomIconElementName)?.click();
    }

    sm.setSensor(targetSensor);

    if (targetSensor.sensorId === 'GOES-XRAY') {
      EventBus.getInstance().emit('OPEN_SPACE_WEATHER_CHART' as any, targetSensor.sensorId);
    }

    try {
      keepTrackApi.getMainCamera().lookAtLatLon(targetSensor.lat, targetSensor.lon, targetSensor.zoom ?? ZoomValue.GEO, ServiceLocator.getTimeManager().selectedDate);
    } catch (e) {
      errorManagerInstance.warn(`Camera focus error: ${e}`);
    }
  }

  private renderGroup_(group: SpaceWeatherGroup): string {
    const sensors = group.list.map((s: string) => spaceWeatherSensors[s]).filter(Boolean);
    const topLink = group.topLink ? html`<li class="menu-selectable sw-sensor-top-link" data-sensor="${group.name}"><span>${group.topLink.name}</span><span class="badge dark-blue-badge">${group.topLink.badge}</span></li>` : '';

    return html`
      <h5>${group.header}</h5>
      ${topLink}
      ${sensors.map((s: any) => html`
        <li class="menu-selectable" data-sensor="${s.sensorId}">
          <span>${s.uiName}</span>
          <span>${s.system}</span>
          <span class="sw-item-actions">
            <span class="badge dark-blue-badge">${s.operator}</span>
            ${s.hasTelemetry ? html`<img class="sw-graph-btn" src="${solarFlarePng}" data-sensor="${s.sensorId}" title="View Data">` : ''}
          </span>
        </li>
      `).join('')}
    `;
  }
}