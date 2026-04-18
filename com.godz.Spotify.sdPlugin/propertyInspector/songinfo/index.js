// Song Info Action Property Inspector
class SongInfoInspector {
  constructor() {
    this.deviceSelect = document.getElementById('device');
    this.showArtist = document.getElementById('showArtist');
    this.showAlbum = document.getElementById('showAlbum');
    this.showDuration = document.getElementById('showDuration');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.init();
  }

  async init() {
    this.refreshBtn.addEventListener('click', () => this.loadDevices());
    this.deviceSelect.addEventListener('change', () => this.saveDevice());
    this.showArtist.addEventListener('change', () => this.saveSettings());
    this.showAlbum.addEventListener('change', () => this.saveSettings());
    this.showDuration.addEventListener('change', () => this.saveSettings());

    // Load saved settings
    this.showArtist.checked = spotifyUI.getSetting('songInfo_showArtist', true);
    this.showAlbum.checked = spotifyUI.getSetting('songInfo_showAlbum', true);
    this.showDuration.checked = spotifyUI.getSetting('songInfo_showDuration', true);

    const hasToken = spotifyUI.getSetting('access_token');
    if (hasToken) await this.loadDevices();

    window.addEventListener('spotifyAuthChanged', () => {
      if (spotifyAuth.isAuthenticated()) {
        this.loadDevices();
      }
    });
  }

  async loadDevices() {
    try {
      spotifyUI.setLoading(this.refreshBtn, true);
      const devices = await spotifyUI.requestDevices();
      this.populateDevices(devices);
      spotifyUI.setLoading(this.refreshBtn, false);
    } catch (error) {
      console.error('Error:', error);
      spotifyUI.setLoading(this.refreshBtn, false);
    }
  }

  populateDevices(devices) {
    this.deviceSelect.innerHTML = '';
    if (!devices || devices.length === 0) {
      this.deviceSelect.innerHTML = '<option value="">Nenhum dispositivo detectado</option>';
      return;
    }
    const savedDevice = spotifyUI.getSetting('songInfo_device_id');
    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = spotifyUI.formatDeviceInfo(device);
      if (savedDevice === device.id || device.is_active) option.selected = true;
      this.deviceSelect.appendChild(option);
    });
  }

  saveDevice() {
    spotifyUI.setSetting('songInfo_device_id', this.deviceSelect.value);
  }

  saveSettings() {
    spotifyUI.setSetting('songInfo_showArtist', this.showArtist.checked);
    spotifyUI.setSetting('songInfo_showAlbum', this.showAlbum.checked);
    spotifyUI.setSetting('songInfo_showDuration', this.showDuration.checked);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => new SongInfoInspector(), 500);
});
