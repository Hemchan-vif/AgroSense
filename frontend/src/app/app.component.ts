import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ChatService } from './services/chat.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'AgroSense';
  userName = 'Farmer';
  userInitial = 'F';
  tgUser: any = null;
  locationLabel = 'Set farm';

  constructor(private api: ChatService) {}

  ngOnInit() {
    this.api.getFarm().subscribe({ next: r => { const farm = r.data; this.locationLabel = farm?.locationText || (farm?.location ? 'Farm location' : 'Set farm'); }, error: () => {} });
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp;
      tg.ready();
      tg.expand();

      // Configure mobile header and background colors
      try {
        tg.setHeaderColor?.('#191975');
        tg.setBackgroundColor?.(tg.colorScheme === 'dark' ? '#0F172A' : '#F4F6F9');
      } catch (e) {}

      if (tg.initDataUnsafe?.user) {
        this.tgUser = tg.initDataUnsafe.user;
        this.userName = this.tgUser.first_name || 'Farmer';
        this.userInitial = (this.tgUser.first_name || 'F').charAt(0).toUpperCase();
      }

      if (tg.colorScheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.body.classList.add('dark-mode');
      }
    }
  }

  onTabClick() {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp?.HapticFeedback) {
      try {
        (window as any).Telegram.WebApp.HapticFeedback.selectionChanged();
      } catch (e) {}
    }
  }
}
