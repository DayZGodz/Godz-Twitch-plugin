/**
 * Spotify OAuth Authentication Manager
 * Handles authorization via external browser + popup form
 * Integrates with backend plugin for token exchange
 */

console.log('✅ AuthManager Script Loaded');

class SpotifyAuthManager {
  constructor() {
    this.isAuthorizing = false;
  }

  setLocalConnectedState(connected, ttlMs = 55 * 60 * 1000) {
    const expiry = Date.now() + ttlMs;
    if (typeof $globalSettings !== 'undefined') {
      $globalSettings.access_token = connected ? 'connected' : null;
      $globalSettings.token_expiry = connected ? expiry : null;
    }
    if (typeof spotifyUI !== 'undefined') {
      spotifyUI.setSetting('access_token', connected ? 'connected' : null);
      spotifyUI.setSetting('token_expiry', connected ? expiry : null);
    }
    if (connected) {
      localStorage.setItem('spotify_auth_connected', 'true');
      localStorage.setItem('spotify_auth_expiry', String(expiry));
    } else {
      localStorage.removeItem('spotify_auth_connected');
      localStorage.removeItem('spotify_auth_expiry');
      localStorage.removeItem('spotifySettings');
      if (typeof window !== 'undefined' && window.$globalSettings) {
        window.$globalSettings.access_token = null;
        window.$globalSettings.token_expiry = null;
        window.$globalSettings.user_profile = null;
      }
    }
  }

  setUserProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      return;
    }

    if (typeof $globalSettings !== 'undefined') {
      $globalSettings.user_profile = profile;
    }

    if (typeof spotifyUI !== 'undefined') {
      spotifyUI.setSetting('user_profile', profile);
    }
  }

  getCachedUserProfile() {
    if (typeof $globalSettings !== 'undefined' && $globalSettings?.user_profile) {
      return $globalSettings.user_profile;
    }

    if (typeof spotifyUI !== 'undefined') {
      const profile = spotifyUI.getSetting('user_profile');
      if (profile) return profile;
    }

    return null;
  }

  getCachedAuthState() {
    try {
      const localFlag = localStorage.getItem('spotify_auth_connected') === 'true';
      const localExpiry = parseInt(localStorage.getItem('spotify_auth_expiry') || '0', 10);
      const localValid = localFlag && localExpiry > Date.now();

      const uiToken = (typeof spotifyUI !== 'undefined') ? spotifyUI.getSetting('access_token') : null;
      const uiExpiry = (typeof spotifyUI !== 'undefined') ? spotifyUI.getSetting('token_expiry') : null;
      const uiValid = !!uiToken && (!uiExpiry || Date.now() <= uiExpiry);

      return {
        connected: localValid || uiValid,
        expiry: uiExpiry || localExpiry || null
      };
    } catch (error) {
      return { connected: false, expiry: null };
    }
  }

  /**
   * Start OAuth authentication flow
   * 1. Opens authorization.html popup for user to enter Client ID/Secret
   * 2. User provides credentials from Spotify Developer Dashboard
   * 3. Backend handles OAuth exchange automatically
   */
  async startOAuthFlow(onStatus = null) {
    if (this.isAuthorizing) {
      console.warn('Authorization already in progress');
      return false;
    }

    try {
      this.isAuthorizing = true;
      console.log('🔐 Starting OAuth flow...');
      
      // Open authorization popup
      const result = await this.openAuthorizationDialog();
      
      if (!result || !result.clientId || !result.clientSecret) {
        throw new Error('Invalid credentials provided');
      }

      console.log('✅ Credentials received. Sending to backend...');
      if (onStatus) onStatus('sending');

      // Start OAuth in backend local server and poll until token exists
      const started = await this.startBackendOAuth(result.clientId, result.clientSecret);
      if (!started) {
        throw new Error('Backend/websocket indisponível — verifique se o plugin está carregado');
      }

      // Clear state now — wait for backend to confirm
      if (onStatus) onStatus('authorizing');
      this.setLocalConnectedState(false);
      window.dispatchEvent(new Event('spotifyAuthChanged'));

      // AWAIT actual completion — up to 2 minutes for Spotify browser auth
      const status = await this.waitForAuthCompletion(120000);

      if (status?.authenticated) {
        this.setLocalConnectedState(true, 55 * 60 * 1000);
        if (status.userProfile) {
          this.setUserProfile(status.userProfile);
        }
        this.notifyBackend({ action: 'getUserProfile' });
        window.dispatchEvent(new Event('spotifyAuthChanged'));
        return true;
      } else {
        this.setLocalConnectedState(false);
        window.dispatchEvent(new Event('spotifyAuthChanged'));
        return false;
      }
    } catch (error) {
      console.error('❌ OAuth flow error:', error);
      return false;
    } finally {
      this.isAuthorizing = false;
    }
  }

  async startBackendOAuth(clientId, clientSecret) {
    try {
      // 1. Tell the backend to store credentials and expect a callback
      const sent = this.notifyBackend({
        action: 'startspotifyoauth',
        clientId,
        clientSecret
      });
      // sendToPlugin may fail silently — credentials are also encoded in state param as backup

      // 2. Build the Spotify OAuth URL here in the PI
      const redirectUri = 'http://127.0.0.1:44580/callback';
      const scope = [
        'user-read-private',
        'user-read-email',
        'user-modify-playback-state',
        'user-read-playback-state',
        'user-read-currently-playing',
        'playlist-read-private',
        'playlist-modify-public',
        'playlist-modify-private'
      ].join('%20');

      // Encode credentials in state so callback has them even if sendToPlugin failed
      const stateData = btoa(JSON.stringify({ cid: clientId, cs: clientSecret }));

      const authUrl = 'https://accounts.spotify.com/authorize'
        + '?client_id=' + encodeURIComponent(clientId)
        + '&response_type=code'
        + '&redirect_uri=' + encodeURIComponent(redirectUri)
        + '&scope=' + scope
        + '&show_dialog=true'
        + '&state=' + encodeURIComponent(stateData);

      console.log('[AuthManager] Auth URL built');

      // 3. Open via SD host's openUrl event (always works, no exec needed)
      this.openUrlViaSD(authUrl);

      return true;
    } catch (error) {
      console.error('Error starting backend OAuth:', error);
      return false;
    }
  }

  openUrlViaSD(url) {
    try {
      const ws = (typeof spotifyUI !== 'undefined' && spotifyUI.websocket)
        ? spotifyUI.websocket
        : (typeof $websocket !== 'undefined' ? $websocket : null);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'openUrl', payload: { url } }));
        console.log('🌐 Opened Spotify auth URL via SD openUrl event');
        return;
      }
    } catch (e) {
      console.warn('openUrlViaSD failed:', e.message);
    }
    // Absolute fallback — try window.open
    try { window.open(url, '_blank'); } catch (e) {}
  }

  async waitForAuthCompletion(timeoutMs = 90000) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      let timer = null;

      const finish = (result) => {
        window.removeEventListener('spotifyAuthChanged', onAuthEvent);
        if (timer) { clearTimeout(timer); timer = null; }
        resolve(result);
      };

      // React immediately if didReceiveGlobalSettings fires auth update
      const onAuthEvent = () => {
        const cached = (typeof $spotifyAuthManager !== 'undefined')
          ? $spotifyAuthManager.getCachedAuthState()
          : null;
        if (cached && cached.connected) {
          finish({ authenticated: true, tokenExpiry: cached.expiry });
        }
      };
      window.addEventListener('spotifyAuthChanged', onAuthEvent);

      const poll = async () => {
        if (Date.now() >= deadline) { finish(null); return; }

        // Also check cached state each iteration
        const cached = (typeof $spotifyAuthManager !== 'undefined')
          ? $spotifyAuthManager.getCachedAuthState()
          : null;
        if (cached && cached.connected) {
          finish({ authenticated: true, tokenExpiry: cached.expiry });
          return;
        }

        try {
          const status = (typeof spotifyUI !== 'undefined' && typeof spotifyUI.requestAuthStatus === 'function')
            ? await spotifyUI.requestAuthStatus(2500)
            : null;

          if (status && status.authenticated === true) {
            finish(status);
            return;
          }
          if (status && status.lastError) {
            finish(status);
            return;
          }
        } catch (error) { /* ignore transient errors */ }

        timer = setTimeout(poll, 1500);
      };

      poll();
    });
  }

  /**
   * Open authorization dialog popup
   * Returns: { clientId, clientSecret }
   */
  openAuthorizationDialog() {
    return new Promise((resolve, reject) => {
      let settled = false;
      // Create popup window with authorization form
      const authWindow = window.open(
        '../utils/authorization.html',
        'spotify_auth',
        'width=600,height=700,resizable=yes,scrollbars=yes'
      );

      if (!authWindow) {
        reject(new Error('Failed to open authorization window. Check popup blocker.'));
        return;
      }

      // Setup callback for when user submits form
      window.$setupSuccessCallback = (credentials) => {
        settled = true;
        console.log('✅ Authorization dialog submitted');
        resolve(credentials);
      };

      // Setup timeout (5 minutes)
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { authWindow.close(); } catch (e) {}
        reject(new Error('Authorization dialog timeout'));
      }, 300000);

      // Monitor window closure
      const checkInterval = setInterval(() => {
        try {
          if (authWindow.closed) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            if (!settled) {
              settled = true;
              reject(new Error('Authorization dialog closed before completion'));
            }
          }
        } catch (e) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            reject(new Error('Authorization dialog monitoring failed'));
          }
        }
      }, 500);
    });
  }

  /**
   * Notify plugin backend of action (assumes WebSocket connection)
   */
  notifyBackend(data) {
    try {
      if (typeof spotifyUI !== 'undefined' && typeof spotifyUI.sendToPlugin === 'function') {
        const sent = spotifyUI.sendToPlugin(data);
        if (sent) {
          console.log('📤 Message sent to backend via sendToPlugin:', data.action);
          return true;
        }
        console.warn('⚠️ sendToPlugin não enviou (websocket indisponível)');
        return false;
      }

      const ws = (typeof $websocket !== 'undefined' && $websocket)
        ? $websocket
        : (typeof spotifyUI !== 'undefined' ? spotifyUI.websocket : null);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
        console.log('📤 Message sent to backend:', data.action);
        return true;
      } else {
        console.warn('⚠️ WebSocket not connected');
        return false;
      }
    } catch (error) {
      console.error('Error notifying backend:', error);
      return false;
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    // Só desconecta se backend disser explicitamente que não está autenticado
    if (typeof $globalSettings !== 'undefined' && typeof $globalSettings.authenticated === 'boolean') {
      return $globalSettings.authenticated === true;
    }
    // Se não houver informação do backend, assume autenticado até que backend diga o contrário
    return true;
  }

  /**
   * Check if token is expired
   */
  isTokenExpired() {
    // Não expira automaticamente no frontend, só se backend disser
    return false;
  }

  /**
   * Get current access token
   */
  getAccessToken() {
    if (typeof $globalSettings !== 'undefined' && $globalSettings?.access_token) {
      return $globalSettings.access_token;
    }

    if (typeof spotifyUI !== 'undefined') {
      return spotifyUI.getSetting('access_token') || null;
    }

    return null;
  }

  /**
   * Logout / Clear tokens
   */
  async logout() {
    if (confirm('Deseja fazer logout da sua conta Spotify?')) {
      try {
        if (typeof $websocket !== 'undefined' && $websocket && $websocket.readyState === WebSocket.OPEN) {
          $websocket.send(JSON.stringify({
            action: 'spotifyLogout',
            payload: {}
          }));
        }

        // Clear settings
        if (typeof $globalSettings !== 'undefined') {
          $globalSettings.access_token = null;
          $globalSettings.refresh_token = null;
          $globalSettings.token_expiry = null;
          $globalSettings.user_profile = null;
        }

        if (typeof spotifyUI !== 'undefined') {
          spotifyUI.setSetting('access_token', null);
          spotifyUI.setSetting('token_expiry', null);
        }
        this.setLocalConnectedState(false);

        console.log('✅ Logout successful');
        return true;
      } catch (error) {
        console.error('❌ Logout error:', error);
        return false;
      }
    }
    return false;
  }

  /**
   * Get authentication status message
   */
  getStatusMessage() {
    if (!this.isAuthenticated()) {
      return '❌ Não autenticado';
    }

    if (this.isTokenExpired()) {
      return '⚠️ Token expirado';
    }

    if (typeof $globalSettings === 'undefined') return '✅ Autenticado';
    
    const profile = this.getCachedUserProfile();
    if (profile?.display_name) {
      return `✅ Autenticado como: ${profile.display_name}`;
    }

    return '✅ Autenticado';
  }

  /**
   * Get full auth status object
   */
  getAuthStatus() {
    return {
      isAuthenticated: this.isAuthenticated(),
      isExpired: this.isTokenExpired(),
      hasToken: !!this.getAccessToken(),
      status: this.getStatusMessage(),
      profile: this.getCachedUserProfile()
    };
  }
}

// Create global instance
const $spotifyAuthManager = new SpotifyAuthManager();

// Setup WebSocket listeners for auth responses from backend
if (typeof window !== 'undefined') {
  document.addEventListener('websocketOpen', () => {
    console.log('✅ WebSocket connected - Auth manager ready');
  });
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpotifyAuthManager;
}
