const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

let tunnelProcess = null;
let currentTunnelUrl = null;
let urlReadyResolvers = [];

/**
 * Locate the cloudflared executable on the system.
 */
function getCloudflaredPath() {
  const possiblePaths = [
    'cloudflared',
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    path.join(process.env.LOCALAPPDATA || '', 'cloudflared', 'cloudflared.exe')
  ];

  for (const candidate of possiblePaths) {
    if (candidate === 'cloudflared') {
      try {
        execSync('cloudflared --version', { stdio: 'ignore' });
        return 'cloudflared';
      } catch (e) {
        continue;
      }
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Determine whether auto-tunneling should run.
 * - In production hosting (Render, Railway, VPS, etc.), this defaults to false.
 * - In development, this defaults to true.
 * - Can be explicitly overridden with AUTO_TUNNEL=true or AUTO_TUNNEL=false in .env.
 */
function shouldRunTunnel() {
  if (process.env.AUTO_TUNNEL === 'false') {
    return false;
  }
  if (process.env.AUTO_TUNNEL === 'true') {
    return true;
  }
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return true;
}

/**
 * Update TELEGRAM_MINI_APP_URL in the project's root .env file.
 */
function updateEnvFile(key, value) {
  const envPaths = [
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../.env')
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      try {
        let content = fs.readFileSync(envPath, 'utf8');
        const regex = new RegExp(`^${key}=.*$`, 'gm');
        if (regex.test(content)) {
          // Replace all occurrences to prevent duplicates
          content = content.replace(regex, `${key}=${value}`);
        } else {
          content += `\n${key}=${value}\n`;
        }
        fs.writeFileSync(envPath, content, 'utf8');
      } catch (err) {
        console.warn(`[Tunnel] Could not persist ${key} to ${envPath}:`, err.message);
      }
    }
  }
}

/**
 * Wait for the tunnel URL to be discovered if it is currently starting.
 */
function waitForTunnelUrl(timeoutMs = 4000) {
  if (currentTunnelUrl) {
    return Promise.resolve(currentTunnelUrl);
  }
  if (!shouldRunTunnel()) {
    return Promise.resolve(process.env.TELEGRAM_MINI_APP_URL || null);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(currentTunnelUrl || process.env.TELEGRAM_MINI_APP_URL || null);
    }, timeoutMs);

    urlReadyResolvers.push((url) => {
      clearTimeout(timer);
      resolve(url);
    });
  });
}

/**
 * Start the Cloudflare Tunnel automatically.
 */
function startTunnel({ port = 3000, onUrlReady } = {}) {
  if (!shouldRunTunnel()) {
    const currentUrl = process.env.TELEGRAM_MINI_APP_URL;
    if (process.env.NODE_ENV === 'production') {
      console.log(`[Tunnel] Production environment detected. Auto-tunnel skipped.`);
      console.log(`[Tunnel] Using configured Telegram Mini App URL: ${currentUrl || '(not set)'}`);
    } else {
      console.log(`[Tunnel] AUTO_TUNNEL is disabled in environment settings.`);
    }
    return;
  }

  const binary = getCloudflaredPath();
  if (!binary) {
    console.warn('\n[Tunnel] ⚠️  cloudflared executable was not found on this system.');
    console.warn('[Tunnel] To enable automatic Telegram Mini App tunneling:');
    console.warn('[Tunnel] 1. Download Cloudflare Tunnel from: https://github.com/cloudflare/cloudflared/releases');
    console.warn('[Tunnel] 2. Or run manually using start-tunnel.bat / start-tunnel.ps1\n');
    return;
  }

  // Terminate any previous tunnel process started by this module
  stopTunnel();

  console.log(`[Tunnel] Starting automated Cloudflare Tunnel for port ${port}...`);

  try {
    tunnelProcess = spawn(binary, ['tunnel', '--url', `http://localhost:${port}`]);
  } catch (err) {
    console.error('[Tunnel] Failed to launch cloudflared:', err.message);
    return;
  }

  let captured = false;

  const handleOutput = (chunk) => {
    const text = chunk.toString();
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !captured) {
      captured = true;
      currentTunnelUrl = match[0];

      console.log('\n=============================================================');
      console.log('🚀 AgroSense Cloudflare Tunnel Connected Successfully!');
      console.log(`📡 Live Tunnel URL : ${currentTunnelUrl}`);
      console.log('📱 Telegram Mini App URL updated automatically!');
      console.log('=============================================================\n');

      // Update in-memory environment variable
      process.env.TELEGRAM_MINI_APP_URL = currentTunnelUrl;

      // Update .env file on disk
      updateEnvFile('TELEGRAM_MINI_APP_URL', currentTunnelUrl);

      // Trigger callback if provided
      if (typeof onUrlReady === 'function') {
        onUrlReady(currentTunnelUrl);
      }

      // Notify any waiting callers
      while (urlReadyResolvers.length > 0) {
        const resolve = urlReadyResolvers.shift();
        resolve(currentTunnelUrl);
      }
    }
  };

  tunnelProcess.stdout.on('data', handleOutput);
  tunnelProcess.stderr.on('data', handleOutput);

  tunnelProcess.on('error', (err) => {
    console.error('[Tunnel Error]:', err.message);
  });

  tunnelProcess.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.warn(`[Tunnel] Process stopped with code ${code} (signal: ${signal})`);
    }
    tunnelProcess = null;
  });

  // Ensure child process is killed when Node exits
  const cleanup = () => {
    stopTunnel();
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('exit', cleanup);
}

/**
 * Stop the running tunnel process cleanly.
 */
function stopTunnel() {
  if (tunnelProcess && !tunnelProcess.killed) {
    try {
      if (process.platform === 'win32' && tunnelProcess.pid) {
        execSync(`taskkill /pid ${tunnelProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        tunnelProcess.kill('SIGINT');
      }
    } catch (e) {
      // Process might already be closed
    }
    tunnelProcess = null;
  }
}

module.exports = {
  startTunnel,
  stopTunnel,
  waitForTunnelUrl,
  shouldRunTunnel
};
