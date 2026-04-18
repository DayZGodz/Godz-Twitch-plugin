// Repeat Action Property Inspector
class RepeatInspector {
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
  setTimeout(() => new RepeatInspector(), 500);
});
