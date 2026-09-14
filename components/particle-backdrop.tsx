'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/** Decorative, bounded Canvas rendering. No per-frame React state updates. */
export function ParticleBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = canvas?.parentElement;
    if (!canvas || !surface) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let lastFrame = 0;
    let elapsed = 0;
    let visible = true;
    const pointer = { x: -1000, y: -1000 };
    const staticFrame = paused || reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    type Particle = { phase: number; orbit: number; size: number; speed: number; depth: number };
    let particles: Particle[] = [];

    const render = () => {
      context.clearRect(0, 0, width, height);
      const positions = particles.map((particle) => {
        const angle = particle.phase + elapsed * particle.speed;
        // Two tilted elliptical streams leave the prompt and heading visually quiet.
        const rx = width * (.32 + particle.orbit * .17);
        const ry = height * (.14 + particle.orbit * .16);
        let x = width * .5 + Math.cos(angle) * rx;
        let y = height * .39 + Math.sin(angle) * ry + Math.cos(angle) * 34;
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (!staticFrame && distance > 0 && distance < 140) {
          const force = (1 - distance / 140) * 20;
          x += dx / distance * force;
          y += dy / distance * force;
        }
        return { x, y, size: particle.size, depth: particle.depth };
      });
      for (let i = 0; i < positions.length; i++) {
        const a = positions[i];
        for (let j = i + 1; j < positions.length; j++) {
          const b = positions[j];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance < 83) {
            context.strokeStyle = `rgba(58, 157, 220, ${(1 - distance / 83) * .17})`;
            context.lineWidth = .6;
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.stroke();
          }
        }
        if (a.size > 1.6) {
          const halo = context.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.size * 5);
          halo.addColorStop(0, 'rgba(60, 177, 241, .14)');
          halo.addColorStop(1, 'rgba(60, 177, 241, 0)');
          context.fillStyle = halo;
          context.beginPath();
          context.arc(a.x, a.y, a.size * 5, 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = `rgba(35, 150, 219, ${.24 + a.depth * .4})`;
        context.beginPath();
        context.arc(a.x, a.y, a.size, 0, Math.PI * 2);
        context.fill();
      }
    };

    const tick = (now: number) => {
      if (staticFrame || !visible || document.hidden) { frame = 0; return; }
      frame = requestAnimationFrame(tick);
      if (lastFrame && now - lastFrame < 1000 / 30) return;
      elapsed += lastFrame ? Math.min(now - lastFrame, 60) / 1000 : 0;
      lastFrame = now;
      render();
    };
    const start = () => {
      if (!frame && !staticFrame && visible && !document.hidden) {
        lastFrame = 0;
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const rect = surface.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = width < 600 ? 48 : 100;
      particles = Array.from({ length: count }, (_, i) => ({
        phase: i * 2.399963,
        orbit: ((i * 37) % 100) / 100,
        size: .7 + ((i * 13) % 17) / 10,
        speed: .014 + (i % 4) * .004,
        depth: (i % 7) / 7,
      }));
      render();
      start();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const rect = surface.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    };
    const leave = () => { pointer.x = -1000; pointer.y = -1000; };
    const visibility = () => {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
      else start();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) { cancelAnimationFrame(frame); frame = 0; }
      else start();
    });
    intersection.observe(surface);
    const home = surface.parentElement;
    home?.addEventListener('pointermove', move, { passive: true });
    home?.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', visibility);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      home?.removeEventListener('pointermove', move);
      home?.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [paused, reducedMotion]);

  return (
    <div className="home-atmosphere">
      <canvas ref={canvasRef} className="particle-canvas" aria-hidden="true" />
      <button
        className="motion-control"
        type="button"
        onClick={() => setPaused(value => !value)}
        disabled={reducedMotion}
        aria-label={reducedMotion ? '系统已减少动态效果' : paused ? '开启粒子动效' : '暂停粒子动效'}
        aria-pressed={paused || reducedMotion}
        title={reducedMotion ? '遵循系统的减少动态效果设置' : undefined}
      >
        {paused || reducedMotion ? <Play size={12} /> : <Pause size={12} />}
        <span>{reducedMotion ? '静态模式' : paused ? '开启动效' : '暂停动效'}</span>
      </button>
    </div>
  );
}
