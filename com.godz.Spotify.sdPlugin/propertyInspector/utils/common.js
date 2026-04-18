// Common Utilities for Spotify Plugin
class SpotifyPropertyInspector {
  constructor() {
    this.websocket = null;
    this.settings = JSON.parse(localStorage.getItem('spotifySettings')) || {};
    this.context = null;
    this.uuid = null;
    this.registrationUUID = null;
    this.registrationEvent = 'registerPropertyInspector';
    this.sdPort = null;
    this.action = this.inferActionFromPath();
    this.lastDevicesResponseAt = 0;
    this.lastPlaylistsResponseAt = 0;
    this.lastAuthStatusResponseAt = 0;
    this.extractConnectionInfoFromUrl();
  }

  applyActionInfo(actionInfoRaw) {
    if (!actionInfoRaw) return;

    try {
      const parsed = (typeof actionInfoRaw === 'string')
        ? JSON.parse(actionInfoRaw)
        : actionInfoRaw;

      if (!parsed || typeof parsed !== 'object') return;

      this.context = this.context || parsed.context || null;
      this.action = this.action || parsed.action || null;

      const payloadSettings = parsed.payload && parsed.payload.settings;
      if (payloadSettings && typeof payloadSettings === 'object') {
        this.settings = { ...this.settings, ...payloadSettings };
        localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      }
    } catch (error) {
      // Ignore malformed action info
    }
  }

  extractConnectionInfoFromUrl() {
    try {
      const search = new URLSearchParams(window.location.search || '');
      const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));

      const pick = (key) => search.get(key) || hash.get(key) || null;

      this.context = this.context || pick('context');
      this.uuid = this.uuid || pick('uuid');
      this.action = this.action || pick('action');
      this.registrationUUID = this.registrationUUID || pick('uuid') || pick('pluginUUID');

      const parseJsonParam = (key) => {
        const raw = pick(key);
        if (!raw) return null;
        try {
          return JSON.parse(decodeURIComponent(raw));
        } catch (error) {
          return null;
        }
      };

      const actionInfo = parseJsonParam('actionInfo');
      this.applyActionInfo(actionInfo);

      // Fallback: on some hosts, registration UUID is only available in query string.
      this.registrationUUID = this.registrationUUID || this.uuid || this.context;
    } catch (error) {
      // Ignore URL parsing issues
    }
  }

  registerPropertyInspectorIfPossible(ws) {
    try {
      const registrationUUID = this.registrationUUID || this.uuid || this.context;
      if (!registrationUUID || !ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      ws.send(JSON.stringify({
        event: this.registrationEvent || 'registerPropertyInspector',
        uuid: registrationUUID
      }));

      if (this.context) {
        ws.send(JSON.stringify({
          event: 'getSettings',
          context: this.context
        }));
      } else {
        ws.send(JSON.stringify({
          event: 'getSettings',
          context: registrationUUID
        }));
      }

      ws.send(JSON.stringify({
        event: 'getGlobalSettings',
        context: registrationUUID
      }));
    } catch (error) {
      // Registration is best-effort
    }
  }

  connectStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) {
    this.sdPort = inPort ? String(inPort) : null;
    this.registrationUUID = inUUID || this.registrationUUID;
    this.uuid = inUUID || this.uuid;
    this.context = this.context || inUUID || this.registrationUUID || null;
    this.registrationEvent = inRegisterEvent || this.registrationEvent;

    this.applyActionInfo(inActionInfo);

    try {
      const infoObj = (typeof inInfo === 'string') ? JSON.parse(inInfo) : inInfo;
      if (infoObj && typeof infoObj === 'object' && infoObj.plugin && infoObj.plugin.uuid) {
        this.settings.plugin_uuid = infoObj.plugin.uuid;
      }
    } catch (error) {
      // Ignore malformed plugin info
    }

    return this.initWebSocket();
  }

  inferActionFromPath() {
    const path = (window.location.pathname || '').toLowerCase();
    const map = {
      '/playpause/': 'com.godz.spotify.playpause',
      '/next/': 'com.godz.spotify.next',
      '/previous/': 'com.godz.spotify.previous',
      '/volumeup/': 'com.godz.spotify.volumeup',
      '/volumedown/': 'com.godz.spotify.volumedown',
      '/volumecontrol/': 'com.godz.spotify.volumecontrol',
      '/playplaylist/': 'com.godz.spotify.playplaylist',
      '/addtoplaylist/': 'com.godz.spotify.addtoplaylist',
      '/removeplaylistsong/': 'com.godz.spotify.removeplaylistsong',
      '/songinfo/': 'com.godz.spotify.songinfo'
    };

    const found = Object.keys(map).find((k) => path.includes(k));
    return found ? map[found] : null;
  }

  attachSocketHandlers(ws) {
    if (!ws) return;

    const onMessage = (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : event;
        const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
        this.handleMessage(payload);
      } catch (error) {
        console.error('WebSocket parse error:', error);
      }
    };

    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', (error) => console.error('WebSocket error:', error));
      ws.addEventListener('close', () => console.log('WebSocket closed'));
    } else {
      ws.onmessage = onMessage;
      ws.onerror = (error) => console.error('WebSocket error:', error);
      ws.onclose = () => console.log('WebSocket closed');
    }
  }

  /**
   * Initialize WebSocket connection
   */
  initWebSocket() {
    return new Promise((resolve, reject) => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      // Prefer Stream Deck provided websocket if available
      if (typeof $websocket !== 'undefined' && $websocket) {
        this.websocket = $websocket;
        this.attachSocketHandlers(this.websocket);
        if (this.websocket.readyState === WebSocket.OPEN) {
          console.log('Using existing Stream Deck websocket');
          this.registerPropertyInspectorIfPossible(this.websocket);
          resolve();
          return;
        }
      }

      const wsPort = this.sdPort || document.location.port;
      if (!wsPort) {
        reject(new Error('Missing Stream Deck websocket port'));
        return;
      }

      const wsUri = `ws://127.0.0.1:${wsPort}`;
      
      this.websocket = new WebSocket(wsUri);
      this.attachSocketHandlers(this.websocket);
      
      this.websocket.onopen = () => {
        console.log('WebSocket connected');
        this.registerPropertyInspectorIfPossible(this.websocket);
        resolve();
      };

      this.websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };
    });
  }

  /**
   * Send message to plugin backend
   */
  sendToPlugin(payload) {
    // Rise Mode routes sendToPlugin by the registration UUID, not the action context
    const messageContext = this.uuid || this.registrationUUID || this.context || this.settings.context || null;

    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const message = {
        action: this.action,
        context: messageContext,
        event: 'sendToPlugin',
        payload: payload
      };
      this.websocket.send(JSON.stringify(message));
      return true;
    } else if (typeof $websocket !== 'undefined' && $websocket && $websocket.readyState === WebSocket.OPEN) {
      const message = {
        action: this.action,
        context: messageContext,
        event: 'sendToPlugin',
        payload: payload
      };
      $websocket.send(JSON.stringify(message));
      return true;
    }

    return false;
  }

  /**
   * Handle messages from backend
   */
  handleMessage(payload) {
    // Se receber erro de autenticação, limpar localStorage e $globalSettings
    if (payload && (payload.lastError || payload.error)) {
      const errMsg = payload.lastError || payload.error;
      if (typeof errMsg === 'string' && (errMsg.toLowerCase().includes('token') || errMsg.toLowerCase().includes('auth'))) {
        try {
          localStorage.removeItem('spotify_auth_connected');
          localStorage.removeItem('spotify_auth_expiry');
          localStorage.removeItem('spotifySettings');
          if (typeof window !== 'undefined' && window.$globalSettings) {
            window.$globalSettings.access_token = null;
            window.$globalSettings.token_expiry = null;
            window.$globalSettings.user_profile = null;
          }
        } catch (e) {}
      }
    }
    const findDeep = (root, predicate, maxDepth = 7) => {
      const queue = [{ node: root, depth: 0 }];
      const seen = new Set();

      while (queue.length > 0) {
        const current = queue.shift();
        const node = current.node;
        const depth = current.depth;

        if (!node || typeof node !== 'object') continue;
        if (seen.has(node)) continue;
        seen.add(node);

        try {
          if (predicate(node)) return node;
        } catch (error) {
          // Ignore predicate errors and continue search
        }

        if (depth >= maxDepth) continue;

        if (Array.isArray(node)) {
          for (const child of node) {
            if (child && typeof child === 'object') {
              queue.push({ node: child, depth: depth + 1 });
            }
          }
        } else {
          for (const key of Object.keys(node)) {
            const child = node[key];
            if (child && typeof child === 'object') {
              queue.push({ node: child, depth: depth + 1 });
            }
          }
        }
      }

      return null;
    };

    const findDeepValue = (root, key) => {
      const owner = findDeep(root, (obj) => Object.prototype.hasOwnProperty.call(obj, key));
      return owner ? owner[key] : null;
    };

    if (payload.event === 'didReceiveSettings') {
      const receivedSettings = payload?.payload?.settings || payload?.settings || {};
      this.settings = { ...this.settings, ...receivedSettings };
      if (payload?.context) {
        this.context = payload.context;
      }
      localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      if (this.onSettingsReceived) {
        this.onSettingsReceived(this.settings);
      }
      return;
    }

    if (payload.event === 'didReceiveGlobalSettings') {
      const globalSettings = payload?.payload?.settings || payload?.settings || {};
      if (typeof window !== 'undefined') {
        window.$globalSettings = globalSettings;
      }
      // Só considera autenticado se backend disser que está
      const authenticated = globalSettings.authenticated === true;
      const merged = {
        ...this.settings,
        access_token: authenticated ? (globalSettings.access_token || this.settings.access_token || null) : null,
        token_expiry: authenticated ? (globalSettings.token_expiry || this.settings.token_expiry || null) : null,
        user_profile: authenticated ? (globalSettings.user_profile || this.settings.user_profile || null) : null
      };
      this.settings = merged;
      localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      window.dispatchEvent(new Event('spotifyAuthChanged'));
      return;
    }

    // Generic response parsing fallback for plugin replies
    let devices =
      payload?.devices ||
      payload?.payload?.devices ||
      payload?.payload?.payload?.devices ||
      payload?.result?.devices ||
      null;

    if (!Array.isArray(devices)) {
      const deepDevices = findDeepValue(payload, 'devices');
      if (Array.isArray(deepDevices)) {
        devices = deepDevices;
      }
    }

    let deviceError =
      payload?.error ||
      payload?.payload?.error ||
      payload?.payload?.payload?.error ||
      payload?.result?.error ||
      null;

    if (!deviceError) {
      const deepError = findDeepValue(payload, 'error');
      if (typeof deepError === 'string' && deepError.trim()) {
        deviceError = deepError;
      }
    }

    let userProfile =
      payload?.userProfile ||
      payload?.user_profile ||
      payload?.payload?.userProfile ||
      payload?.payload?.user_profile ||
      payload?.payload?.payload?.userProfile ||
      payload?.payload?.payload?.user_profile ||
      payload?.result?.userProfile ||
      payload?.result?.user_profile ||
      null;

    if (!userProfile || typeof userProfile !== 'object') {
      const deepUserProfile =
        findDeepValue(payload, 'userProfile') ||
        findDeepValue(payload, 'user_profile');
      if (deepUserProfile && typeof deepUserProfile === 'object') {
        userProfile = deepUserProfile;
      }
    }

    let authStatus =
      (typeof payload?.authenticated === 'boolean' ? payload : null) ||
      (typeof payload?.payload?.authenticated === 'boolean' ? payload.payload : null) ||
      (typeof payload?.payload?.payload?.authenticated === 'boolean' ? payload.payload.payload : null) ||
      (typeof payload?.result?.authenticated === 'boolean' ? payload.result : null) ||
      null;

    if (!authStatus) {
      authStatus = findDeep(payload, (obj) => typeof obj.authenticated === 'boolean', 8);
    }

    if (Array.isArray(devices)) {
      this.settings.devices = devices;
      this.settings.devices_error = null;
      this.lastDevicesResponseAt = Date.now();
      localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      if (this.onSettingsReceived) {
        this.onSettingsReceived(this.settings);
      }
    } else if (deviceError) {
      this.settings.devices = [];
      this.settings.devices_error = String(deviceError);
      this.lastDevicesResponseAt = Date.now();
      localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      if (this.onSettingsReceived) {
        this.onSettingsReceived(this.settings);
      }
    }

    // ---- Extract playlists from plugin response ----
    let playlists =
      payload?.playlists ||
      payload?.payload?.playlists ||
      payload?.payload?.payload?.playlists ||
      payload?.result?.playlists ||
      null;

    if (!Array.isArray(playlists)) {
      const deepPlaylists = findDeepValue(payload, 'playlists');
      if (Array.isArray(deepPlaylists)) {
        playlists = deepPlaylists;
      }
    }

    if (Array.isArray(playlists)) {
      this.settings.playlists = playlists;
      this.lastPlaylistsResponseAt = Date.now();
      localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      if (this.onSettingsReceived) {
        this.onSettingsReceived(this.settings);
      }
    }

    if (userProfile && typeof userProfile === 'object') {
      this.settings.user_profile = userProfile;
      localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      if (typeof $globalSettings !== 'undefined') {
        $globalSettings.user_profile = userProfile;
      }
      window.dispatchEvent(new Event('spotifyAuthChanged'));
    }

    if (authStatus) {
      this.lastAuthStatusResponseAt = Date.now();
      this.settings.auth_status = authStatus;
      this.settings.access_token = authStatus.authenticated ? 'connected' : null;
      this.settings.token_expiry = authStatus.tokenExpiry || null;
      this.settings.auth_error = authStatus.lastError || null;

      if (authStatus.userProfile && typeof authStatus.userProfile === 'object') {
        this.settings.user_profile = authStatus.userProfile;
        if (typeof $globalSettings !== 'undefined') {
          $globalSettings.user_profile = authStatus.userProfile;
        }
      }

      localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      window.dispatchEvent(new Event('spotifyAuthChanged'));
    }
  }

  /**
   * Save settings
   */
  saveSettings() {
    localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const settingContext = this.context || this.uuid || this.registrationUUID || null;
      if (settingContext) {
        this.websocket.send(JSON.stringify({
          event: 'setSettings',
          context: settingContext,
          payload: this.settings
        }));
      }

      const registrationUUID = this.registrationUUID || this.uuid || this.context;
      if (registrationUUID) {
        this.websocket.send(JSON.stringify({
          event: 'setGlobalSettings',
          context: registrationUUID,
          payload: this.settings
        }));
      }
    }
  }

  /**
   * Get saved setting by key
   */
  getSetting(key, defaultValue = null) {
    return this.settings[key] !== undefined ? this.settings[key] : defaultValue;
  }

  /**
   * Set and save setting
   */
  setSetting(key, value) {
    this.settings[key] = value;
    this.saveSettings();
  }

  /**
   * DOM Utilities
   */
  $(selector) {
    return document.querySelector(selector);
  }

  $$(selector) {
    return document.querySelectorAll(selector);
  }

  /**
   * Create debounced function
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Format device info
   */
  formatDeviceInfo(device) {
    const active = device.is_active ? ' ✓' : '';
    return `${device.name} (${device.type})${active}`;
  }

  /**
   * Show notification
   */
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  /**
   * Loading state
   */
  setLoading(element, isLoading = true) {
    if (isLoading) {
      if (!element.dataset.originalHtml) {
        element.dataset.originalHtml = element.innerHTML;
      }
      element.disabled = true;
      element.classList.add('loading');
      element.innerHTML = '<span class="spinner"></span> Loading...';
    } else {
      element.disabled = false;
      element.classList.remove('loading');
      if (element.dataset.originalHtml) {
        element.innerHTML = element.dataset.originalHtml;
      }
    }
  }

  /**
   * Request devices from plugin backend via Stream Deck websocket.
   */
  async requestDevices(timeoutMs = 3000) {
    const startMarker = this.lastDevicesResponseAt;
    this.settings.devices_error = null;
    localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
    const sent = this.sendToPlugin({ action: 'getDevices' });
    if (!sent) {
      this.settings.devices_error = 'WebSocket desconectado: nao foi possivel solicitar dispositivos';
      localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      return this.getSetting('devices', []);
    }

    const stepMs = 200;
    let elapsed = 0;
    while (elapsed < timeoutMs) {
      if (this.lastDevicesResponseAt > startMarker) {
        return this.getSetting('devices', []);
      }
      const devices = this.getSetting('devices', []);
      if (Array.isArray(devices) && devices.length > 0) {
        return devices;
      }
      await new Promise((resolve) => setTimeout(resolve, stepMs));
      elapsed += stepMs;
    }

    this.settings.devices_error = 'Sem resposta do backend para getDevices via websocket';
    localStorage.setItem('spotifySettings', JSON.stringify(this.settings));

    return this.getSetting('devices', []);
  }

  async requestAuthStatus(timeoutMs = 2500) {
    const startMarker = this.lastAuthStatusResponseAt;
    const sent = this.sendToPlugin({ action: 'authstatus' });
    if (!sent) {
      return this.getSetting('auth_status', null);
    }

    const stepMs = 200;
    let elapsed = 0;
    while (elapsed < timeoutMs) {
      if (this.lastAuthStatusResponseAt > startMarker) {
        return this.getSetting('auth_status', null);
      }
      await new Promise((resolve) => setTimeout(resolve, stepMs));
      elapsed += stepMs;
    }

    return this.getSetting('auth_status', null);
  }

  async requestUserProfile() {
    const sent = this.sendToPlugin({ action: 'getUserProfile' });
    if (!sent) {
      return this.getSetting('user_profile', null);
    }

    const waitStep = 150;
    let elapsed = 0;
    while (elapsed < 1800) {
      const profile = this.getSetting('user_profile');
      if (profile && profile.display_name) {
        return profile;
      }
      await new Promise((resolve) => setTimeout(resolve, waitStep));
      elapsed += waitStep;
    }

    const status = await this.requestAuthStatus(1800);
    if (status?.userProfile) {
      this.settings.user_profile = status.userProfile;
      localStorage.setItem('spotifySettings', JSON.stringify(this.settings));
      if (typeof $globalSettings !== 'undefined') {
        $globalSettings.user_profile = status.userProfile;
      }
      window.dispatchEvent(new Event('spotifyAuthChanged'));
      return status.userProfile;
    }

    return this.getSetting('user_profile', null);
  }

  /**
   * Request playlists from plugin backend via Stream Deck websocket.
   */
  async requestPlaylists(timeoutMs = 3000) {
    const startMarker = this.lastPlaylistsResponseAt;
    const sent = this.sendToPlugin({ action: 'getPlaylists' });
    if (!sent) {
      return this.getSetting('playlists', []);
    }

    const stepMs = 200;
    let elapsed = 0;
    while (elapsed < timeoutMs) {
      if (this.lastPlaylistsResponseAt > startMarker) {
        return this.getSetting('playlists', []);
      }
      const playlists = this.getSetting('playlists', []);
      if (Array.isArray(playlists) && playlists.length > 0) {
        return playlists;
      }
      await new Promise((resolve) => setTimeout(resolve, stepMs));
      elapsed += stepMs;
    }

    return this.getSetting('playlists', []);
  }
}

// Global instance
const spotifyUI = new SpotifyPropertyInspector();

if (typeof window !== 'undefined') {
  // Neutral connector for hosts that call a generic Stream Deck callback.
  window.connectStreamDeckSocket = (inPort, inUUID, inRegisterEvent, inInfo, inActionInfo) => {
    spotifyUI.connectStreamDeckSocket(inPort, inUUID, inRegisterEvent, inInfo, inActionInfo)
      .catch((error) => {
        console.error('Failed to initialize via connectStreamDeckSocket:', error);
      });
  };

  // Compatibility alias used by SDK-compatible hosts.
  window.connectElgatoStreamDeckSocket = window.connectStreamDeckSocket;

  // Compatibility alias for Rise Mode variants.
  window.connectRiseModeStreamDeckSocket = window.connectStreamDeckSocket;

  if (typeof window.$globalSettings === 'undefined') {
    window.$globalSettings = {};
  }
}

console.log('✅ spotifyUI instance created');
console.log('Globais disponíveis:', {
  spotifyUI: !!spotifyUI,
  $spotifyAuthManager: typeof $spotifyAuthManager !== 'undefined',
  $globalSettings: typeof $globalSettings !== 'undefined',
  $websocket: typeof $websocket !== 'undefined'
});

// Auto-initialize if this is the main property inspector


// Função para forçar atualização do status de autenticação ao abrir o PI e periodicamente
async function forceAuthStatusSync() {
  try {
    // Aguarda websocket conectar
    await spotifyUI.initWebSocket();
    // Função para requisitar status ao backend
    const requestAuthStatus = () => {
      if (spotifyUI.websocket && spotifyUI.websocket.readyState === WebSocket.OPEN) {
        const ctx = spotifyUI.context || spotifyUI.uuid || spotifyUI.registrationUUID;
        spotifyUI.websocket.send(JSON.stringify({
          event: 'getGlobalSettings',
          context: ctx
        }));
      }
    };
    // Solicita status imediatamente
    requestAuthStatus();
    // Solicita status a cada 30 segundos
    if (!window.__spotifyAuthSyncInterval) {
      window.__spotifyAuthSyncInterval = setInterval(requestAuthStatus, 30000);
    }
  } catch (error) {
    console.error('Erro ao sincronizar status de autenticação:', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOMContentLoaded event fired');
    forceAuthStatusSync();
  });
} else {
  console.log('⚡ Document already loaded, initializing...');
  forceAuthStatusSync();
}

/**
 * COMPATIBILITY LAYER
 * Maps old spotifyAuth API to new $spotifyAuthManager API
 * This allows legacy action handlers to keep working
 */
const spotifyAuth = {
  isAuthenticated() {
    if (typeof $spotifyAuthManager === 'undefined') return false;
    return $spotifyAuthManager.isAuthenticated();
  },

  getAccessToken() {
    if (typeof $spotifyAuthManager === 'undefined') return null;
    return $spotifyAuthManager.getAccessToken();
  },

  logout() {
    if (typeof $spotifyAuthManager === 'undefined') return false;
    return $spotifyAuthManager.logout();
  },

  getUserProfile() {
    if (typeof $globalSettings !== 'undefined') {
      const profile = $globalSettings?.user_profile;
      if (profile) return profile;
    }

    if (typeof spotifyUI !== 'undefined') {
      const profile = spotifyUI.getSetting('user_profile');
      if (profile) return profile;
    }
    
    return {
      display_name: 'Usuário',
      email: 'não autenticado'
    };
  },

  openExternalLogin() {
    if (typeof $spotifyAuthManager === 'undefined') {
      console.warn('$spotifyAuthManager not ready');
      return false;
    }
    $spotifyAuthManager.startOAuthFlow();
    return true;
  },

  pollForAuthCode() {
    // No-op: handled by auth-manager now
    return true;
  }
};

console.log('✅ spotifyAuth compatibility layer created');
