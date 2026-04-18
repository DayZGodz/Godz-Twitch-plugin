// Like Song Action Property Inspector
class LikeSongInspector {
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
  setTimeout(() => new LikeSongInspector(), 500);
});
