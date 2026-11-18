import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.css'
})
export class ProfileComponent implements OnInit {
  userName = 'Farmer';
  userHandle = '@farmer';
  userId = 'TG-868001';
  language = 'English';
  tgVersion = '7.0';
  farm: any = null;
  error = '';

  constructor(private api: ChatService) {}

  ngOnInit() {
    this.api.getProfile().subscribe({ next: r => { if (r.data?.user?.name) this.userName = r.data.user.name; this.farm = r.data?.farm; }, error: () => this.error = 'Open from Telegram to load your verified profile.' });
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp;
      if (tg.initDataUnsafe?.user) {
        const u = tg.initDataUnsafe.user;
        this.userName = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Farmer';
        this.userHandle = u.username ? `@${u.username}` : '@user';
        this.userId = `TG-${u.id}`;
        this.language = u.language_code === 'ta' ? 'தமிழ் (Tamil)' : 'English';
      }
      this.tgVersion = tg.version || '7.0';
    }
  }

  toggleLanguage(lang: string) {
    this.language = lang;
  }
}
