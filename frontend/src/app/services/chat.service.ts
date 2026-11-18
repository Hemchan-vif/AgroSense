import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ChatResponse { success: boolean; data: { text: string; metadata?: any; conversationId?: string } }
export interface FarmProfile {
  _id?: string; name?: string; locationText?: string;
  location?: { type: string; coordinates: number[] };
  farmSize?: { value?: number; unit?: string }; soilType?: string;
  soilParameters?: { ph?: number; nitrogen?: number; phosphorus?: number; potassium?: number };
  soilProfile?: any;
  irrigation?: string; previousCrop?: string; currentCrop?: string; season?: string;
}
declare global { interface Window { Telegram?: any } }

@Injectable({ providedIn: 'root' })
export class ChatService {
  private conversationId: string | null = null;
  private readonly demoId = this.getDemoId();
  constructor(private http: HttpClient) {}
  private get baseUrl(): string { return '/api'; }
  private getDemoId(): string {
    if (typeof window === 'undefined') return 'browser-demo';
    let id = localStorage.getItem('agrosense-demo-id');
    if (!id) { id = `browser-${crypto.randomUUID()}`; localStorage.setItem('agrosense-demo-id', id); }
    return id;
  }
  private get headers(): HttpHeaders {
    const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : null;
    let headers = new HttpHeaders();
    if (tg?.initData) headers = headers.set('X-Telegram-Init-Data', tg.initData);
    else if (typeof window !== 'undefined' && window.location.hostname === 'localhost') headers = headers.set('X-Demo-User', this.demoId);
    return headers;
  }
  sendMessage(message: string): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.baseUrl}/chat`, { message, conversationId: this.conversationId }, { headers: this.headers });
  }
  loadHistory(conversationId?: string): Observable<any> { const query = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''; return this.http.get<any>(`${this.baseUrl}/chat/history${query}`, { headers: this.headers }); }
  newConversation(): Observable<any> { return this.http.post<any>(`${this.baseUrl}/chat/new`, {}, { headers: this.headers }); }
  getConversations(): Observable<any> { return this.http.get<any>(`${this.baseUrl}/chat/conversations`, { headers: this.headers }); }
  activateConversation(id: string): Observable<any> { return this.http.post<any>(`${this.baseUrl}/chat/conversations/${encodeURIComponent(id)}/activate`, {}, { headers: this.headers }); }
  setConversation(id: string | null): void { this.conversationId = id; }
  getFarm(): Observable<any> { return this.http.get<any>(`${this.baseUrl}/chat/farm`, { headers: this.headers }); }
  saveFarm(farm: FarmProfile): Observable<any> { return this.http.put<any>(`${this.baseUrl}/chat/farm`, farm, { headers: this.headers }); }
  getWeather(location?: { latitude: number; longitude: number }): Observable<any> {
    const query = location ? `?latitude=${encodeURIComponent(location.latitude)}&longitude=${encodeURIComponent(location.longitude)}` : '';
    return this.http.get<any>(`${this.baseUrl}/chat/weather${query}`, { headers: this.headers });
  }
  getSoilProfile(): Observable<any> { return this.http.get<any>(`${this.baseUrl}/chat/soil-profile`, { headers: this.headers }); }
  resolveLocationName(latitude: number, longitude: number): Observable<any> {
    const query = `?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`;
    return this.http.get<any>(`${this.baseUrl}/chat/location-name${query}`, { headers: this.headers });
  }
  getRecommendations(): Observable<any> { return this.http.get<any>(`${this.baseUrl}/chat/recommendations`, { headers: this.headers }); }
  getRotationPlans(): Observable<any> { return this.http.get<any>(`${this.baseUrl}/chat/rotation-plans`, { headers: this.headers }); }
  getProfile(): Observable<any> { return this.http.get<any>(`${this.baseUrl}/miniapp/auth`, { headers: this.headers }); }
}
