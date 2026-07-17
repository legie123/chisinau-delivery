// Deep-link to turn-by-turn navigation. Google Maps' universal directions URL
// opens the native app on mobile and the web map on desktop — works everywhere,
// no API key. The courier taps this to route to the pickup / dropoff.
export function NavigateButton({
  lat,
  lng,
  label = "Navighează",
  className = "",
}: {
  lat: number;
  lng: number;
  label?: string;
  className?: string;
}) {
  const href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15 ${className}`}
    >
      <span aria-hidden>🧭</span>
      {label}
    </a>
  );
}
