import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ChatService } from '../../services/chat.service';

@Component({ selector: 'app-weather', standalone: true, imports: [CommonModule, RouterModule], templateUrl: './weather.component.html', styleUrl: './weather.component.css' })
export class WeatherComponent implements OnInit, OnDestroy {
  weather: any = null; error = ''; locationBusy = false; weatherBusy = false; usingCurrentLocation = false;
  private activeLocation: { latitude: number; longitude: number } | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  constructor(private api: ChatService) {}
  ngOnInit() { this.refresh(); this.refreshTimer = setInterval(() => this.refresh(), 10 * 60 * 1000); }
  ngOnDestroy() { if (this.refreshTimer) clearInterval(this.refreshTimer); }
  refresh(location?: { latitude: number; longitude: number }) {
    if (location) { this.activeLocation = location; this.usingCurrentLocation = true; }
    if (this.weatherBusy) return;
    this.weatherBusy = true;
    this.error = '';
    this.api.getWeather(this.activeLocation).subscribe({
      next: r => { this.weather = r.data; if (this.weather?.unavailable) this.error = this.weather.message; this.weatherBusy = false; },
      error: e => { this.error = e.error?.message || 'Could not load weather.'; this.weatherBusy = false; }
    });
  }
  useFarmLocation() { this.activeLocation = undefined; this.usingCurrentLocation = false; this.refresh(); }
  useCurrentLocation() {
    if (!navigator.geolocation) { this.error = 'Location is not available in this browser.'; return; }
    this.locationBusy = true; this.error = '';
    navigator.geolocation.getCurrentPosition(
      position => { this.locationBusy = false; this.refresh({ latitude: position.coords.latitude, longitude: position.coords.longitude }); },
      () => { this.locationBusy = false; this.error = 'Location permission was not granted. Showing your saved farm location instead.'; this.useFarmLocation(); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }
}
