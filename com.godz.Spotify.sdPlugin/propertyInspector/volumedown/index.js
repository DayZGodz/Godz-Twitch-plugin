// VolumeDown Action Property Inspector
class VolumeDownInspector {
  constructor() {
    this.deviceSelect = document.getElementById('device');
    this.decrementInput = document.getElementById('decrement');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.init();
  }

  async init() {
    this.refreshBtn.addEventListener('click', () => this.loadDevices());
    this.deviceSelect.addEventListener('change', () => this.saveDevice());
    this.decrementInput.addEventListener('change', () => this.saveDecrement());

    const savedDecrement = spotifyUI.getSetting('volumeDown_decrement', 10);
    this.decrementInput.value = savedDecrement;

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
    const savedDevice = spotifyUI.getSetting('volumeDown_device_id');
    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = spotifyUI.formatDeviceInfo(device);
      if (savedDevice === device.id || device.is_active) option.selected = true;
      this.deviceSelect.appendChild(option);
    });
  }

  saveDevice() {
    spotifyUI.setSetting('volumeDown_device_id', this.deviceSelect.value);
  }

  saveDecrement() {
    spotifyUI.setSetting('volumeDown_decrement', parseInt(this.decrementInput.value));
      // Also notify the plugin backend
      spotifyUI.sendToPlugin({ 
        action: 'updateActionSetting',
        key: 'volumeDown_decrement',
        value: parseInt(this.decrementInput.value)
      });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => new VolumeDownInspector(), 500);
});
