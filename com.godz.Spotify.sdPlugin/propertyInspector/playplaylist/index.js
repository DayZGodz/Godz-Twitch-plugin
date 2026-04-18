// PlayPlaylist Action Property Inspector

class PlayPlaylistInspector {
  constructor() {
    this.deviceSelect = document.getElementById('device');
    this.playlistSelect = document.getElementById('playlist');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.showCoverCheckbox = document.getElementById('showCover');
    this.messageDiv = document.getElementById('message');
    this.deviceSection = document.getElementById('device-section');
    
    this.init();
  }

  init() {
    this.refreshBtn.addEventListener('click', () => this.refresh());
    this.deviceSelect.addEventListener('change', () => this.saveDevice());
    this.playlistSelect.addEventListener('change', () => this.savePlaylist());
    this.showCoverCheckbox.addEventListener('change', () => this.saveCoverOption());

    // Restore showCover from settings
    const savedShowCover = spotifyUI.getSetting('showCover');
    if (savedShowCover !== null) {
      this.showCoverCheckbox.checked = savedShowCover;
    }

    // Listen for data arriving from plugin via sendToPropertyInspector
    spotifyUI.onSettingsReceived = (settings) => {
      if (settings.devices) this.populateDevices(settings.devices);
      if (settings.playlists) this.populatePlaylists(settings.playlists);
      if (this.deviceSection) this.deviceSection.style.display = 'block';
    };

    // Also handle direct message events from handleMessage
    const origHandler = spotifyUI.handleMessage.bind(spotifyUI);
    spotifyUI.handleMessage = (payload) => {
      // Extract data before passing to original handler
      const data = payload?.payload || payload;
      if (data?.devices) this.populateDevices(data.devices);
      if (data?.playlists) this.populatePlaylists(data.playlists);
      if (data?.devices || data?.playlists) {
        if (this.deviceSection) this.deviceSection.style.display = 'block';
      }
      origHandler(payload);
    };

    const hasToken = spotifyUI.getSetting('access_token');
    if (hasToken) {
      if (this.deviceSection) this.deviceSection.style.display = 'block';
    }

    window.addEventListener('spotifyAuthChanged', () => {
      const token = spotifyUI.getSetting('access_token');
      if (token) {
        if (this.deviceSection) this.deviceSection.style.display = 'block';
      }
    });

    // Check if data already arrived before our intercept was installed (race condition)
    const cachedDevices = spotifyUI.getSetting('devices');
    const cachedPlaylists = spotifyUI.getSetting('playlists');
    if (Array.isArray(cachedDevices) && cachedDevices.length > 0) {
      this.populateDevices(cachedDevices);
      if (this.deviceSection) this.deviceSection.style.display = 'block';
    }
    if (Array.isArray(cachedPlaylists) && cachedPlaylists.length > 0) {
      this.populatePlaylists(cachedPlaylists);
      if (this.deviceSection) this.deviceSection.style.display = 'block';
    }

    // Also proactively request fresh data from plugin
    spotifyUI.sendToPlugin({ type: 'refresh' });
  }

  refresh() {
    this.deviceSelect.innerHTML = '<option value="">Carregando...</option>';
    this.playlistSelect.innerHTML = '<option value="">Carregando...</option>';
    spotifyUI.sendToPlugin({ type: 'refresh' });
  }

  populateDevices(devices) {
    this.deviceSelect.innerHTML = '';
    if (!devices || devices.length === 0) {
      this.deviceSelect.innerHTML = '<option value="">Nenhum dispositivo detectado</option>';
      return;
    }
    const savedDevice = spotifyUI.getSetting('device_id');

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = `${device.name} (${device.type})${device.is_active ? ' ✓' : ''}`;
      if (savedDevice === device.id || (!savedDevice && device.is_active)) {
        option.selected = true;
      }
      this.deviceSelect.appendChild(option);
    });

    // Auto-save first device if none saved
    if (!savedDevice && this.deviceSelect.value) {
      this.saveDevice();
    }
  }

  populatePlaylists(playlists) {
    this.playlistSelect.innerHTML = '';
    if (!playlists || playlists.length === 0) {
      this.playlistSelect.innerHTML = '<option value="">Nenhuma playlist encontrada</option>';
      return;
    }
    const savedUri = spotifyUI.getSetting('uri');

    playlists.forEach(playlist => {
      const option = document.createElement('option');
      option.value = playlist.uri;
      const total = playlist.tracks?.total ?? playlist.tracks ?? 0;
      option.textContent = `${playlist.name} (${total} faixas)`;
      if (savedUri === playlist.uri) {
        option.selected = true;
      }
      this.playlistSelect.appendChild(option);
    });

    // Auto-save first playlist if none saved
    if (!savedUri && this.playlistSelect.value) {
      this.savePlaylist();
    }
  }

  saveDevice() {
    const val = this.deviceSelect.value;
    spotifyUI.setSetting('device_id', val);
    spotifyUI.sendToPlugin({ type: 'setting_changed', key: 'device_id', value: val });
  }

  savePlaylist() {
    const val = this.playlistSelect.value;
    spotifyUI.setSetting('uri', val);
    spotifyUI.sendToPlugin({ type: 'setting_changed', key: 'uri', value: val });
  }

  saveCoverOption() {
    const val = this.showCoverCheckbox.checked;
    spotifyUI.setSetting('showCover', val);
    spotifyUI.sendToPlugin({ type: 'setting_changed', key: 'showCover', value: val });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PlayPlaylistInspector();
});
