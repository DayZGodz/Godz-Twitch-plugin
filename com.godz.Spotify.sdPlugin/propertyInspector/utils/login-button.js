/**
 * Reusable Login Button Component
 * Include in any property inspector to add login/logout buttons
 * 
 * Usage:
 * <div id="auth-buttons"></div>
 * <script src="../utils/auth-manager.js"></script>
 * <script src="../utils/login-button.js"></script>
 */

console.log('==========================================');
console.log('📝 LoginButton Script Loaded');
console.log('==========================================');

class LoginButton {
  constructor(containerId = 'auth-buttons') {
    try {
      const normalizedId = containerId.startsWith('#') ? containerId.slice(1) : containerId;
      this.container = document.getElementById(normalizedId);
      
      if (!this.container) {
        console.error(`❌ Container #${normalizedId} not found!`);
        return;
      }
      
      console.log('✅ LoginButton initialized');
      this.attachEventListeners();
      // Initial render
      this.refresh();

      // Listen for auth changes
      window.addEventListener('spotifyAuthChanged', () => {
        console.log('📣 Auth changed event received');
        this.refresh();
      });
    } catch (error) {
      console.error('❌ LoginButton constructor error:', error);
    }
  }

  /**
   * Render login/logout buttons (update existing or create new)
   */
  render() {
    try {
      const isAuthenticated = !!($spotifyAuthManager && $spotifyAuthManager.isAuthenticated());
      // Mensagem clara se não autenticado
      let authError = '';
      if (!isAuthenticated && typeof $globalSettings !== 'undefined' && $globalSettings.lastError) {
        authError = `<div class="auth-error">${$globalSettings.lastError}</div>`;
      }
      const profileFromGlobal = (typeof $globalSettings !== 'undefined') ? $globalSettings?.user_profile : null;
      const profileFromSettings = (typeof spotifyUI !== 'undefined') ? spotifyUI.getSetting('user_profile') : null;
      const profile = profileFromGlobal || profileFromSettings || null;
      const profileName = profile?.display_name || (isAuthenticated ? 'Conta conectada' : 'Usuário');

      let contentHtml = '';
      
      if (!isAuthenticated) {
        contentHtml = `
          <button id="login-btn" class="btn btn-primary btn-login">
            <span class="icon">🔐</span>
            <span class="text">Fazer Login</span>
          </button>
          <div class="auth-info">
            <p>Clique para autenticação com Spotify</p>
            ${authError}
          </div>
        `;
      } else {
        if ((!profile || !profile.display_name) && typeof spotifyUI !== 'undefined' && typeof spotifyUI.requestUserProfile === 'function') {
          spotifyUI.requestUserProfile().catch(() => null);
        } else if ((!profile || !profile.display_name) && typeof $spotifyAuthManager !== 'undefined') {
          $spotifyAuthManager.notifyBackend({ action: 'getUserProfile' });
        }

        contentHtml = `
          <div class="auth-info-success">
            <p><strong>✅ ${profileName}</strong></p>
          </div>
          <button id="logout-btn" class="btn btn-danger btn-logout">
            <span class="icon">🚪</span>
            <span class="text">Fazer Logout</span>
          </button>
        `;
      }

      // Only update auth-container content if it exists
      const authContainer = this.container.querySelector('.auth-container');
      if (authContainer) {
        authContainer.innerHTML = contentHtml + (authContainer.querySelector('#auth-message')?.outerHTML || '<div id="auth-message" class="auth-message"></div>');
      } else {
        // Create new container
        this.container.innerHTML = `<div class="auth-container">${contentHtml}<div id="auth-message" class="auth-message"></div></div>`;
      }

      // Re-attach event listeners after render
      this.attachEventListeners();
      
      console.log('✅ LoginButton rendered');
    } catch (error) {
      console.error('❌ Error rendering LoginButton:', error);
      this.container.innerHTML = '<div style="color: red; padding: 10px;">Erro ao renderizar: ' + error.message + '</div>';
    }
  }

  /**
   * Attach event listeners to buttons
   */
  attachEventListeners() {
    try {
      const loginBtn = document.getElementById('login-btn');
      const logoutBtn = document.getElementById('logout-btn');

      if (loginBtn) {
        console.log('👆 Attaching click listener to login button');
        loginBtn.addEventListener('click', (e) => {
          e.preventDefault();
          console.log('🔐 Login button clicked!');
          this.handleLogin();
        });
      }

      if (logoutBtn) {
        console.log('👆 Attaching click listener to logout button');
        logoutBtn.addEventListener('click', (e) => {
          e.preventDefault();
          console.log('🚪 Logout button clicked!');
          this.handleLogout();
        });
      }
    } catch (error) {
      console.error('❌ Error attaching listeners:', error);
    }
  }

  /**
   * Handle login button click
   */
  async handleLogin() {
    if (!$spotifyAuthManager) {
      this.showMessage('❌ Auth manager não está pronto', 'error');
      return;
    }

    this.showMessage('🔐 Abrindo formulário de autenticação...', 'info');
    
    try {
      const success = await $spotifyAuthManager.startOAuthFlow((status) => {
        if (status === 'sending')     this.showMessage('🔄 Enviando credenciais ao backend...', 'info');
        if (status === 'authorizing') this.showMessage('🔄 Aguardando autorização no Spotify... (authorize no navegador)', 'info');
      });
      if (success) {
        this.showMessage('✅ Autenticado com sucesso!', 'success');
        setTimeout(() => this.refresh(), 500);
      } else {
        this.showMessage('❌ Autenticação falhou ou foi cancelada', 'error');
      }
    } catch (error) {
      this.showMessage('❌ Erro: ' + error.message, 'error');
    }
  }

  /**
   * Handle logout button click
   */
  async handleLogout() {
    if (!$spotifyAuthManager) {
      this.showMessage('❌ Auth manager não está pronto', 'error');
      return;
    }

    try {
      const success = await $spotifyAuthManager.logout();
      if (success) {
        this.showMessage('✅ Logout bem-sucedido!', 'success');
        setTimeout(() => this.refresh(), 1000);
      }
    } catch (error) {
      this.showMessage('❌ Erro: ' + error.message, 'error');
    }
  }

  /**
   * Show message to user
   */
  showMessage(text, type = 'info') {
    try {
      const messageDiv = document.getElementById('auth-message');
      if (!messageDiv) return;
      
      messageDiv.textContent = text;
      messageDiv.className = `auth-message auth-message-${type}`;
      messageDiv.style.display = 'block';

      // Clear any previous auto-hide timer
      if (this._msgTimer) { clearTimeout(this._msgTimer); this._msgTimer = null; }

      // Auto-hide only non-persistent info messages (not 'loading' type)
      if (type === 'info') {
        this._msgTimer = setTimeout(() => {
          messageDiv.style.display = 'none';
          this._msgTimer = null;
        }, 8000);
      }
    } catch (error) {
      console.error('Error showing message:', error);
    }
  }

  /**
   * Force refresh of UI
   */
  refresh() {
    console.log('🔄 Refreshing LoginButton...');
    this.render();
  }
}

// Auto-init for all property inspectors that include #auth-buttons
document.addEventListener('DOMContentLoaded', () => {
  const hasContainer = document.getElementById('auth-buttons');
  if (hasContainer && !window.$loginButton) {
    window.$loginButton = new LoginButton('auth-buttons');
  }
});
