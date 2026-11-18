import { AfterViewChecked, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService, FarmProfile } from '../../services/chat.service';
import * as L from 'leaflet';

@Component({ selector: 'app-farm', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './farm.component.html', styleUrl: './farm.component.css' })
export class FarmComponent implements OnInit, AfterViewChecked, OnDestroy {
  private mapHost?: ElementRef<HTMLDivElement>;
  @ViewChild('mapHost') set mapHostRef(host: ElementRef<HTMLDivElement> | undefined) {
    this.mapHost = host;
    if (host && this.manualMapOpen) requestAnimationFrame(() => this.initializeMap());
  }
  farm: FarmProfile = { farmSize: { value: undefined, unit: 'acres' }, soilParameters: {} };
  busy = false; saved = false; error = '';
  locationBusy = false; placeBusy = false; locationStatus = ''; accuracyMeters: number | null = null;
  soilProfile: any = null; soilBusy = false; soilError = '';
  manualMapOpen = false; mapPinPlaced = false; mapZoom = 5;
  mapTilesLoading = false; mapTileError = false;
  mapErrorMessage = 'Map tiles are unavailable. Check your connection and retry.';
  mapCenter = { latitude: 20.5937, longitude: 78.9629 };
  manualLatitude = '20.5937';
  manualLongitude = '78.9629';
  placePreview = '';
  placePreviewBusy = false;
  private placePreviewTimer?: number;
  private placePreviewKey = '';
  private leafletMap?: L.Map;
  private tileLayer?: L.TileLayer;
  private tileErrors = 0;
  private usingFallbackTiles = false;
  private pinMarker?: L.Marker;
  private savedLocationKey = '';
  readonly soils = ['Clay', 'Clay loam', 'Loam', 'Sandy', 'Sandy loam', 'Silt', 'Red soil', 'Black soil', 'Alluvial'];
  readonly seasons = ['Unknown', 'Kharif', 'Rabi', 'Zaid', 'Year-round'];

  constructor(private api: ChatService) {}

  ngOnInit() {
    this.api.getFarm().subscribe({
      next: r => {
        this.farm = r.data || this.farm;
        this.savedLocationKey = this.locationKey;
        this.locationStatus = this.farm.locationText || (this.hasCoordinates ? this.coordinateLabel : 'Add a farm location to personalize advice.');
        if (this.hasCoordinates && (!this.farm.locationText || this.farm.locationText === 'Shared device location')) {
          this.placeBusy = true;
          this.api.resolveLocationName(this.farm.location!.coordinates[1], this.farm.location!.coordinates[0]).subscribe({
            next: result => { if (result.data?.placeName) { this.farm.locationText = result.data.placeName; this.locationStatus = result.data.placeName; } this.placeBusy = false; },
            error: () => { this.placeBusy = false; }
          });
        }
      },
      error: () => this.error = 'Could not load your farm profile.'
    });
  }

  ngAfterViewChecked() {
    if (this.manualMapOpen && this.mapHost && !this.leafletMap) this.initializeMap();
  }

  ngOnDestroy() { this.disposeMap(); }

  get hasCoordinates(): boolean { return this.farm.location?.coordinates?.length === 2; }
  get locationKey(): string { return this.hasCoordinates ? this.farm.location!.coordinates.map(value => Number(value).toFixed(6)).join(',') : ''; }
  get hasSavedCoordinates(): boolean { return Boolean(this.hasCoordinates && this.locationKey === this.savedLocationKey); }
  get coordinateLabel(): string { return this.hasCoordinates ? `${this.farm.location!.coordinates[1].toFixed(5)}, ${this.farm.location!.coordinates[0].toFixed(5)}` : ''; }

  save() {
    this.busy = true; this.error = ''; this.saved = false;
    this.api.saveFarm(this.farm).subscribe({
      next: r => {
        this.farm = r.data;
        this.savedLocationKey = this.locationKey;
        this.saved = true; this.busy = false;
        // Saving farm fields never triggers SoilGrids or changes measured values.
      },
      error: e => { this.error = e.error?.message || 'Could not save the farm profile.'; this.busy = false; }
    });
  }

  loadSoilProfile() {
    if (!this.hasSavedCoordinates) { this.soilError = 'Save the selected coordinates before requesting a soil estimate.'; return; }
    this.soilBusy = true; this.soilError = '';
    this.api.getSoilProfile().subscribe({
      next: r => { this.soilProfile = r.data; this.soilError = r.data?.unavailable ? r.data.message : ''; this.soilBusy = false; },
      error: e => { this.soilError = e.error?.message || 'Soil estimate service is unavailable.'; this.soilBusy = false; }
    });
  }

  getLocation() {
    if (!navigator.geolocation) { this.error = 'Location sharing is not available in this browser.'; return; }
    this.error = ''; this.locationBusy = true; this.locationStatus = 'Requesting a precise device location…';
    navigator.geolocation.getCurrentPosition(
      position => {
        this.locationBusy = false;
        this.accuracyMeters = Math.round(position.coords.accuracy);
        this.setFarmCoordinates(position.coords.latitude, position.coords.longitude, 'device');
      },
      error => {
        this.locationBusy = false;
        this.error = error.code === error.PERMISSION_DENIED ? 'Location permission was denied. You can choose a point on the map instead.' : 'Could not determine device location. Try again or choose a point on the map.';
        this.locationStatus = 'Location not set';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  private setFarmCoordinates(latitude: number, longitude: number, source: 'device' | 'map') {
    const nextKey = [longitude, latitude].map(value => Number(value).toFixed(6)).join(',');
    if (nextKey !== this.savedLocationKey) this.soilProfile = null;
    this.soilError = '';
    this.farm.location = { type: 'Point', coordinates: [longitude, latitude] };
    this.farm.locationText = '';
    this.saved = false;
    this.locationStatus = source === 'device' ? 'Coordinates found · looking up the nearest mapped area…' : 'Map pin selected · looking up the nearest mapped area…';
    this.placeBusy = true;
    this.api.resolveLocationName(latitude, longitude).subscribe({
      next: r => {
        const name = r.data?.placeName || `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        this.farm.locationText = name;
        this.locationStatus = `${name}${source === 'device' && this.accuracyMeters !== null ? ` · GPS accuracy about ±${this.accuracyMeters} m` : ''}`;
        this.placeBusy = false;
      },
      error: () => {
        this.farm.locationText = `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
        this.locationStatus = `${this.farm.locationText} · place name unavailable`;
        this.placeBusy = false;
      }
    });
  }

  openManualMap() {
    if (this.hasCoordinates) {
      this.mapCenter = { latitude: this.farm.location!.coordinates[1], longitude: this.farm.location!.coordinates[0] };
      this.mapPinPlaced = true;
    } else {
      this.mapCenter = { latitude: 20.5937, longitude: 78.9629 };
      this.mapPinPlaced = false;
    }
    this.manualLatitude = this.mapPinPlaced ? this.mapCenter.latitude.toFixed(6) : '';
    this.manualLongitude = this.mapPinPlaced ? this.mapCenter.longitude.toFixed(6) : '';
    this.placePreview = '';
    this.placePreviewBusy = false;
    this.mapZoom = this.hasCoordinates ? 14 : 5;
    this.mapTilesLoading = true;
    this.mapTileError = false;
    this.mapErrorMessage = 'Map tiles are unavailable. Check your connection and retry.';
    this.manualMapOpen = true;
    // The map host is created by *ngIf, so initialize after Angular inserts it.
    window.setTimeout(() => this.initializeMap(), 50);
  }

  closeManualMap() { this.disposeMap(); this.manualMapOpen = false; }

  retryMapTiles(event: Event) {
    event.stopPropagation();
    this.mapTileError = false;
    this.mapTilesLoading = true;
    this.addTileLayer(this.usingFallbackTiles ? 'carto' : 'osm');
  }

  useMapPin() {
    const latitude = Number(this.manualLatitude);
    const longitude = Number(this.manualLongitude);
    if (!this.isValidCoordinate(latitude, longitude)) {
      this.mapErrorMessage = 'Enter a valid latitude (−90 to 90) and longitude (−180 to 180).';
      this.mapTileError = true;
      return;
    }
    this.mapCenter = { latitude, longitude };
    this.mapPinPlaced = true;
    this.setFarmCoordinates(latitude, longitude, 'map');
    this.closeManualMap();
  }

  updateManualCoordinates() {
    const latitude = Number(this.manualLatitude);
    const longitude = Number(this.manualLongitude);
    if (!this.manualLatitude || !this.manualLongitude || !this.isValidCoordinate(latitude, longitude)) return;
    this.mapCenter = { latitude, longitude };
    this.mapPinPlaced = true;
    this.leafletMap?.setView([latitude, longitude], Math.max(this.mapZoom, 14));
    this.setMapPin(L.latLng(latitude, longitude));
    this.previewPlaceName(latitude, longitude);
  }

  private previewPlaceName(latitude: number, longitude: number) {
    const key = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
    this.placePreviewKey = key;
    if (this.placePreviewTimer !== undefined) window.clearTimeout(this.placePreviewTimer);
    this.placePreview = '';
    this.placePreviewBusy = true;
    this.placePreviewTimer = window.setTimeout(() => {
      this.api.resolveLocationName(latitude, longitude).subscribe({
        next: response => {
          if (this.placePreviewKey !== key) return;
          this.placePreview = response.data?.placeName || `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          this.placePreviewBusy = false;
        },
        error: () => {
          if (this.placePreviewKey !== key) return;
          this.placePreview = `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)} · place name unavailable`;
          this.placePreviewBusy = false;
        }
      });
    }, 900);
  }

  private isValidCoordinate(latitude: number, longitude: number): boolean {
    return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  }

  private initializeMap() {
    const host = this.mapHost?.nativeElement;
    if (!host || this.leafletMap) return;
    try {
      const map = L.map(host, { zoomControl: true, attributionControl: true, scrollWheelZoom: true })
        .setView([this.mapCenter.latitude, this.mapCenter.longitude], this.mapZoom);
      this.leafletMap = map;
      this.addTileLayer('osm');
      map.on('zoomend', () => this.mapZoom = map.getZoom());
      map.on('click', event => this.setMapPin(event.latlng));
      if (this.mapPinPlaced) this.setMapPin(L.latLng(this.mapCenter.latitude, this.mapCenter.longitude));
      map.whenReady(() => {
        requestAnimationFrame(() => map.invalidateSize({ pan: false }));
        window.setTimeout(() => map.invalidateSize({ pan: false }), 180);
      });
    } catch (error) {
      console.error('AgroSense map initialization failed', error);
      this.mapTilesLoading = false;
      this.mapTileError = true;
      this.mapErrorMessage = 'Map could not start. Close the map and open it again.';
    }
  }

  private addTileLayer(provider: 'osm' | 'carto') {
    if (!this.leafletMap) return;
    this.tileLayer?.remove();
    this.tileErrors = 0;
    this.usingFallbackTiles = provider === 'carto';
    this.mapTilesLoading = true;
    this.mapTileError = false;
    const layer = L.tileLayer(provider === 'osm'
      ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: provider === 'osm'
        ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> &copy; CARTO',
      updateWhenIdle: true,
      keepBuffer: 2
    });
    layer.on('loading', () => { this.mapTilesLoading = true; this.mapTileError = false; });
    layer.on('load', () => { this.mapTilesLoading = false; });
    layer.on('tileerror', () => {
      this.tileErrors += 1;
      if (provider === 'osm' && this.tileErrors >= 2) this.addTileLayer('carto');
      else if (provider === 'carto') { this.mapTileError = true; this.mapTilesLoading = false; }
    });
    this.tileLayer = layer;
    layer.addTo(this.leafletMap);
  }

  private setMapPin(point: L.LatLng) {
    if (!this.leafletMap) return;
    this.mapCenter = { latitude: point.lat, longitude: point.lng };
    this.manualLatitude = point.lat.toFixed(6);
    this.manualLongitude = point.lng.toFixed(6);
    this.mapPinPlaced = true;
    this.previewPlaceName(point.lat, point.lng);
    if (this.pinMarker) {
      this.pinMarker.setLatLng(point);
      return;
    }
    const icon = L.divIcon({
      className: 'agrosense-map-icon',
      html: '<span></span>',
      iconSize: [30, 38],
      iconAnchor: [15, 38]
    });
    this.pinMarker = L.marker(point, { icon, draggable: true }).addTo(this.leafletMap);
    this.pinMarker.on('dragend', () => {
      const selected = this.pinMarker!.getLatLng();
      this.mapCenter = { latitude: selected.lat, longitude: selected.lng };
      this.manualLatitude = selected.lat.toFixed(6);
      this.manualLongitude = selected.lng.toFixed(6);
      this.mapPinPlaced = true;
      this.previewPlaceName(selected.lat, selected.lng);
    });
  }

  private disposeMap() {
    this.leafletMap?.remove();
    this.leafletMap = undefined;
    this.tileLayer = undefined;
    this.tileErrors = 0;
    this.usingFallbackTiles = false;
    this.pinMarker = undefined;
    this.mapTilesLoading = false;
    this.mapTileError = false;
    if (this.placePreviewTimer !== undefined) window.clearTimeout(this.placePreviewTimer);
  }
}
