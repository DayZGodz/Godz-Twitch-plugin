// VolumeUp Action Property Inspector

class VolumeUpInspector {
  constructor() {
    this.deviceSelect = document.getElementById('device');
    this.incrementInput = document.getElementById('increment');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.messageDiv = document.getElementById('message');
    this.init();
  }

  async init() {
    this.refreshBtn.addEventListener('click', () => this.loadDevices());
    this.deviceSelect.addEventListener('change', () => this.saveDevice());
    this.incrementInput.addEventListener('change', () => this.saveIncrement());

    const savedIncrement = spotifyUI.getSetting('volumeUp_increment', 10);
    this.incrementInput.value = savedIncrement;

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
    const savedDevice = spotifyUI.getSetting('volumeUp_device_id');
    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = spotifyUI.formatDeviceInfo(device);
      if (savedDevice === device.id || device.is_active) option.selected = true;
      this.deviceSelect.appendChild(option);
    });
  }

  saveDevice() {
    spotifyUI.setSetting('volumeUp_device_id', this.deviceSelect.value);
  }

  saveIncrement() {
    spotifyUI.setSetting('volumeUp_increment', parseInt(this.incrementInput.value));
      // Also notify the plugin backend
      spotifyUI.sendToPlugin({ 
        action: 'updateActionSetting',
        key: 'volumeUp_increment',
        value: parseInt(this.incrementInput.value)
      });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => new VolumeUpInspector(), 500);
});
