import { Routes } from '@angular/router';
import { ChatComponent } from './features/chat/chat.component';
import { InsightsComponent } from './features/insights/insights.component';
import { ProfileComponent } from './features/profile/profile.component';
import { FarmComponent } from './features/farm/farm.component';
import { WeatherComponent } from './features/weather/weather.component';

export const routes: Routes = [
  { path: '', redirectTo: 'chat', pathMatch: 'full' },
  { path: 'chat', component: ChatComponent },
  { path: 'insights', component: InsightsComponent },
  { path: 'profile', component: ProfileComponent },
  { path: 'farm', component: FarmComponent },
  { path: 'weather', component: WeatherComponent },
  { path: '**', redirectTo: 'chat' } // Fallback route
];
