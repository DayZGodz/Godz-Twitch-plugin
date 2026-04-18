const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { exec } = require('child_process');
const url = require('url');
const querystring = require('querystring');

// Debug log to file (node20 stdout may not be captured)
const _logFile = path.join(os.homedir(), 'AppData', 'Roaming', 'spotify-plugin-debug.log');
function debugLog(...args) {
  const msg = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
  try { fs.appendFileSync(_logFile, msg); } catch(e) {}
  console.log(...args);
}

// Spotify Plugin Main Backend
class SpotifyPlugin {
  constructor() {
    this.settings = {};
    this.tokenRefreshInterval = null;
    this.settingsPath = path.join(os.homedir(), 'AppData', 'Roaming', 'stream-deck-spotify-plugin.json');
    this.loadSettings();
    this.authServer = null;
    this.lastAuthError = null;
    this.pendingCredentials = null;
    // Cache for action settings received from UI
    this.actionSettings = {
      volumeUp_increment: 10,
      volumeDown_decrement: 10,
      playPause_device_id: null,
      next_device_id: null,
      previous_device_id: null,
      volumeUp_device_id: null,
      volumeDown_device_id: null,
      volumeControl_device_id: null
    };

    // --- NOVO: Tentar renovar token automaticamente ao iniciar ---
    this.tryAutoRefreshToken();
  }

  async tryAutoRefreshToken() {
    // Se houver refresh_token salvo e access_token ausente ou expirado, tenta renovar
    if (this.settings && this.settings.refresh_token) {
      const expired = !this.settings.token_expiry || Date.now() > this.settings.token_expiry;
      if (!this.settings.access_token || expired) {
        try {
          await this.refreshAccessToken();
          debugLog('Access token renovado automaticamente ao iniciar.');
        } catch (e) {
          debugLog('Falha ao renovar access token automaticamente:', e.message);
        }
      }
    }
  }

  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        this.settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  saveSettings() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  /**
   * Update action settings from UI
   */
  updateActionSettings(key, value) {
    if (key && value !== undefined) {
      this.actionSettings[key] = value;
      console.log(`Updated action setting: ${key}=${value}`);
    }
  }

  /**
   * Get action setting value
   */
  getActionSetting(key, defaultValue = null) {
    return this.actionSettings[key] !== undefined ? this.actionSettings[key] : defaultValue;
  }

  /**
   * Auth status for PI polling
   */
  async getAuthStatus() {
    const hasToken = !!this.settings.access_token;
    const expired = !this.settings.token_expiry || Date.now() > this.settings.token_expiry;
    // Se está expirado mas tem refresh_token, tenta renovar ANTES de informar desconexão
    if (expired && this.settings.refresh_token) {
      try {
        await this.refreshAccessToken();
        // Após renovar, recarrega status
        const hasToken2 = !!this.settings.access_token;
        const expired2 = !this.settings.token_expiry || Date.now() > this.settings.token_expiry;
        return {
          authenticated: hasToken2 && !expired2,
          hasToken: hasToken2,
          expired: expired2,
          tokenExpiry: this.settings.token_expiry || null,
          lastError: this.lastAuthError,
          userProfile: this.settings.user_profile || null
        };
      } catch (e) {
        this.lastAuthError = e.message;
        // Cai para retorno padrão de desconectado
      }
    }
    return {
      authenticated: hasToken && !expired,
      hasToken,
      expired,
      tokenExpiry: this.settings.token_expiry || null,
      lastError: this.lastAuthError,
      userProfile: this.settings.user_profile || null
    };
  }

  async getUserProfile() {
    try {
      const profile = await this.spotifyApiRequest('/me');
      if (profile && typeof profile === 'object') {
        this.settings.user_profile = {
          display_name: profile.display_name || '',
          email: profile.email || '',
          id: profile.id || ''
        };
        this.saveSettings();
      }
      return this.settings.user_profile || null;
    } catch (error) {
      console.error('Error getting user profile:', error);
      throw error;
    }
  }

  async refreshAccessToken() {
    return new Promise((resolve, reject) => {
      if (!this.settings.refresh_token) {
        reject(new Error('No refresh token available'));
        return;
      }

      const postData = querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.settings.refresh_token,
        client_id: this.pendingCredentials?.clientId || this.settings.spotify_client_id,
        client_secret: this.pendingCredentials?.clientSecret || this.settings.spotify_client_secret
      });

      const options = {
        hostname: 'accounts.spotify.com',
        port: 443,
        path: '/api/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Accept-Encoding': 'identity'
        }
      };

      const req = https.request(options, (res) => {
        let stream = res;
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        const chunks = [];
        stream.on('data', (chunk) => { chunks.push(chunk); });
        stream.on('end', () => {
          try {
            const data = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode === 200 && parsed.access_token) {
              this.settings.access_token = parsed.access_token;
              if (parsed.refresh_token) {
                this.settings.refresh_token = parsed.refresh_token;
              }
              this.settings.token_expiry = Date.now() + ((parsed.expires_in || 3600) * 1000);
              this.saveSettings();
              this.getUserProfile()
                .catch(() => null)
                .finally(() => {
                  if (typeof this.broadcastAuthUpdate === 'function') {
                    this.broadcastAuthUpdate(this.getAuthStatus());
                  }
                  resolve(true);
                });
            } else {
              reject(new Error(parsed.error_description || parsed.error || 'Refresh token failed'));
            }
          } catch (error) {
            reject(error);
          }
        });
        stream.on('error', reject);
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }
  // Broadcast auth status to all connected Property Inspectors
  broadcastAuthUpdate(status) {
    // Sempre envia status atualizado para todos os PIs
    try {
      if (global && global.sdWebSocket && global.sdWebSocket.readyState === 1) {
        global.sdWebSocket.send(JSON.stringify({
          event: 'setGlobalSettings',
          payload: {
            ...status,
            authenticated: status.authenticated === true,
            lastError: status.lastError || null
          }
        }));
      }
    } catch (e) {
      debugLog('[broadcastAuthUpdate] Error broadcasting:', e.message);
    }
  }

  // Spotify API Helper
  async spotifyApiRequest(endpoint, method = 'GET', data = null, hasRetried = false) {
    return new Promise((resolve, reject) => {
      if (!this.settings.access_token) {
        reject(new Error('No access token available'));
        return;
      }

      const options = {
        hostname: 'api.spotify.com',
        port: 443,
        path: `/v1${endpoint}`,
        method: method,
        headers: {
          'Authorization': `Bearer ${this.settings.access_token}`,
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate, identity'
        }
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks);
            const encoding = (res.headers['content-encoding'] || '').toLowerCase();
            debugLog(`[API] ${method} ${endpoint} status=${res.statusCode} encoding="${encoding}" rawLen=${raw.length} hex=${raw.slice(0, 20).toString('hex')}`);
            const decompress = (buf) => {
              if (encoding === 'gzip') { debugLog('[API] decompress: gzip header'); return zlib.gunzipSync(buf); }
              if (encoding === 'deflate') { debugLog('[API] decompress: deflate header'); return zlib.inflateSync(buf); }
              if (encoding === 'br') { debugLog('[API] decompress: brotli header'); return zlib.brotliDecompressSync(buf); }
              // Auto-detect gzip by magic bytes (1f 8b)
              if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) { debugLog('[API] decompress: gzip magic bytes'); return zlib.gunzipSync(buf); }
              debugLog('[API] decompress: none (passthrough)');
              return buf;
            };
            const responseData = raw.length > 0 ? decompress(raw).toString('utf8') : '';
            debugLog(`[API] responseData first 120 chars: ${responseData.substring(0, 120)}`);
            if (res.statusCode === 200 || res.statusCode === 201 || res.statusCode === 204) {
              if (!responseData || responseData.length === 0) {
                resolve({});
              } else {
                try { resolve(JSON.parse(responseData)); }
                catch (_) { resolve({}); }
              }
            } else if (res.statusCode === 401) {
              reject(new Error('Token expired'));
            } else if (res.statusCode === 429) {
              const retryAfter = parseInt(res.headers['retry-after'] || '10', 10);
              reject(new Error(`Rate limited: retry after ${retryAfter}s`));
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${responseData.substring(0, 200)}`));
            }
          } catch (error) {
            reject(error);
          }
        });

        res.on('error', reject);
      });

      req.on('error', reject);

      if (data) {
        const jsonData = JSON.stringify(data);
        req.setHeader('Content-Length', Buffer.byteLength(jsonData));
        req.write(jsonData);
      }
      req.end();
    }).catch(async (error) => {
      if (error.message === 'Token expired' && !hasRetried) {
        await this.refreshAccessToken();
        return this.spotifyApiRequest(endpoint, method, data, true);
      }
      throw error;
    });
  }

  // Get available devices
  async getDevices() {
    const response = await this.spotifyApiRequest('/me/player/devices');
    return response.devices || [];
  }

  // Get user playlists (cached for 30s to speed up PI loading)
  _playlistsCache = null;
  _playlistsCacheTime = 0;
  async getPlaylists(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this._playlistsCache && (now - this._playlistsCacheTime) < 30000) {
      return this._playlistsCache;
    }
    try {
      const response = await this.spotifyApiRequest('/me/playlists?limit=50');
      this._playlistsCache = response.items || [];
      this._playlistsCacheTime = now;
      return this._playlistsCache;
    } catch (error) {
      console.error('Error getting playlists:', error);
      return this._playlistsCache || [];
    }
  }

  // Get current playback
  async getCurrentPlayback() {
    try {
      return await this.spotifyApiRequest('/me/player/currently-playing');
    } catch (error) {
      console.error('Error getting current playback:', error);
      return null;
    }
  }

  // Play/Pause
  async playPause(deviceId = null) {
    try {
      const current = await this.getCurrentPlayback();
      const endpoint = current?.is_playing ? '/me/player/pause' : '/me/player/play';
      const url = deviceId ? `${endpoint}?device_id=${deviceId}` : endpoint;
      await this.spotifyApiRequest(url, 'PUT');
      return { success: true };
    } catch (error) {
      console.error('Error toggling playback:', error);
      return { success: false, error: error.message };
    }
  }

  // Next track
  async nextTrack(deviceId = null) {
    try {
      const url = deviceId ? `/me/player/next?device_id=${deviceId}` : '/me/player/next';
      await this.spotifyApiRequest(url, 'POST');
      return { success: true };
    } catch (error) {
      console.error('Error skipping to next:', error);
      return { success: false, error: error.message };
    }
  }

  // Previous track
  async previousTrack(deviceId = null) {
    try {
      const url = deviceId ? `/me/player/previous?device_id=${deviceId}` : '/me/player/previous';
      await this.spotifyApiRequest(url, 'POST');
      return { success: true };
    } catch (error) {
      console.error('Error skipping to previous:', error);
      return { success: false, error: error.message };
    }
  }

  // Set volume
  async setVolume(percent, deviceId = null) {
    try {
      const volume = Math.max(0, Math.min(100, percent));
      const url = deviceId ? `/me/player/volume?volume_percent=${volume}&device_id=${deviceId}` : `/me/player/volume?volume_percent=${volume}`;
      await this.spotifyApiRequest(url, 'PUT');
      return { success: true };
    } catch (error) {
      console.error('Error setting volume:', error);
      return { success: false, error: error.message };
    }
  }

  // Increase volume by increment
  async increaseVolume(increment = 10, deviceId = null) {
    try {
      // Get devices to find current volume
      const devices = await this.getDevices();
      let currentVolume = 50; // Default if not found

      if (deviceId) {
        const device = devices.find(d => d.id === deviceId);
        if (device && device.volume_percent !== null) {
          currentVolume = device.volume_percent;
        }
      } else {
        // Find active device
        const activeDevice = devices.find(d => d.is_active);
        if (activeDevice && activeDevice.volume_percent !== null) {
          currentVolume = activeDevice.volume_percent;
        }
      }

      const newVolume = Math.min(100, currentVolume + increment);
      return await this.setVolume(newVolume, deviceId);
    } catch (error) {
      console.error('Error increasing volume:', error);
      return { success: false, error: error.message };
    }
  }

  // Decrease volume by decrement
  async decreaseVolume(decrement = 10, deviceId = null) {
    try {
      // Get devices to find current volume
      const devices = await this.getDevices();
      let currentVolume = 50; // Default if not found

      if (deviceId) {
        const device = devices.find(d => d.id === deviceId);
        if (device && device.volume_percent !== null) {
          currentVolume = device.volume_percent;
        }
      } else {
        // Find active device
        const activeDevice = devices.find(d => d.is_active);
        if (activeDevice && activeDevice.volume_percent !== null) {
          currentVolume = activeDevice.volume_percent;
        }
      }

      const newVolume = Math.max(0, currentVolume - decrement);
      return await this.setVolume(newVolume, deviceId);
    } catch (error) {
      console.error('Error decreasing volume:', error);
      return { success: false, error: error.message };
    }
  }

  // Play playlist
  async playPlaylist(playlistUri, deviceId = null) {
    try {
      const data = {
        context_uri: playlistUri,
        offset: { position: 0 },
        position_ms: 0
      };
      const url = deviceId ? `/me/player/play?device_id=${deviceId}` : '/me/player/play';
      await this.spotifyApiRequest(url, 'PUT', data);
      return { success: true };
    } catch (error) {
      console.error('Error playing playlist:', error);
      return { success: false, error: error.message };
    }
  }

  // Play URI
  async playUri(uri, deviceId = null) {
    try {
      const data = {
        uris: [uri],
        offset: { position: 0 },
        position_ms: 0
      };
      const url = deviceId ? `/me/player/play?device_id=${deviceId}` : '/me/player/play';
      await this.spotifyApiRequest(url, 'PUT', data);
      return { success: true };
    } catch (error) {
      console.error('Error playing URI:', error);
      return { success: false, error: error.message };
    }
  }

  // Add track to playlist
  async addToPlaylist(playlistId, trackUri) {
    try {
      await this.spotifyApiRequest(`/playlists/${playlistId}/items`, 'POST', {
        uris: [trackUri]
      });
      return { success: true };
    } catch (error) {
      console.error('Error adding to playlist:', error);
      return { success: false, error: error.message };
    }
  }

  // Remove track from playlist
  async removeFromPlaylist(playlistId, trackUri) {
    try {
      await this.spotifyApiRequest(`/playlists/${playlistId}/items`, 'DELETE', {
        items: [{ uri: trackUri }]
      });
      return { success: true };
    } catch (error) {
      console.error('Error removing from playlist:', error);
      return { success: false, error: error.message };
    }
  }

  // Transfer playback to device
  async transferPlayback(deviceId) {
    try {
      await this.spotifyApiRequest('/me/player', 'PUT', { device_ids: [deviceId] });
      return { success: true };
    } catch (error) {
      console.error('Error transferring playback:', error);
      return { success: false, error: error.message };
    }
  }

  // Check if tracks are saved in user's library
  async checkSavedTracks(trackIds) {
    try {
      return await this.spotifyApiRequest(`/me/tracks/contains?ids=${trackIds.join(',')}`);
    } catch (error) {
      console.error('Error checking saved tracks:', error);
      return [];
    }
  }

  // Save tracks to user's library
  async saveTracks(trackIds) {
    try {
      await this.spotifyApiRequest(`/me/tracks?ids=${trackIds.join(',')}`, 'PUT');
      return { success: true };
    } catch (error) {
      console.error('Error saving tracks:', error);
      return { success: false, error: error.message };
    }
  }

  // Remove tracks from user's library
  async removeSavedTracks(trackIds) {
    try {
      await this.spotifyApiRequest(`/me/tracks?ids=${trackIds.join(',')}`, 'DELETE');
      return { success: true };
    } catch (error) {
      console.error('Error removing saved tracks:', error);
      return { success: false, error: error.message };
    }
  }

  // Set repeat mode (off, context, track)
  async setRepeat(state) {
    await this.spotifyApiRequest(`/me/player/repeat?state=${state}`, 'PUT');
  }

  // Set shuffle mode
  async setShuffle(state) {
    await this.spotifyApiRequest(`/me/player/shuffle?state=${state}`, 'PUT');
  }

  // Get full player state (includes device, repeat, shuffle)
  async getPlayerState() {
    return await this.spotifyApiRequest('/me/player');
  }

  // Add track to queue
  async addToQueue(uri) {
    try {
      await this.spotifyApiRequest(`/me/player/queue?uri=${encodeURIComponent(uri)}`, 'POST');
      return { success: true };
    } catch (error) {
      console.error('Error adding to queue:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code, clientId, clientSecret) {
    return new Promise((resolve, reject) => {
      const postData = querystring.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'http://127.0.0.1:44580/callback',
        client_id: clientId,
        client_secret: clientSecret
      });

      const options = {
        hostname: 'accounts.spotify.com',
        port: 443,
        path: '/api/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'Accept-Encoding': 'identity'
        }
      };

      const req = https.request(options, (res) => {
        let stream = res;
        const enc = (res.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        const chunks = [];
        stream.on('data', (chunk) => { chunks.push(chunk); });
        stream.on('end', () => {
          try {
            const data = Buffer.concat(chunks).toString('utf8');
            const parsed = JSON.parse(data);
            if (res.statusCode === 200) {
              this.settings.access_token = parsed.access_token;
              this.settings.refresh_token = parsed.refresh_token;
              this.settings.token_expiry = Date.now() + (parsed.expires_in * 1000);
              this.lastAuthError = null;
              this.saveSettings();
              this.getUserProfile()
                .catch(() => null)
                .finally(() => {
                  if (typeof this.broadcastAuthUpdate === 'function') {
                    this.broadcastAuthUpdate(this.getAuthStatus());
                  }
                  resolve(parsed);
                });
            } else {
              reject(new Error(parsed.error_description || 'Token exchange failed'));
            }
          } catch (err) {
            reject(err);
          }
        });
        stream.on('error', reject);
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  /**
   * Open Spotify login in external browser
   */
  openSpotifyLogin(clientId, redirectUri) {
    const scopes = [
      'user-read-private',
      'user-read-email',
      'user-modify-playback-state',
      'user-read-playback-state',
      'user-read-currently-playing',
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-public',
      'playlist-modify-private'
    ];

    const params = querystring.stringify({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      show_dialog: 'true'
    });

    const authUrl = `https://accounts.spotify.com/authorize?${params}`;

    // Open in browser based on OS
    const platform = process.platform;
    let command;

    if (platform === 'win32') {
      command = `start "" "${authUrl}"`;
    } else if (platform === 'darwin') {
      command = `open "${authUrl}"`;
    } else if (platform === 'linux') {
      command = `xdg-open "${authUrl}"`;
    }

    if (command) {
      exec(command, (error) => {
        if (error) console.error('Error opening browser:', error);
      });
    }
  }

  /**
   * Start callback server to receive Spotify redirect
   */
  startCallbackServer(onCode) {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url, true);

      // CORS for PI requests to localhost endpoint
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (parsedUrl.pathname === '/start-auth' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const clientId = parsed.clientId;
            const clientSecret = parsed.clientSecret;

            if (!clientId || !clientSecret) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Missing clientId/clientSecret' }));
              return;
            }

            this.pendingCredentials = { clientId, clientSecret };
            this.settings.spotify_client_id = clientId;
            this.settings.spotify_client_secret = clientSecret;
            this.saveSettings();
            this.lastAuthError = null;
            this.openSpotifyLogin(clientId, 'http://localhost:8888/callback');

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message }));
          }
        });
        return;
      }

      if (parsedUrl.pathname === '/auth-status') {
        this.getAuthStatus().then((status) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status));
        });
        return;
      }

      if (parsedUrl.pathname === '/devices' && req.method === 'GET') {
        if (!this.settings.access_token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No access token available', devices: [] }));
          return;
        }

        this.spotifyApiRequest('/me/player/devices')
          .then((response) => {
            const devices = response?.devices || [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, devices }));
          })
          .catch((error) => {
            const statusCode = error.message && error.message.includes('Token expired') ? 401 : 500;
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message, devices: [] }));
          });
        return;
      }

      if (parsedUrl.pathname === '/user-profile' && req.method === 'GET') {
        if (!this.settings.access_token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No access token available', userProfile: null }));
          return;
        }

        this.getUserProfile()
          .then((userProfile) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, userProfile: userProfile || null }));
          })
          .catch((error) => {
            const statusCode = error.message && error.message.includes('Token expired') ? 401 : 500;
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: error.message, userProfile: null }));
          });
        return;
      }
      
      // Accept callback at root '/' or '/callback' (Spotify redirects to the exact registered URI)
      const isCallback = parsedUrl.pathname === '/' || parsedUrl.pathname === '/callback' || parsedUrl.pathname === '';
      if (isCallback && (parsedUrl.query.code || parsedUrl.query.error)) {
        const code = parsedUrl.query.code;
        const error = parsedUrl.query.error;

        if (error) {
          this.lastAuthError = error;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>❌ Erro</h1><p>${error}</p><p>Você pode fechar esta janela.</p>`);
          if (onCode) onCode(null, error);
        } else if (code) {
          // Try multiple sources for credentials: memory, settings file, state param
          let creds = this.pendingCredentials;
          if (!creds?.clientId || !creds?.clientSecret) {
            creds = {
              clientId: this.settings.spotify_client_id,
              clientSecret: this.settings.spotify_client_secret
            };
          }
          // Fallback: decode from state parameter (base64 JSON with cid/cs)
          if ((!creds?.clientId || !creds?.clientSecret) && parsedUrl.query.state) {
            try {
              const stateJson = Buffer.from(parsedUrl.query.state, 'base64').toString('utf8');
              const stateData = JSON.parse(stateJson);
              if (stateData.cid && stateData.cs) {
                creds = { clientId: stateData.cid, clientSecret: stateData.cs };
                // Save for future use
                this.settings.spotify_client_id = creds.clientId;
                this.settings.spotify_client_secret = creds.clientSecret;
                this.saveSettings();
                console.log('[SpotifyPlugin] Recovered credentials from state parameter');
              }
            } catch (e) {
              console.error('[SpotifyPlugin] Failed to decode state:', e.message);
            }
          }
          if (!creds?.clientId || !creds?.clientSecret) {
            this.lastAuthError = 'Missing pending credentials';
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h1>❌ Erro</h1><p>Credenciais não encontradas. Inicie o login novamente.</p>');
            if (onCode) onCode(null, this.lastAuthError);
            return;
          }

          this.exchangeCodeForToken(code, creds.clientId, creds.clientSecret)
            .then(() => {
              this.pendingCredentials = null;
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Autorizado</title>
<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;
background:linear-gradient(135deg,#1db954,#191414);font-family:sans-serif;color:#fff}
.card{background:rgba(255,255,255,.1);backdrop-filter:blur(10px);border-radius:16px;
padding:48px 56px;text-align:center;max-width:400px}
.icon{font-size:64px;margin-bottom:16px}h1{font-size:24px;font-weight:700;margin:0 0 8px}
p{opacity:.8;margin:0;font-size:15px}</style></head>
<body><div class="card"><div class="icon">&#9989;</div>
<h1>Autorizado com sucesso!</h1>
<p>Pode fechar esta janela e voltar ao plugin.</p>
</div></body></html>`);
              if (onCode) onCode(code, null);
            })
            .catch((err) => {
              this.lastAuthError = err.message;
              res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<h1>❌ Erro</h1><p>${err.message}</p><p>Tente novamente.</p>`);
              if (onCode) onCode(null, err.message);
            });
        } else {
          res.writeHead(200);
          res.end('Aguardando autorização...');
        }
      } else {
        res.writeHead(200);
        res.end('OK');
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error('[SpotifyPlugin] Port 44580 already in use! Callback server could not start.');
      } else {
        console.error('[SpotifyPlugin] Callback server error:', err.message);
      }
    });

    server.listen(44580, '0.0.0.0', () => {
      console.log('Callback server listening on http://localhost:44580');
    });

    return server;
  }

  /**
   * Fetch an image from URL and return as base64 data URI
   */
  fetchImageAsBase64(imageUrl) {
    return new Promise((resolve, reject) => {
      const proto = imageUrl.startsWith('https') ? https : http;
      proto.get(imageUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this.fetchImageAsBase64(res.headers.location).then(resolve).catch(reject);
        }
        const contentType = res.headers['content-type'] || 'image/jpeg';
        debugLog('[fetchImage] Content-Type:', contentType, 'status:', res.statusCode);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          debugLog('[fetchImage] Downloaded', buf.length, 'bytes');
          resolve('data:' + contentType + ';base64,' + buf.toString('base64'));
        });
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Format milliseconds to mm:ss
   */
  formatTime(ms) {
    if (!ms || ms < 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  /**
   * Build title string based on format setting
   */
  buildTitle(track, format) {
    const title = track?.name || '';
    const artist = (track?.artists || []).map(a => a.name).join(', ') || '';
    switch (format) {
      case 'artist': return artist;
      case 'artist-title': return artist ? `${artist} - ${title}` : title;
      case 'title-artist': return artist ? `${title} - ${artist}` : title;
      case 'title': default: return title;
    }
  }
}

// Initialize plugin
const plugin = new SpotifyPlugin();

// Start local auth server once
plugin.authServer = plugin.startCallbackServer((code, error) => {
  if (error) {
    console.error('Authorization error:', error);
    return;
  }
  if (code) {
    console.log('Authorization code handled successfully');
  }
});

// Export handlers for Stream Deck
module.exports = {
  plugin,
  handlers: {
    playpause: async (context, action) => {
      const current = await plugin.getPlayerState();
      if (current && current.is_playing) {
        await plugin.spotifyApiRequest('/me/player/pause', 'PUT');
      } else {
        if (action.device_id) await plugin.transferPlayback(action.device_id);
        await plugin.spotifyApiRequest('/me/player/play', 'PUT');
      }
      return { success: true };
    },
    next: async () => {
      await plugin.spotifyApiRequest('/me/player/next', 'POST');
      return { success: true };
    },
    previous: async () => {
      await plugin.spotifyApiRequest('/me/player/previous', 'POST');
      return { success: true };
    },
    changedevice: async (context, action) => {
      if (!action.device_id) return { success: false, error: 'No device selected' };
      await plugin.transferPlayback(action.device_id);
      return { success: true };
    },
    likesong: async (context, action) => {
      const pb = await plugin.getCurrentPlayback();
      if (!pb || !pb.item) return { success: false, error: 'Nothing playing' };
      const trackId = pb.item.id;
      const saved = await plugin.checkSavedTracks([trackId]);
      if (saved[0]) {
        await plugin.removeSavedTracks([trackId]);
        return { success: true, liked: false };
      } else {
        await plugin.saveTracks([trackId]);
        return { success: true, liked: true };
      }
    },
    playuri: async (context, action) => {
      if (!action.uri) return { success: false, error: 'No URI' };
      // Parse position from URI hash (e.g., spotify:track:xxx#1:30)
      let cleanUri = action.uri;
      let position_ms = 0;
      const timeMatch = cleanUri.match(/#(\d{1,2}):(\d{2})$/);
      if (timeMatch) {
        position_ms = (parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2])) * 1000;
        cleanUri = cleanUri.replace(/#.*$/, '');
      }
      if (action.device_id) await plugin.transferPlayback(action.device_id);
      if (action.playOption === 'queue') {
        await plugin.addToQueue(cleanUri);
      } else {
        const data = { uris: [cleanUri] };
        if (position_ms > 0) data.position_ms = position_ms;
        await plugin.spotifyApiRequest('/me/player/play', 'PUT', data);
      }
      return { success: true };
    },
    playplaylist: async (context, action) => {
      debugLog(`[playplaylist] settings keys: ${Object.keys(action).join(', ')}`);
      const uri = action.uri || action.playPlaylist_uri || action.playlist_uri;
      if (!uri) return { success: false, error: 'No playlist selected' };
      const deviceId = action.device_id || action.playPlaylist_device_id;
      debugLog(`[playplaylist] uri=${uri} deviceId=${deviceId}`);
      if (deviceId) await plugin.transferPlayback(deviceId);
      await plugin.spotifyApiRequest('/me/player/play', 'PUT', { context_uri: uri });
      return { success: true };
    },
    addtoplaylist: async (context, action) => {
      debugLog(`[addtoplaylist] settings keys: ${Object.keys(action).join(', ')}`);
      const pb = await plugin.getCurrentPlayback();
      if (!pb || !pb.item) return { success: false, error: 'Nothing playing' };
      const trackUri = pb.item.uri;
      const playlistId = action.playlist_id || action.addToPlaylist_id;
      debugLog(`[addtoplaylist] trackUri=${trackUri} playlistId=${playlistId}`);
      if (!playlistId) return { success: false, error: 'No playlist selected' };
      await plugin.spotifyApiRequest(`/playlists/${playlistId}/items`, 'POST', { uris: [trackUri] });
      debugLog(`[addtoplaylist] Successfully added ${trackUri} to ${playlistId}`);
      return { success: true };
    },
    removeplaylistsong: async (context, action) => {
      debugLog(`[removeplaylistsong] settings keys: ${Object.keys(action).join(', ')}`);
      const pb = await plugin.getCurrentPlayback();
      if (!pb || !pb.item) return { success: false, error: 'Nothing playing' };
      const trackUri = pb.item.uri;
      const playlistId = action.playlist_id || action.removePlaylistSong_id;
      debugLog(`[removeplaylistsong] trackUri=${trackUri} playlistId=${playlistId}`);
      if (!playlistId) return { success: false, error: 'No playlist selected' };
      await plugin.spotifyApiRequest(`/playlists/${playlistId}/items`, 'DELETE', { items: [{ uri: trackUri }] });
      debugLog(`[removeplaylistsong] Successfully removed ${trackUri} from ${playlistId}`);
      if (pb.is_playing) await plugin.spotifyApiRequest('/me/player/next', 'POST');
      return { success: true };
    },
    repeat: async () => {
      const state = await plugin.getPlayerState();
      if (!state) return { success: false, error: 'No playback' };
      const map = { off: 'context', context: 'track', track: 'off' };
      const next = map[state.repeat_state] || 'off';
      try {
        await plugin.setRepeat(next);
      } catch (err) {
        if (err.message && err.message.includes('403') && state.device && state.context) {
          // Spotify desktop in stale state — re-init playback to clear restriction
          const body = { context_uri: state.context.uri };
          if (state.item) body.offset = { uri: state.item.uri };
          if (state.progress_ms) body.position_ms = state.progress_ms;
          await plugin.spotifyApiRequest(`/me/player/play?device_id=${state.device.id}`, 'PUT', body);
          await new Promise(r => setTimeout(r, 500));
          await plugin.setRepeat(next);
        } else { throw err; }
      }
      const stateMap = { off: 0, context: 1, track: 2 };
      return { success: true, repeatState: next, state: stateMap[next] };
    },
    shuffle: async () => {
      const state = await plugin.getPlayerState();
      if (!state) return { success: false, error: 'No playback' };
      const newState = !state.shuffle_state;
      try {
        await plugin.setShuffle(newState);
      } catch (err) {
        if (err.message && err.message.includes('403') && state.device && state.context) {
          // Spotify desktop in stale state — re-init playback to clear restriction
          const body = { context_uri: state.context.uri };
          if (state.item) body.offset = { uri: state.item.uri };
          if (state.progress_ms) body.position_ms = state.progress_ms;
          await plugin.spotifyApiRequest(`/me/player/play?device_id=${state.device.id}`, 'PUT', body);
          await new Promise(r => setTimeout(r, 500));
          await plugin.setShuffle(newState);
        } else { throw err; }
      }
      return { success: true, shuffleState: newState, state: newState ? 1 : 0 };
    },
    songinfo: async (context, action) => {
      const pb = await plugin.getCurrentPlayback();
      if (!pb || !pb.item) return { success: false, error: 'Nothing playing' };
      const item = pb.item;
      const artists = (item.artists || []).map(a => a.name).join(', ');
      const mode = action.mode || 'title-artist';
      let text;
      switch (mode) {
        case 'title': text = item.name; break;
        case 'artist': text = artists; break;
        case 'artist-title': text = `${artists} - ${item.name}`; break;
        case 'uri': text = item.uri; break;
        case 'url': text = item.external_urls?.spotify || ''; break;
        case 'title-artist': default: text = `${item.name} - ${artists}`; break;
      }
      // Copy to clipboard on Windows
      try {
        require('child_process').execSync(`echo|set /p="${text.replace(/"/g, '\\"')}" | clip`, { shell: 'cmd.exe' });
      } catch (e) { debugLog('[songinfo] clipboard error:', e.message); }
      return { success: true, text };
    },
    volumeup: async (context, action) => {
      const step = action.step || 10;
      const state = await plugin.getPlayerState();
      const currentVol = state?.device?.volume_percent ?? 50;
      const newVol = Math.min(100, currentVol + step);
      await plugin.setVolume(newVol, action.device_id);
      return { success: true, volume: newVol };
    },
    volumedown: async (context, action) => {
      const step = action.step || 10;
      const state = await plugin.getPlayerState();
      const currentVol = state?.device?.volume_percent ?? 50;
      const newVol = Math.max(0, currentVol - step);
      await plugin.setVolume(newVol, action.device_id);
      return { success: true, volume: newVol };
    },
    volumecontrol: async (context, action) => {
      // When pressed as button: mute/unmute toggle
      const state = await plugin.getPlayerState();
      const currentVol = state?.device?.volume_percent ?? 50;
      if (currentVol === 0) {
        const restoreVol = plugin._lastMuteVolume || 50;
        await plugin.setVolume(restoreVol, action.device_id);
        return { success: true, muted: false, volume: restoreVol, state: 0 };
      } else {
        plugin._lastMuteVolume = currentVol;
        await plugin.setVolume(0, action.device_id);
        return { success: true, muted: true, volume: 0, state: 1 };
      }
    },
    mute: async (context, action) => {
      const state = await plugin.getPlayerState();
      const currentVol = state?.device?.volume_percent ?? 50;
      if (currentVol === 0) {
        // Unmute - restore previous volume
        const restoreVol = plugin._lastMuteVolume || 50;
        await plugin.setVolume(restoreVol);
        return { success: true, muted: false, volume: restoreVol, state: 0 };
      } else {
        // Mute - save current volume and set to 0
        plugin._lastMuteVolume = currentVol;
        await plugin.setVolume(0);
        return { success: true, muted: true, volume: 0, state: 1 };
      }
    },
    updateactionsetting: (context, action) => {
      plugin.updateActionSettings(action.key, action.value);
      return { success: true };
    },
    startspotifyoauth: (context, action) => {
      if (!action.clientId || !action.clientSecret) {
        return { success: false, error: 'Missing clientId/clientSecret' };
      }
      plugin.pendingCredentials = {
        clientId: action.clientId,
        clientSecret: action.clientSecret
      };
      plugin.settings.spotify_client_id = action.clientId;
      plugin.settings.spotify_client_secret = action.clientSecret;
      plugin.saveSettings();
      plugin.lastAuthError = null;
      return { success: true };
    },
    authstatus: () => plugin.getAuthStatus(),
    getdevices: async () => {
      try {
        return { devices: await plugin.getDevices(), error: null };
      } catch (error) {
        return { devices: [], error: error.message || 'Failed to fetch devices' };
      }
    },
    getuserprofile: async () => {
      try {
        return { userProfile: await plugin.getUserProfile(), error: null };
      } catch (error) {
        return { userProfile: null, error: error.message || 'Failed to fetch user profile' };
      }
    },
    getplaylists: async () => {
      return { playlists: await plugin.getPlaylists() };
    },
    getcurrentplayback: async () => {
      return await plugin.getCurrentPlayback();
    }
  }
};

// ============================================================
// RISE MODE / STREAM DECK WEBSOCKET CONNECTION
// Minimal WS client using only Node.js built-ins (net + crypto)
// ============================================================
(function startSDConnection() {
  const _net    = require('net');
  const _crypto = require('crypto');
  const _h      = module.exports.handlers;

  const sdPort  = process.argv[3];
  const sdUUID  = process.argv[5];
  const sdEvent = process.argv[7] || 'registerPlugin';

  if (!sdPort || !sdUUID) {
    console.warn('[SpotifyPlugin] No SD port/UUID — standalone mode (no WS)');
    return;
  }

  let sock     = null;
  let upgraded = false;
  let rxBuf    = Buffer.alloc(0);

  // ---- send a masked TEXT frame ----
  function sendText(text) {
    if (!sock || sock.destroyed || !upgraded) { debugLog('[WS] sendText: socket not ready'); return; }
    const data = Buffer.from(text, 'utf8');
    const mkey = _crypto.randomBytes(4);
    const body = Buffer.allocUnsafe(data.length);
    for (let i = 0; i < data.length; i++) body[i] = data[i] ^ mkey[i % 4];

    let hdr;
    if (data.length < 126) {
      hdr = Buffer.from([0x81, 0x80 | data.length]);
    } else if (data.length < 65536) {
      hdr = Buffer.alloc(4);
      hdr[0] = 0x81; hdr[1] = 0xfe;
      hdr.writeUInt16BE(data.length, 2);
    } else {
      hdr = Buffer.alloc(10);
      hdr[0] = 0x81; hdr[1] = 0xff;
      hdr.writeUInt32BE(0, 2); hdr.writeUInt32BE(data.length, 6);
    }
    sock.write(Buffer.concat([hdr, mkey, body]));
  }

  // ---- send pong frame ----
  function sendPong(pl) {
    if (!sock || sock.destroyed) return;
    const mkey = _crypto.randomBytes(4);
    const body = Buffer.allocUnsafe(pl.length);
    for (let i = 0; i < pl.length; i++) body[i] = pl[i] ^ mkey[i % 4];
    sock.write(Buffer.concat([Buffer.from([0x8a, 0x80 | Math.min(pl.length, 125)]), mkey, body]));
  }

  // ---- sendToPropertyInspector helper ----
  function sendToPI(context, action, payload) {
    const keys = payload ? Object.keys(payload) : [];
    debugLog(`[sendToPI] action=${action} context=${context} keys=${keys.join(',')}`);
    sendText(JSON.stringify({ event: 'sendToPropertyInspector', action, context, payload }));
  }

  // ---- SD helpers: setImage, setTitle, setState, showOk, showAlert ----
  function sdSetImage(context, base64DataUri) {
    const msg = JSON.stringify({ event: 'setImage', context, payload: { image: base64DataUri, target: 0, state: 0 } });
    sendText(msg);
  }
  function sdSetTitle(context, title) {
    sendText(JSON.stringify({ event: 'setTitle', context, payload: { title, target: 0, state: 0 } }));
  }
  function sdSetState(context, state) {
    sendText(JSON.stringify({ event: 'setState', context, payload: { state } }));
  }
  function sdShowOk(context) {
    sendText(JSON.stringify({ event: 'showOk', context }));
  }
  function sdShowAlert(context) {
    sendText(JSON.stringify({ event: 'showAlert', context }));
  }

  // ---- Playlist cover image helper ----
  async function updatePlaylistCover(context, settings, actionKey) {
    debugLog(`[Cover] updatePlaylistCover called: actionKey=${actionKey} settings=${JSON.stringify(settings)}`);
    if (!settings) { debugLog('[Cover] No settings, skip'); return; }
    const showCover = settings.showCover;
    if (showCover === false) {
      debugLog('[Cover] showCover=false, clearing image');
      sdSetImage(context, '');
      return;
    }
    // For playplaylist, the identifier is a URI (spotify:playlist:ID)
    // For add/remove, the identifier is a playlist_id directly
    let playlistId = null;
    if (actionKey === 'playplaylist') {
      const uri = settings.uri || settings.playPlaylist_uri || settings.playlist_uri;
      debugLog(`[Cover] playplaylist uri=${uri}`);
      if (uri) playlistId = uri.split(':').pop();
    } else {
      playlistId = settings.playlist_id || settings.addToPlaylist_id || settings.removePlaylistSong_id;
      debugLog(`[Cover] playlist_id=${playlistId}`);
    }
    if (!playlistId) { debugLog('[Cover] No playlistId found, skip'); return; }
    if (!showCover && showCover !== undefined) { debugLog('[Cover] showCover falsy but defined, skip'); return; }

    try {
      debugLog(`[Cover] Fetching playlist images for ${playlistId}...`);
      const playlistData = await plugin.spotifyApiRequest(`/playlists/${playlistId}?fields=images`);
      if (playlistData?.images && playlistData.images.length > 0) {
        const imageUrl = playlistData.images[0].url;
        debugLog(`[Cover] Fetching image from ${imageUrl}`);
        const base64 = await plugin.fetchImageAsBase64(imageUrl);
        debugLog(`[Cover] Set cover for ${actionKey} playlist=${playlistId} (${base64 ? base64.length : 0} chars)`);
        sdSetImage(context, base64);
      } else {
        debugLog(`[Cover] No images found for playlist ${playlistId}`);
      }
    } catch (e) {
      debugLog(`[Cover] Failed to fetch cover for ${playlistId}:`, e.message);
    }
  }

  // ============================================================
  // SHARED STATE CACHE — single poll serves all consumers
  // ============================================================
  let _sharedState = null;       // last fetched full player state (GET /me/player)
  let _sharedStateFetching = false;
  let _sharedStateTime = 0;
  let _rateLimitedUntil = 0;     // timestamp — don't fetch before this
  const _STATE_TTL = 2500;       // ms — re-fetch at most once per 2.5s

  async function getSharedState(forceRefresh = false) {
    const now = Date.now();
    if (now < _rateLimitedUntil) return _sharedState; // back off
    if (!forceRefresh && _sharedState !== undefined && (now - _sharedStateTime) < _STATE_TTL) {
      return _sharedState;
    }
    if (_sharedStateFetching) return _sharedState; // return stale while fetching
    _sharedStateFetching = true;
    try {
      _sharedState = await plugin.getPlayerState();
      _sharedStateTime = Date.now();
    } catch (e) {
      if (e.message && e.message.startsWith('Rate limited')) {
        const match = e.message.match(/(\d+)s/);
        const retryAfterSec = match ? parseInt(match[1], 10) : 15;
        const waitMs = Math.min(retryAfterSec * 1000, 60000); // cap at 60s
        _rateLimitedUntil = Date.now() + waitMs;
        debugLog(`[Cache] Rate limited, backing off ${Math.round(waitMs / 1000)}s (server said ${retryAfterSec}s)`);
      }
      // keep stale state
    }
    _sharedStateFetching = false;
    return _sharedState;
  }

  // ============================================================
  // PLAYBACK MONITOR — polls Spotify, updates playpause buttons
  // ============================================================
  const activePlayPauseButtons = new Map(); // context → { action, settings }
  let lastTrackId = null;
  let cachedArtBase64 = null;
  let playbackPollTimer = null;
  const scrollState = new Map(); // context → { text, trackId }

  // Rotate text by 1 character for marquee effect
  function getLoopText(t) { return t.slice(1) + t.slice(0, 1); }

  function startPlaybackMonitor() {
    if (playbackPollTimer) { debugLog('[Monitor] Already running, skip'); return; }
    debugLog('[Monitor] Starting playback monitor interval');
    playbackPollTimer = setInterval(async () => {
      if (activePlayPauseButtons.size === 0) return;
      if (!plugin.settings.access_token) return;
      try {
        const pb = await getSharedState();
        if (!pb || !pb.item) {
          // Nothing playing — clear buttons
          for (const [ctx] of activePlayPauseButtons) {
            sdSetTitle(ctx, '');
          }
          return;
        }
        const track = pb.item;
        const progress = pb.progress_ms || 0;
        const duration = track.duration_ms || 0;

        // Fetch album art if track changed
        const trackId = track.id || track.uri;
        // Use 300x300 image (index 1) instead of 640x640 (index 0) for smaller payload
        const images = track.album?.images || [];
        const artUrl = (images[1] || images[0] || {}).url;
        if (trackId !== lastTrackId && artUrl) {
          try {
            cachedArtBase64 = await plugin.fetchImageAsBase64(artUrl);
            lastTrackId = trackId;
            debugLog('[Monitor] Fetched album art, length:', cachedArtBase64 ? cachedArtBase64.length : 0);
          } catch (e) {
            debugLog('[Monitor] Failed to fetch album art:', e.message);
          }
        }

        // Update each active playpause button
        for (const [ctx, info] of activePlayPauseButtons) {
          const s = info.settings || {};
          const timeDisplay = s.timeDisplay || 'elapsed';
          const showTitle = s.showTitle !== false;
          const titleFormat = s.titleFormat || 'title-artist';

          // Build time string
          const timeStr = timeDisplay === 'remaining'
            ? '-' + plugin.formatTime(duration - progress)
            : plugin.formatTime(progress);

          // Build title text with scrolling
          let titleText = '';
          if (showTitle) {
            const fullTitle = plugin.buildTitle(track, titleFormat) + '   ';
            const ss = scrollState.get(ctx);
            if (!ss || ss.trackId !== trackId) {
              // New track or first time — set initial text
              scrollState.set(ctx, { text: fullTitle, trackId });
              titleText = fullTitle;
            } else {
              // Scroll existing text
              ss.text = getLoopText(ss.text);
              titleText = ss.text;
            }
          }

          // Create SVG overlay (matching Mirabox format)
          if (cachedArtBase64) {
            const isPlaying = pb.is_playing;
            const svg = `
<svg width="144" height="144" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <defs>
        <filter id="brightness">
            <feComponentTransfer>
                <feFuncR type="linear" slope="${isPlaying ? '1' : '0.5'}"/>
                <feFuncG type="linear" slope="${isPlaying ? '1' : '0.5'}"/>
                <feFuncB type="linear" slope="${isPlaying ? '1' : '0.5'}"/>
            </feComponentTransfer>
        </filter>
        <filter id="textShadow">
            <feDropShadow dx="2" dy="2" stdDeviation="2" flood-color="black" flood-opacity="1"/>
        </filter>
    </defs>
    <image xlink:href="${cachedArtBase64}" width="144" height="144" filter="url(#brightness)"/>
    <text x="72" y="44" font-family="Arial" font-weight="bold" font-size="36" fill="white" text-anchor="middle"
        stroke="black" stroke-width="2" paint-order="stroke" filter="url(#textShadow)">
        ${titleText}
    </text>
    <text x="72" y="130" font-family="Arial" font-weight="bold" font-size="40" fill="white" text-anchor="middle"
        stroke="black" stroke-width="2" paint-order="stroke" filter="url(#textShadow)">
        ${timeStr}
    </text>
</svg>`;
            const svgUri = 'data:image/svg+xml;charset=utf8,' + svg;
            sdSetImage(ctx, svgUri);
          } else {
            debugLog('[Monitor] No cached art, skip image');
          }

          // Also set native title (empty since we're rendering in SVG)
          sdSetTitle(ctx, '');
        }
      } catch (err) {
        debugLog('[Monitor] Playback poll error:', err.message);
      }
    }, 2000);
  }

  function stopPlaybackMonitor() {
    if (playbackPollTimer) {
      clearInterval(playbackPollTimer);
      playbackPollTimer = null;
    }
  }

  // ============================================================
  // POLLING MONITORS for buttons that need state updates
  // ============================================================
  const buttonPollers = {}; // context → intervalId (for volume/like/repeat/shuffle/mute)
  const buttonSettings = new Map(); // context → { action, settings, device_id }
  const muteLastVolume = {}; // context → last volume before mute

  function startButtonPoller(ctx, actionKey) {
    if (buttonPollers[ctx]) return;
    buttonPollers[ctx] = setInterval(async () => {
      if (!plugin.settings.access_token) return;
      try {
        const state = await getSharedState();
        if (!state) return;

        switch (actionKey) {
          case 'likesong': {
            if (state.item) {
              const saved = await plugin.checkSavedTracks([state.item.id]);
              sdSetState(ctx, saved[0] ? 1 : 0);
            }
            break;
          }
          case 'repeat': {
            const map = { off: 0, context: 1, track: 2 };
            sdSetState(ctx, map[state.repeat_state] ?? 0);
            break;
          }
          case 'shuffle': {
            sdSetState(ctx, state.shuffle_state ? 1 : 0);
            break;
          }
          case 'volumeup':
          case 'volumedown': {
            const info = buttonSettings.get(ctx);
            if (info?.settings?.show !== false && state.device) {
              sdSetTitle(ctx, String(state.device.volume_percent));
            }
            break;
          }
          case 'volumecontrol': {
            const info = buttonSettings.get(ctx);
            if (info?.settings?.show !== false && state.device) {
              sdSetTitle(ctx, String(state.device.volume_percent));
            }
            break;
          }
          case 'mute': {
            if (state.device) {
              sdSetState(ctx, state.device.volume_percent === 0 ? 1 : 0);
              const info = buttonSettings.get(ctx);
              if (info?.settings?.show !== false) {
                sdSetTitle(ctx, String(state.device.volume_percent));
              }
            }
            break;
          }
        }
      } catch (e) { /* silently ignore polling errors */ }
    }, 3000);
  }

  function stopButtonPoller(ctx) {
    if (buttonPollers[ctx]) {
      clearInterval(buttonPollers[ctx]);
      delete buttonPollers[ctx];
    }
  }

  // Actions that need polling for state updates
  const polledActions = ['likesong', 'repeat', 'shuffle', 'volumeup', 'volumedown', 'volumecontrol', 'mute'];

  // ---- find handler (case-insensitive key) ----
  function findHandler(key) {
    if (_h[key]) return _h[key];
    for (const k of Object.keys(_h)) {
      if (k.toLowerCase() === key) return _h[k];
    }
    return null;
  }

  // ---- process an incoming WS text message ----
  async function handleSDMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    const { event, context, action, payload = {} } = msg;

    debugLog('[WS] Received event:', event, 'action:', action);

    const actionKey = (action || '').split('.').pop().toLowerCase();

    // ---- willAppear: track button lifecycle ----
    if (event === 'willAppear') {
      const settings = payload?.settings || {};
      buttonSettings.set(context, { action, settings });

      if (actionKey === 'playpause') {
        activePlayPauseButtons.set(context, { action, settings });
        debugLog('[Monitor] playpause willAppear, active buttons:', activePlayPauseButtons.size);
        startPlaybackMonitor();
      }
      // Restore playlist cover on startup
      if (['playplaylist', 'addtoplaylist', 'removeplaylistsong'].includes(actionKey)) {
        updatePlaylistCover(context, settings, actionKey).catch(e => debugLog(`[Cover] willAppear error:`, e.message));
      }
      // Start pollers for stateful buttons
      if (polledActions.includes(actionKey)) {
        startButtonPoller(context, actionKey);
      }
    }

    // ---- willDisappear: clean up ----
    if (event === 'willDisappear') {
      buttonSettings.delete(context);

      if (actionKey === 'playpause') {
        activePlayPauseButtons.delete(context);
        debugLog('[Monitor] playpause willDisappear, active buttons:', activePlayPauseButtons.size);
        if (activePlayPauseButtons.size === 0) stopPlaybackMonitor();
      }
      stopButtonPoller(context);
    }

    // ---- didReceiveSettings: update stored settings ----
    if (event === 'didReceiveSettings') {
      const settings = payload?.settings || {};
      debugLog(`[didReceiveSettings] ${actionKey} keys=${Object.keys(settings).join(',')}`);
      if (['playplaylist', 'addtoplaylist', 'removeplaylistsong'].includes(actionKey)) {
        debugLog(`[didReceiveSettings] ${actionKey} uri=${settings.uri} playlist_id=${settings.playlist_id} device_id=${settings.device_id} showCover=${settings.showCover}`);
      }
      buttonSettings.set(context, { action, settings });
      if (actionKey === 'playpause' && activePlayPauseButtons.has(context)) {
        activePlayPauseButtons.set(context, { action, settings });
      }
      // Playlist cover image: fetch and set when showCover + uri/playlist_id
      if (['playplaylist', 'addtoplaylist', 'removeplaylistsong'].includes(actionKey)) {
        updatePlaylistCover(context, settings, actionKey).catch(e => debugLog(`[Cover] error:`, e.message));
      }
    }

    // ---- propertyInspectorDidAppear: send data to PI ----
    if (event === 'propertyInspectorDidAppear') {
      debugLog(`[PI] propertyInspectorDidAppear for ${actionKey} context=${context}`);
      try {
        if (['playpause', 'changedevice', 'playuri'].includes(actionKey)) {
          const devices = await plugin.getDevices();
          debugLog(`[PI] Sending ${devices?.length || 0} devices to ${actionKey}`);
          sendToPI(context, action, { devices });
        }
        if (['playplaylist', 'removeplaylistsong', 'addtoplaylist'].includes(actionKey)) {
          const [devices, playlists] = await Promise.all([plugin.getDevices(), plugin.getPlaylists()]);
          const mapped = playlists.map(p => ({ id: p.id, name: p.name, uri: p.uri, owner: p.owner?.display_name, tracks: { total: p.tracks?.total || 0 } }));
          debugLog(`[PI] Sending ${devices?.length || 0} devices + ${mapped?.length || 0} playlists to ${actionKey}`);
          sendToPI(context, action, { devices, playlists: mapped });
        }
      } catch (e) {
        debugLog(`[PI] propertyInspectorDidAppear error for ${actionKey}:`, e.message);
      }
    }

    // ---- keyUp: button press ----
    if (event === 'keyUp') {
      debugLog(`[WS] keyUp action="${action}" -> key="${actionKey}" payload.settings=${JSON.stringify(payload?.settings)} stored=${JSON.stringify(buttonSettings.get(context)?.settings)}`);
      const fn = findHandler(actionKey);
      if (fn) {
        try {
          const settings = payload?.settings || {};
          const stored = buttonSettings.get(context)?.settings || {};
          const merged = { ...settings, ...stored, device_id: stored.device_id || settings.device_id || settings.deviceId || null };
          const result = await fn(context, merged);
          debugLog(`[WS] keyUp handler "${actionKey}" returned:`, JSON.stringify(result)?.substring(0, 300));

          // Invalidate shared cache after any action so pollers get fresh data
          _sharedStateTime = 0;

          // Update button state based on result
          if (result?.success) {
            // Set state FIRST for multi-state buttons (before showOk)
            if (result.state !== undefined) sdSetState(context, result.state);
            // Show volume on title for volume actions
            if (result.volume !== undefined && merged.show !== false) {
              sdSetTitle(context, String(result.volume));
            }
            sdShowOk(context);
          } else if (result?.success === false) {
            sdShowAlert(context);
          }
        } catch (err) {
          debugLog(`[WS] keyUp handler "${actionKey}" threw:`, err.message, '\nStack:', err.stack?.split('\n').slice(0, 4).join(' | '));
          sdShowAlert(context);
        }
      } else {
        debugLog(`[WS] No keyUp handler for: "${actionKey}"`);
      }
    }

    // ---- dialRotate: knob rotated (left/right) ----
    if (event === 'dialRotate') {
      debugLog(`[WS] dialRotate action="${action}" ticks=${payload?.ticks}`);
      const ticks = payload?.ticks || 0;
      try {
        if (actionKey === 'playpause') {
          // Rotate knob on playpause = previous/next track
          if (ticks < 0) {
            await plugin.spotifyApiRequest('/me/player/previous', 'POST');
          } else {
            await plugin.spotifyApiRequest('/me/player/next', 'POST');
          }
          _sharedStateTime = 0;
          sdShowOk(context);
        } else if (actionKey === 'mute' || actionKey === 'volumecontrol') {
          // Rotate knob on volume control = adjust volume
          const state = await getSharedState();
          if (!state?.device) return;
          const currentVol = state.device.volume_percent ?? 50;
          const stored = buttonSettings.get(context)?.settings || {};
          const step = parseInt(stored.step) || payload?.settings?.step || 10;
          // Use tracked volume if available to avoid cache lag
          if (typeof plugin._knobVolume !== 'number' || (Date.now() - (plugin._knobVolumeTime || 0)) > 3000) {
            plugin._knobVolume = currentVol;
          }
          const change = ticks < 0 ? -step : step;
          const newVol = Math.max(0, Math.min(100, plugin._knobVolume + change));
          plugin._knobVolume = newVol;
          plugin._knobVolumeTime = Date.now();
          debugLog(`[dialRotate] step=${step} currentVol=${currentVol} tracked=${plugin._knobVolume} change=${change} newVol=${newVol}`);
          await plugin.setVolume(newVol);
          _sharedStateTime = 0;
          sdSetState(context, newVol === 0 ? 1 : 0);
          if (stored.show !== false) sdSetTitle(context, String(newVol));
        }
      } catch (err) {
        debugLog(`[WS] dialRotate error:`, err.message);
        sdShowAlert(context);
      }
    }

    // ---- dialDown: knob pressed ----
    if (event === 'dialDown') {
      debugLog(`[WS] dialDown action="${action}"`);
      try {
        if (actionKey === 'playpause') {
          // Press knob on playpause = toggle play/pause
          const current = await plugin.getPlayerState();
          if (current && current.is_playing) {
            await plugin.spotifyApiRequest('/me/player/pause', 'PUT');
          } else {
            await plugin.spotifyApiRequest('/me/player/play', 'PUT');
          }
          _sharedStateTime = 0;
          sdShowOk(context);
        } else if (actionKey === 'mute') {
          // Press knob on volume control = mute/unmute
          const state = await plugin.getPlayerState();
          const currentVol = state?.device?.volume_percent ?? 50;
          if (currentVol === 0) {
            const restoreVol = plugin._lastMuteVolume || 50;
            await plugin.setVolume(restoreVol);
            sdSetState(context, 0);
            const stored = buttonSettings.get(context)?.settings || {};
            if (stored.show !== false) sdSetTitle(context, String(restoreVol));
          } else {
            plugin._lastMuteVolume = currentVol;
            await plugin.setVolume(0);
            sdSetState(context, 1);
            const stored = buttonSettings.get(context)?.settings || {};
            if (stored.show !== false) sdSetTitle(context, '0');
          }
          _sharedStateTime = 0;
          sdShowOk(context);
        }
      } catch (err) {
        debugLog(`[WS] dialDown error:`, err.message);
        sdShowAlert(context);
      }
    }

    // ---- sendToPlugin: PI → backend communication ----
    if (event === 'sendToPlugin') {
      // Handle setting_changed from PI — store individual setting updates
      if (payload.type === 'setting_changed' && payload.key) {
        const info = buttonSettings.get(context) || { action, settings: {} };
        const s = info.settings || {};
        s[payload.key] = payload.value;
        buttonSettings.set(context, { ...info, settings: s });
        debugLog(`[WS] Stored ${payload.key}="${payload.value}" for ${actionKey} context=${context}`);
        // Trigger cover update if playlist or showCover changed
        if (['playplaylist', 'addtoplaylist', 'removeplaylistsong'].includes(actionKey)) {
          if (['uri', 'playlist_id', 'showCover'].includes(payload.key)) {
            updatePlaylistCover(context, s, actionKey).catch(e => debugLog(`[Cover] error:`, e.message));
          }
        }
        return;
      }
      // Handle device_selected from PI for any action (legacy)
      if (payload.type === 'device_selected' && payload.device_id) {
        const info = buttonSettings.get(context) || {};
        const s = info.settings || {};
        s.device_id = payload.device_id;
        buttonSettings.set(context, { ...info, settings: s });
        debugLog(`[WS] Stored device_id="${payload.device_id}" for context="${context}"`);
        return;
      }
      // Handle refresh request from PI (force-refresh cache)
      if (payload.type === 'refresh') {
        try {
          if (['playpause', 'changedevice', 'playuri'].includes(actionKey)) {
            const devices = await plugin.getDevices();
            sendToPI(context, action, { devices });
          }
          if (['playplaylist', 'removeplaylistsong', 'addtoplaylist'].includes(actionKey)) {
            const [devices, playlists] = await Promise.all([plugin.getDevices(), plugin.getPlaylists(true)]);
            const mapped = playlists.map(p => ({ id: p.id, name: p.name, uri: p.uri, owner: p.owner?.display_name, tracks: { total: p.tracks?.total || 0 } }));
            sendToPI(context, action, { devices, playlists: mapped });
          }
        } catch (e) { debugLog('[WS] refresh error:', e.message); }
        return;
      }

      const key = ((payload.action || payload.type || '')).toLowerCase();
      debugLog(`[WS] sendToPlugin key="${key}" context="${context}" action="${action}"`);
      const fn = findHandler(key);

      if (fn) {
        try {
          const result = await fn(context, payload);
          debugLog(`[WS] Handler "${key}" returned:`, JSON.stringify(result)?.substring(0, 300));
          if (result !== undefined) {
            sendToPI(context, action, result);
          }
        } catch (err) {
          debugLog(`[WS] Handler "${key}" threw:`, err.message);
          sendToPI(context, action, { error: err.message });
        }
      } else {
        debugLog(`[WS] No handler for action: "${key}"`);
      }
    }
  }

  // ---- parse buffered WebSocket frames ----
  function parseFrames() {
    while (rxBuf.length >= 2) {
      const opcode   = rxBuf[0] & 0x0f;
      const b1       = rxBuf[1];
      const hasMask  = !!(b1 & 0x80);
      let   plenTag  = b1 & 0x7f;
      let   extLen   = plenTag === 126 ? 2 : plenTag === 127 ? 8 : 0;

      if (rxBuf.length < 2 + extLen) return;

      let plen = plenTag;
      if (extLen === 2) plen = rxBuf.readUInt16BE(2);
      else if (extLen === 8) plen = rxBuf.readUInt32BE(6); // lower 32-bits

      const maskOff = 2 + extLen;
      const hlen    = maskOff + (hasMask ? 4 : 0);
      if (rxBuf.length < hlen + plen) return;

      let pl = Buffer.from(rxBuf.slice(hlen, hlen + plen));
      if (hasMask) {
        const mk = rxBuf.slice(maskOff, maskOff + 4);
        for (let i = 0; i < pl.length; i++) pl[i] ^= mk[i % 4];
      }
      rxBuf = rxBuf.slice(hlen + plen);

      if      (opcode === 0x1) handleSDMessage(pl.toString('utf8'));
      else if (opcode === 0x9) sendPong(pl);
      else if (opcode === 0x8) { sock.destroy(); }
    }
  }

  // ---- create TCP connection and perform WS upgrade ----
  function connect() {
    const wsKey = _crypto.randomBytes(16).toString('base64');
    upgraded = false;
    rxBuf    = Buffer.alloc(0);

    sock = _net.createConnection(Number(sdPort), '127.0.0.1');

    sock.on('connect', () => {
      sock.write(
        'GET / HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${sdPort}\r\n` +
        'Connection: Upgrade\r\n' +
        'Upgrade: websocket\r\n' +
        `Sec-WebSocket-Key: ${wsKey}\r\n` +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });

    sock.on('data', (chunk) => {
      rxBuf = Buffer.concat([rxBuf, chunk]);

      if (!upgraded) {
        const end = rxBuf.indexOf('\r\n\r\n');
        if (end === -1) return;
        const hdr = rxBuf.slice(0, end).toString();
        if (!hdr.includes(' 101')) { sock.destroy(); return; }
        upgraded = true;
        rxBuf = rxBuf.slice(end + 4);
        // Register with SD host
        sendText(JSON.stringify({ event: sdEvent, uuid: sdUUID }));
        debugLog('[WS] Registered with Rise Mode on port', sdPort, 'UUID:', sdUUID, 'event:', sdEvent);

        // Wire broadcastAuthUpdate: pushes auth state via setGlobalSettings so PI
        // receives didReceiveGlobalSettings immediately after OAuth completes
        plugin.broadcastAuthUpdate = (authStatus) => {
          const profile = plugin.settings.user_profile || null;
          sendText(JSON.stringify({
            event: 'setGlobalSettings',
            context: sdUUID,
            payload: {
              access_token: authStatus.authenticated ? 'connected' : null,
              token_expiry: authStatus.tokenExpiry || null,
              authenticated: authStatus.authenticated,
              user_profile: profile
            }
          }));
          console.log('[SpotifyPlugin] Broadcasted auth update via setGlobalSettings');
        };

        // Also request global settings on connect so PI gets current state
        sendText(JSON.stringify({ event: 'getGlobalSettings', context: sdUUID }));
      }

      parseFrames();
    });

    sock.on('close', () => {
      console.log('[SpotifyPlugin] Disconnected from Rise Mode — exiting');
      process.exit();
    });

    sock.on('error', (err) => {
      console.error('[SpotifyPlugin] Connection error:', err.message);
    });
  }

  connect();
}());
