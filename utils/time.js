// Every timestamp in this pipeline used Date.prototype.toISOString(), which
// always renders in UTC — fine for a server, unhelpful when a human is
// reading dateFirstSeen/dateLastSeen and expects their own local time.
// These helpers instead render the system's local wall-clock time with its
// actual UTC offset (still valid ISO 8601 — the spec allows an offset, not
// just "Z"), so results are correct across DST without hardcoding a zone.

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

export function nowLocalIso() {
  const d = new Date();
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    offset
  );
}

export function todayLocalDate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
