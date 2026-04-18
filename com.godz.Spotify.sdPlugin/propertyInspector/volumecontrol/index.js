// VolumeControl Action Property Inspector

class VolumeControlInspector {
  constructor() {
    this.deviceSelect = document.getElementById('device');
    this.stepInput = document.getElementById('step');
    this.refreshBtn = document.getElementById('refreshBtn');
    this.messageDiv = document.getElementById('message');
    this.deviceSection = document.getElementById('device-section');
    
    this.init();
  }

  async init() {
    this.refreshBtn.addEventListener('click', () => this.loadDevices());
    this.deviceSelect.addEventListener('change', () => this.saveDevice());
    this.stepInput.addEventListener('change', () => this.saveStep());

    const savedStep = spotifyUI.getSetting('step', 5);
    this.stepInput.value = savedStep;

    const hasToken = spotifyUI.getSetting('access_token');
    if (!hasToken) {
      this.showMessage('Faça login', 'warning');
    } else {
      if (this.deviceSection) this.deviceSection.style.display = 'block';
      await this.loadDevices();
    }

    window.addEventListener('spotifyAuthChanged', () => {
      if (spotifyAuth.isAuthenticated()) {
        if (this.deviceSection) this.deviceSection.style.display = 'block';
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
    const savedDevice = spotifyUI.getSetting('volumeControl_device_id');

    devices.forEach(device => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = spotifyUI.formatDeviceInfo(device);
      if (savedDevice === device.id || device.is_active) option.selected = true;
      this.deviceSelect.appendChild(option);
    });
  }

  saveDevice() {
    spotifyUI.setSetting('volumeControl_device_id', this.deviceSelect.value);
  }

  saveStep() {
    let val = parseInt(this.stepInput.value) || 5;
    if (val < 1) val = 1;
    if (val > 100) val = 100;
    this.stepInput.value = val;
    spotifyUI.setSetting('step', val);
    spotifyUI.sendToPlugin({ type: 'setting_changed', key: 'step', value: val });
  }

  showMessage(text, type = 'info') {
    this.messageDiv.textContent = text;
    this.messageDiv.className = `message ${type}`;
    this.messageDiv.style.display = 'block';
    if (type === 'info') setTimeout(() => { this.messageDiv.style.display = 'none'; }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => new VolumeControlInspector(), 500);
});
