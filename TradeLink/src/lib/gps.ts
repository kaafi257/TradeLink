export type Fix = { lat: number; lng: number; accuracy: number };

/** Asks the phone for its GPS position once, with plain-language errors. */
export function getFix(timeoutMs = 20000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("This device cannot share its location.")); return; }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      e => reject(new Error(e.code === 1 ? "Location is off. Turn on GPS and allow location for this site, then try again." : e.code === 3 ? "Finding your location took too long. Go near a window or outside and try again." : "Could not get your location. Please try again.")),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 });
  });
}

/** Straight-line distance in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * Waits for the most accurate GPS position instead of taking the first guess.
 * Phones first report a rough network position (often hundreds of metres off) and refine it over a few seconds.
 * Resolves as soon as the accuracy is good enough, or with the best position found when the time is up.
 */
export function getBestFix(opts: { targetM?: number; maxMs?: number; onProgress?: (accuracyM: number) => void } = {}): Promise<Fix> {
  const { targetM = 30, maxMs = 25000, onProgress } = opts;
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("This device cannot share its location.")); return; }
    let best: Fix | null = null, done = false;
    const finish = (f: Fix | null, err?: Error) => {
      if (done) return; done = true; navigator.geolocation.clearWatch(id); window.clearTimeout(timer);
      if (f) resolve(f); else reject(err ?? new Error("Could not get your location. Please try again."));
    };
    const id = navigator.geolocation.watchPosition(
      p => {
        const f = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) };
        if (!best || f.accuracy < best.accuracy) best = f;
        onProgress?.(best.accuracy);
        if (best.accuracy <= targetM) finish(best);
      },
      e => finish(best, new Error(e.code === 1 ? "Location is off. Turn on GPS and allow location for this site, then try again." : "Could not get your location. Please try again.")),
      { enableHighAccuracy: true, timeout: maxMs, maximumAge: 0 });
    const timer = window.setTimeout(() => finish(best, new Error("Finding your location took too long. Go outside or near a window and try again.")), maxMs);
  });
}
