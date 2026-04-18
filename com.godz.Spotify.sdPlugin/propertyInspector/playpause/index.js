/**
 * Play/Pause Action Property Inspector
 * Uses external Spotify browser login ONLY
 */

class PlayPauseInspector {
  constructor() {
    this.deviceSelect = document.getElementById('device');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.messageDiv = document.getElementById('message');
    this.deviceSection = document.getElementById('device-section');
    this.timeDisplaySelect = document.getElementById('timeDisplay');
    this.showTitleCheck = document.getElementById('showTitle');
    this.titleFormatSelect = document.getElementById('titleFormat');

    if (!this.deviceSelect || !this.refreshBtn || !this.messageDiv) {
      return;
    }

    this.init();
  }

  async init() {
    this.refreshBtn.addEventListener('click', () => this.loadDevices());
    this.deviceSelect.addEventListener('change', () => this.saveDevice());

    // Display settings listeners
    if (this.timeDisplaySelect) {
      this.timeDisplaySelect.addEventListener('change', () => this.saveDisplaySettings());
    }
    if (this.showTitleCheck) {
      this.showTitleCheck.addEventListener('change', () => this.saveDisplaySettings());
    }
    if (this.titleFormatSelect) {
      this.titleFormatSelect.addEventListener('change', () => this.saveDisplaySettings());
    }

    new LoginButton('#auth-buttons');

    window.addEventListener('spotifyAuthChanged', () => {
      this.onAuthStateChanged(spotifyAuth.isAuthenticated());
    });

    this.onAuthStateChanged(spotifyAuth.isAuthenticated());
    this.loadDisplaySettings();
  }

  loadDisplaySettings() {
    const timeDisplay = spotifyUI.getSetting('timeDisplay', 'elapsed');
    const showTitle = spotifyUI.getSetting('showTitle', true);
    const titleFormat = spotifyUI.getSetting('titleFormat', 'title-artist');

    if (this.timeDisplaySelect) this.timeDisplaySelect.value = timeDisplay;
    if (this.showTitleCheck) this.showTitleCheck.checked = showTitle;
    if (this.titleFormatSelect) this.titleFormatSelect.value = titleFormat;
  }

  saveDisplaySettings() {
    const timeDisplay = this.timeDisplaySelect ? this.timeDisplaySelect.value : 'elapsed';
    const showTitle = this.showTitleCheck ? this.showTitleCheck.checked : true;
    const titleFormat = this.titleFormatSelect ? this.titleFormatSelect.value : 'title-artist';

    spotifyUI.setSetting('timeDisplay', timeDisplay);
    spotifyUI.setSetting('showTitle', showTitle);
    spotifyUI.setSetting('titleFormat', titleFormat);

    // Save to SD so backend gets the settings via didReceiveSettings
    const ctx = spotifyUI.context || spotifyUI.uuid || spotifyUI.registrationUUID;
    if (spotifyUI.websocket && spotifyUI.websocket.readyState === WebSocket.OPEN && ctx) {
      spotifyUI.websocket.send(JSON.stringify({
        event: 'setSettings',
        context: ctx,
        payload: spotifyUI.settings
      }));
    }
  }

  onAuthStateChanged(authenticated) {
    if (authenticated) {
      if (this.deviceSection) this.deviceSection.style.display = 'block';
      document.body.classList.add('spotify-authenticated');
      this.loadDevices();
    } else {
      if (this.deviceSection) this.deviceSection.style.display = 'none';
      document.body.classList.remove('spotify-authenticated');
      document.body.classList.add('spotify-not-authenticated');
    }
  }

  async loadDevices() {
    try {
      this.showMessage('Carregando dispositivos...', 'info');
      spotifyUI.setLoading(this.refreshBtn, true);

      let devices = [];
      // WebSocket-only request to plugin backend (no localhost dependency)
      devices = await spotifyUI.requestDevices();
      const fetchError = spotifyUI.getSetting('devices_error');

      if (devices.length === 0) {
        this.deviceSelect.innerHTML = '<option value="">Nenhum dispositivo detectado</option>';
        if (fetchError) {
          this.showMessage(`⚠️ ${fetchError}`, 'warning');
        } else {
          this.showMessage('⚠️ Nenhum dispositivo encontrado. Abra o Spotify (desktop/celular/web), toque algo e clique em Atualizar.', 'warning');
        }
      } else {
        this.populateDevices(devices);
        this.showMessage('✅ Dispositivos carregados com sucesso!', 'info');
      }

      spotifyUI.setLoading(this.refreshBtn, false);
    } catch (error) {
      this.showMessage('❌ Erro ao carregar dispositivos: ' + error.message, 'error');
      this.deviceSelect.innerHTML = '<option value="">Erro ao carregar dispositivos</option>';
      spotifyUI.setLoading(this.refreshBtn, false);
    }
  }

  populateDevices(devices) {
    this.deviceSelect.innerHTML = '';

    if (devices.length === 0) {
      this.deviceSelect.innerHTML = '<option value="">Nenhum dispositivo disponível</option>';
      return;
    }

    const savedDevice = spotifyUI.getSetting('playPause_device_id');

    devices.forEach((device) => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = spotifyUI.formatDeviceInfo(device);

      if (savedDevice === device.id || device.is_active) {
        option.selected = true;
      }

      this.deviceSelect.appendChild(option);
    });
  }

  saveDevice() {
    const deviceId = this.deviceSelect.value;
    if (deviceId) {
      spotifyUI.setSetting('playPause_device_id', deviceId);
      this.showMessage('✅ Dispositivo salvo!', 'info');
    }
  }

  showMessage(text, type = 'info') {
    if (!this.messageDiv) return;

    this.messageDiv.textContent = text;
    this.messageDiv.className = `message message-${type}`;
    this.messageDiv.style.display = 'block';

    if (type === 'info' || type === 'success') {
      setTimeout(() => {
        this.messageDiv.style.display = 'none';
      }, 4000);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    new PlayPauseInspector();
  }, 300);
});
