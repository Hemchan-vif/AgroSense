import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ChatService } from '../../services/chat.service';

@Component({ selector: 'app-insights', standalone: true, imports: [CommonModule, RouterModule], templateUrl: './insights.component.html', styleUrl: './insights.component.css' })
export class InsightsComponent implements OnInit {
  recommendations: any[] = []; plans: any[] = []; error = '';
  constructor(private api: ChatService) {}
  ngOnInit() { this.api.getRecommendations().subscribe({ next: r => this.recommendations = r.data || [], error: () => this.error = 'Could not load crop recommendations.' }); this.api.getRotationPlans().subscribe({ next: r => this.plans = r.data || [], error: () => this.error ||= 'Could not load rotation plans.' }); }
}
