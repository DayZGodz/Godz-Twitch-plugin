// Shuffle Action Property Inspector
class ShuffleInspector {
  constructor() {
    this.deviceSection = document.getElementById('device-section');
    this.init();
  }

  init() {
    new LoginButton('#auth-buttons');

    window.addEventListener('spotifyAuthChanged', () => {
      if (this.deviceSection) {
        this.deviceSection.style.display = spotifyAuth.isAuthenticated() ? 'block' : 'none';
      }
    });

    if (this.deviceSection) {
      this.deviceSection.style.display = spotifyAuth.isAuthenticated() ? 'block' : 'none';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => new ShuffleInspector(), 500);
});
