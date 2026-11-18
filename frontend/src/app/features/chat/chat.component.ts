import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';

interface Message {
  id: number | string;
  role: 'user' | 'ai';
  text?: string;
  isTyping?: boolean;
  metadata?: any;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit {
  @ViewChild('chatContainer') private chatContainer!: ElementRef;

  messages: Message[] = [];
  userInput: string = '';
  isProcessing: boolean = false;
  errorMessage = '';
  conversationId: string | null = null;
  selectedHistoryId = '';
  conversations: Array<{ _id: string; title: string; status: string; updatedAt: string }> = [];
  
  suggestedPrompts = [
    "Recommend a crop",
    "Plan crop rotation",
    "Check weather",
    "Analyze my soil"
  ];

  constructor(private chatService: ChatService) {}

  ngOnInit() {
    this.refreshConversations();
    this.chatService.loadHistory().subscribe({
      next: response => {
        this.conversationId = response.data.conversationId;
        this.chatService.setConversation(this.conversationId);
        this.messages = response.data.messages.map((m: any) => ({ id: m._id, role: m.role === 'user' ? 'user' : 'ai', text: m.content, metadata: m.metadata }));
        if (!this.messages.length) this.welcome();
        this.queueScrollToBottom(false);
      },
      error: () => { this.welcome(); this.errorMessage = 'Could not load saved messages. Check the API connection.'; this.queueScrollToBottom(false); }
    });
  }

  private welcome() { this.messages = [{ id: Date.now(), role: 'ai', text: "Hello 👋 I'm AgroSense. Ask about crops, rotation, weather, or soil. I’ll use your saved farm information and tell you when a key detail is missing." }]; }

  refreshConversations() {
    this.chatService.getConversations().subscribe({ next: response => this.conversations = response.data || [], error: () => {} });
  }

  openConversation(id: string) {
    if (!id) return;
    this.isProcessing = true;
    this.chatService.activateConversation(id).subscribe({
      next: () => this.chatService.loadHistory(id).subscribe({
        next: response => { this.conversationId = response.data.conversationId; this.selectedHistoryId = id; this.chatService.setConversation(id); this.messages = response.data.messages.map((m: any) => ({ id: m._id, role: m.role === 'user' ? 'user' : 'ai', text: m.content, metadata: m.metadata })); this.isProcessing = false; this.queueScrollToBottom(false); },
        error: () => { this.isProcessing = false; this.errorMessage = 'Could not load this conversation.'; }
      }),
      error: () => { this.isProcessing = false; this.errorMessage = 'Could not reopen this conversation.'; }
    });
  }

  newChat() {
    if (this.isProcessing) return;
    this.isProcessing = true; this.errorMessage = '';
    this.chatService.newConversation().subscribe({
      next: response => { this.conversationId = response.data.conversationId; this.selectedHistoryId = this.conversationId || ''; this.chatService.setConversation(this.conversationId); this.welcome(); this.isProcessing = false; this.refreshConversations(); this.queueScrollToBottom(false); },
      error: () => { this.isProcessing = false; this.errorMessage = 'Could not start a new conversation.'; }
    });
  }

  private queueScrollToBottom(smooth = true): void {
    requestAnimationFrame(() => {
      const element = this.chatContainer?.nativeElement;
      if (element) element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    });
  }

  usePrompt(prompt: string) {
    this.userInput = prompt;
    this.sendMessage();
  }

  sendMessage() {
    if (!this.userInput.trim() || this.isProcessing) return;

    const userMessage = this.userInput;
    this.userInput = '';
    this.errorMessage = '';
    
    // Add User Message
    this.messages.push({
      id: Date.now(),
      role: 'user',
      text: userMessage
    });
    this.queueScrollToBottom();
    
    this.isProcessing = true;
    
    // Add AI Typing Indicator
    const typingId = Date.now() + 1;
    this.messages.push({
      id: typingId,
      role: 'ai',
      isTyping: true
    });

    // Call Backend Service
    this.chatService.sendMessage(userMessage).subscribe({
      next: (response) => {
        // Remove typing indicator
        this.messages = this.messages.filter(m => m.id !== typingId);
        this.isProcessing = false;

        this.messages.push({
          id: Date.now() + 2,
          role: 'ai',
          text: response.data.text,
          metadata: response.data.metadata
        });
        this.queueScrollToBottom();
        this.conversationId = response.data.conversationId || this.conversationId;
        this.chatService.setConversation(this.conversationId);
        this.selectedHistoryId = this.conversationId || '';
        this.refreshConversations();
      },
      error: (error) => {
        this.messages = this.messages.filter(m => m.id !== typingId);
        this.isProcessing = false;
        
        this.messages.push({
          id: Date.now() + 2,
          role: 'ai',
          text: error.status === 401 ? 'Open AgroSense from Telegram, or run the local development server to use the demo.' : 'I could not reach the AgroSense service. Please check that the backend and database are running, then retry.',
        });
        this.queueScrollToBottom();
      }
    });
  }
}
