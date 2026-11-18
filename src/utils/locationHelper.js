/**
 * Utilitários de hora exata, duração entre datas e localização GPS exata na cabine.
 */

export function getCurrentTimeHM(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function buildDateTimeMs(dateStr, timeStr) {
  if (!dateStr) return null;
  const safeTime = timeStr && /^\d{2}:\d{2}/.test(timeStr) ? timeStr.slice(0, 5) : '00:00';
  const dt = new Date(`${dateStr}T${safeTime}:00`);
  const ms = dt.getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function isEndBeforeStart(startDate, startTime, endDate, endTime) {
  const startMs = buildDateTimeMs(startDate, startTime);
  const endMs = buildDateTimeMs(endDate, endTime);
  if (startMs === null || endMs === null) return false;
  return endMs < startMs;
}

export function calculateShiftDurationLabel(startDate, startTime, endDate, endTime) {
  if (!startDate || !startTime || !endDate || !endTime) return null;
  const startMs = buildDateTimeMs(startDate, startTime);
  const endMs = buildDateTimeMs(endDate, endTime);
  if (startMs === null || endMs === null || endMs < startMs) return null;

  const totalMinutes = Math.round((endMs - startMs) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

function formatNominatimAddress(data, lat, lon) {
  const addr = data?.address || {};
  const street =
    addr.road ||
    addr.highway ||
    addr.motorway ||
    addr.industrial ||
    addr.suburb ||
    '';
  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.county ||
    '';
  const countryCode = addr.country_code
    ? String(addr.country_code).toUpperCase()
    : addr.country || '';

  const parts = [street, city, countryCode].filter(Boolean);
  if (parts.length > 0) {
    return parts.join(', ');
  }
  if (data?.display_name) {
    return String(data.display_name).split(',').slice(0, 3).join(',').trim();
  }
  return `GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

async function reverseGeocode(lat, lon) {
  // Tentativa 1: OpenStreetMap Nominatim (detalhado com rodovia/rua + cidade + país)
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`,
      { headers: { Accept: 'application/json' } }
    );
    if (res.ok) {
      const data = await res.json();
      return formatNominatimAddress(data, lat, lon);
    }
  } catch {
    // Segue para fallback
  }

  // Tentativa 2: BigDataCloud client reverse geocode
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(
        lat
      )}&longitude=${encodeURIComponent(lon)}&localityLanguage=pt`
    );
    if (res.ok) {
      const data = await res.json();
      const locality = data.locality || data.city || '';
      const area = data.principalSubdivision || '';
      const country = data.countryCode || data.countryName || '';
      const parts = [locality, area, country].filter(Boolean);
      if (parts.length > 0) {
        return parts.join(', ');
      }
    }
  } catch {
    // Segue para fallback offline
  }

  // Fallback offline garantido com coordenadas exatas
  return `GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * Captura a posição GPS exata do dispositivo e resolve cidade/rodovia/país
 * (ou coordenadas GPS se estiver offline).
 */
export function fetchExactCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('GPS não suportado neste navegador/aparelho.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const label = await reverseGeocode(latitude, longitude);
        resolve({
          label,
          latitude,
          longitude,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(
            new Error(
              'Permissão de localização negada. Ative o GPS para este site nas configurações do navegador.'
            )
          );
        } else if (err.code === err.TIMEOUT) {
          reject(
            new Error(
              'Tempo esgotado ao buscar sinal GPS. Tente novamente próximo ao para-brisa.'
            )
          );
        } else {
          reject(new Error('Não foi possível obter a localização GPS atual.'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      }
    );
  });
}
