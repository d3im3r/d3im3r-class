type RateLimitOptions = {
  windowMs: number;
  max: number;
};

// Almacén en memoria para limitar ráfagas de solicitudes abusivas
const store = new Map<string, { count: number; resetAt: number }>();

// Limpieza periódica cada 5 minutos de claves expiradas
if (typeof setInterval !== 'undefined') {
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of store.entries()) {
        if (now > entry.resetAt) {
          store.delete(key);
        }
      }
    },
    5 * 60 * 1000
  ).unref?.();
}

/**
 * Verifica si una clave (IP o identificador de usuario) ha superado el límite de llamadas.
 */
export function checkRateLimit(
  key: string,
  options: RateLimitOptions = { windowMs: 60_000, max: 30 }
): {
  success: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    const newEntry = { count: 1, resetAt: now + options.windowMs };
    store.set(key, newEntry);
    return {
      success: true,
      remaining: Math.max(0, options.max - 1),
      resetAt: newEntry.resetAt,
    };
  }

  if (entry.count >= options.max) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  entry.count += 1;
  return {
    success: true,
    remaining: Math.max(0, options.max - entry.count),
    resetAt: entry.resetAt,
  };
}
