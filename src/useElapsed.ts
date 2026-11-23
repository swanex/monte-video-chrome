// @ts-nocheck
import { useEffect, useRef, useState } from 'react';

/** Секунды с момента, когда active стал true (для бегущего таймера генерации). */
export function useElapsed(active) {
  const startRef = useRef(null);
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) { startRef.current = null; setSec(0); return; }
    startRef.current = Date.now();
    setSec(0);
    const t = setInterval(() => setSec(Math.floor((Date.now() - startRef.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [active]);
  return sec;
}

export const formatElapsed = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
