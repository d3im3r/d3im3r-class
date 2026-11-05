import confetti from 'canvas-confetti';

/**
 * Dispara una ráfaga de confeti estilo celebración
 * cuando un estudiante completa una lección o logra un hito.
 */
export function fireCelebration() {
  if (typeof window === 'undefined') return;

  const count = 200;
  const defaults = {
    origin: { y: 0.7 },
    zIndex: 99999,
  };

  function fire(particleRatio: number, opts: confetti.Options) {
    try {
      void confetti({
        ...defaults,
        ...opts,
        particleCount: Math.floor(count * particleRatio),
      });
    } catch {
      // Si el navegador bloquea canvas o hay problemas con WebGL/2D context, degradar silenciosamente
    }
  }

  fire(0.25, {
    spread: 26,
    startVelocity: 55,
  });
  fire(0.2, {
    spread: 60,
  });
  fire(0.35, {
    spread: 100,
    decay: 0.91,
    scalar: 0.8,
  });
  fire(0.1, {
    spread: 120,
    startVelocity: 25,
    decay: 0.92,
    scalar: 1.2,
  });
  fire(0.1, {
    spread: 120,
    startVelocity: 45,
  });
}
