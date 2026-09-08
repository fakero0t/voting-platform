/* Tiny confetti burst — canvas particles, no dependencies. */
(function () {
  const canvas = document.getElementById('confetti');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const COLORS = ['#FF6B5E', '#FFB627', '#22C79B', '#6C8CFF', '#A97BFF', '#FF7EB6'];
  let particles = [];
  let running = false;

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
  }
  resize();
  window.addEventListener('resize', resize);

  function reduced() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  window.burstConfetti = function (x, y) {
    if (reduced()) return;
    const cx = (x ?? window.innerWidth / 2) * devicePixelRatio;
    const cy = (y ?? window.innerHeight / 2) * devicePixelRatio;
    for (let i = 0; i < 90; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (Math.random() * 9 + 4) * devicePixelRatio;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 6 * devicePixelRatio,
        size: (Math.random() * 8 + 4) * devicePixelRatio,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        life: 1,
      });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  };

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gravity = 0.35 * devicePixelRatio;
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      p.rot += p.vr;
      p.life -= 0.012;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (particles.length) {
      requestAnimationFrame(tick);
    } else {
      running = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
})();
