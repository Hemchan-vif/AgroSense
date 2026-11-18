# AgroSense - Start Mini App Tunnel
Write-Host "==========================================" -ForegroundColor Green
Write-Host "   Starting AgroSense Telegram Mini App Tunnel" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green

Write-Host "`nConnecting to localhost.run over SSH..." -ForegroundColor Cyan
Write-Host "Port forwarding: localhost:3000 -> HTTPS" -ForegroundColor Cyan
Write-Host "Press Ctrl+C anytime to stop.`n" -ForegroundColor Yellow

ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 80:localhost:3000 nokey@localhost.run
