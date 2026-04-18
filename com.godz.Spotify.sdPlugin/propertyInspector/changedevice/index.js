// Change Device Action Property Inspector
class ChangeDeviceInspector {
  constructor() {
    this.deviceSelect = document.getElementById('device');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.deviceSection = document.getElementById('device-section');
    this.init();
  }

  async init() {
    this.refreshBtn.addEventListener('click', () => this.loadDevices());
    this.deviceSelect.addEventListener('change', () => this.saveDevice());

    new LoginButton('#auth-buttons');

    window.addEventListener('spotifyAuthChanged', () => {
      this.onAuthStateChanged(spotifyAuth.isAuthenticated());
    });

    this.onAuthStateChanged(spotifyAuth.isAuthenticated());
  }

  onAuthStateChanged(authenticated) {
    if (this.deviceSection) this.deviceSection.style.display = authenticated ? 'block' : 'none';
    if (authenticated) this.loadDevices();
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
    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = spotifyUI.formatDeviceInfo ? spotifyUI.formatDeviceInfo(device) : `${device.name} (${device.type})`;
      if (savedDevice === device.id || (!savedDevice && device.is_active)) option.selected = true;
      this.deviceSelect.appendChild(option);
    });
    if (!savedDevice && devices.length > 0) this.saveDevice();
  }

  saveDevice() {
    spotifyUI.setSetting('device_id', this.deviceSelect.value);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => new ChangeDeviceInspector(), 500);
});
