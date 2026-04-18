// RemovePlaylistSong Action Property Inspector

class RemovePlaylistSongInspector {
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

    const savedShowCover = spotifyUI.getSetting('showCover');
    if (savedShowCover !== null) {
      this.showCoverCheckbox.checked = savedShowCover;
    }

    spotifyUI.onSettingsReceived = (settings) => {
      if (settings.devices) this.populateDevices(settings.devices);
      if (settings.playlists) this.populatePlaylists(settings.playlists);
      if (this.deviceSection) this.deviceSection.style.display = 'block';
    };

    const origHandler = spotifyUI.handleMessage.bind(spotifyUI);
    spotifyUI.handleMessage = (payload) => {
      const data = payload?.payload || payload;
      if (data?.devices) this.populateDevices(data.devices);
      if (data?.playlists) this.populatePlaylists(data.playlists);
      if (data?.devices || data?.playlists) {
        if (this.deviceSection) this.deviceSection.style.display = 'block';
      }
      origHandler(payload);
    };

    const hasToken = spotifyUI.getSetting('access_token');
    if (hasToken && this.deviceSection) this.deviceSection.style.display = 'block';

    window.addEventListener('spotifyAuthChanged', () => {
      if (spotifyUI.getSetting('access_token') && this.deviceSection)
        this.deviceSection.style.display = 'block';
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
    const saved = spotifyUI.getSetting('device_id');
    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = `${device.name} (${device.type})${device.is_active ? ' \u2713' : ''}`;
      if (saved === device.id || (!saved && device.is_active)) option.selected = true;
      this.deviceSelect.appendChild(option);
    });
    if (!saved && this.deviceSelect.value) this.saveDevice();
  }

  populatePlaylists(playlists) {
    this.playlistSelect.innerHTML = '';
    if (!playlists || playlists.length === 0) {
      this.playlistSelect.innerHTML = '<option value="">Nenhuma playlist encontrada</option>';
      return;
    }
    const saved = spotifyUI.getSetting('playlist_id');
    playlists.forEach(playlist => {
      const option = document.createElement('option');
      option.value = playlist.id;
      const total = playlist.tracks?.total ?? playlist.tracks ?? 0;
      option.textContent = `${playlist.name} (${total} faixas)`;
      if (saved === playlist.id) option.selected = true;
      this.playlistSelect.appendChild(option);
    });
    if (!saved && this.playlistSelect.value) this.savePlaylist();
  }

  saveDevice() {
    const val = this.deviceSelect.value;
    spotifyUI.setSetting('device_id', val);
    spotifyUI.sendToPlugin({ type: 'setting_changed', key: 'device_id', value: val });
  }
  savePlaylist() {
    const val = this.playlistSelect.value;
    spotifyUI.setSetting('playlist_id', val);
    spotifyUI.sendToPlugin({ type: 'setting_changed', key: 'playlist_id', value: val });
  }
  saveCoverOption() {
    const val = this.showCoverCheckbox.checked;
    spotifyUI.setSetting('showCover', val);
    spotifyUI.sendToPlugin({ type: 'setting_changed', key: 'showCover', value: val });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new RemovePlaylistSongInspector();
});
