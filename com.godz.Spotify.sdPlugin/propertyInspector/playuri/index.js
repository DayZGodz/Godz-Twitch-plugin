// Play URI Action Property Inspector
class PlayUriInspector {
  constructor() {
    this.deviceSelect = document.getElementById('device');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.uriInput = document.getElementById('uri');
    this.playOptionSelect = document.getElementById('playOption');
    this.deviceSection = document.getElementById('device-section');
    this.init();
  }

  async init() {
    this.refreshBtn.addEventListener('click', () => this.loadDevices());
    this.deviceSelect.addEventListener('change', () => this.saveSettings());
    this.uriInput.addEventListener('input', () => this.saveSettings());
    this.playOptionSelect.addEventListener('change', () => this.saveSettings());

    new LoginButton('#auth-buttons');

    window.addEventListener('spotifyAuthChanged', () => {
      this.onAuthStateChanged(spotifyAuth.isAuthenticated());
    });

    this.onAuthStateChanged(spotifyAuth.isAuthenticated());
    this.loadSavedSettings();
  }

  onAuthStateChanged(authenticated) {
    if (this.deviceSection) this.deviceSection.style.display = authenticated ? 'block' : 'none';
    if (authenticated) this.loadDevices();
  }

  loadSavedSettings() {
    const uri = spotifyUI.getSetting('uri', '');
    const playOption = spotifyUI.getSetting('playOption', 'play');
    if (this.uriInput) this.uriInput.value = uri;
    if (this.playOptionSelect) this.playOptionSelect.value = playOption;
  }

  async loadDevices() {
    try {
      spotifyUI.setLoading(this.refreshBtn, true);
      const devices = await spotifyUI.requestDevices();
      this.populateDevices(devices);
    } catch (error) {
      console.error('Error loading devices:', error);
    } finally {
      spotifyUI.setLoading(this.refreshBtn, false);
    }
  }

  populateDevices(devices) {
    this.deviceSelect.innerHTML = '';
    if (!devices || devices.length === 0) {
      this.deviceSelect.innerHTML = '<option value="">Nenhum dispositivo detectado</option>';
      return;
    }
    const savedDevice = spotifyUI.getSetting('device_id');
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'Dispositivo atual';
    this.deviceSelect.appendChild(noneOpt);
    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = spotifyUI.formatDeviceInfo ? spotifyUI.formatDeviceInfo(device) : `${device.name} (${device.type})`;
      if (savedDevice === device.id) option.selected = true;
      this.deviceSelect.appendChild(option);
    });
  }

  saveSettings() {
    spotifyUI.setSetting('device_id', this.deviceSelect.value);
    spotifyUI.setSetting('uri', this.uriInput.value.trim());
    spotifyUI.setSetting('playOption', this.playOptionSelect.value);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => new PlayUriInspector(), 500);
});
