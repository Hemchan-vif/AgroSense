@echo off
title AgroSense Tunnel
echo Starting tunnel on port 3000...
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000
pause
