/**
 * A premium wireframe globe (the education/global motif). Pure SVG + CSS — no JS,
 * no 3D lib, fast. The sphere grid is static; a dashed orbit ring + satellites
 * convey gentle motion (stopped under prefers-reduced-motion via globals.css).
 * Decorative → aria-hidden.
 */
export function Globe({ className }: { className?: string }) {
  const meridians = [40, 90, 140];
  return (
    <svg viewBox="0 0 400 400" className={className} aria-hidden="true" fill="none">
      <defs>
        <radialGradient id="globe-fill" cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#1C2542" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0B1020" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* faint sphere fill + edge */}
      <circle cx="200" cy="200" r="150" fill="url(#globe-fill)" />
      <circle cx="200" cy="200" r="150" stroke="#3A4570" strokeWidth="1" />

      {/* latitude + longitude wireframe */}
      <g stroke="#3A4570" strokeWidth="1" opacity="0.8">
        {meridians.map((rx) => (
          <ellipse key={`v${rx}`} cx="200" cy="200" rx={rx} ry="150" />
        ))}
        {meridians.map((ry) => (
          <ellipse key={`h${ry}`} cx="200" cy="200" rx="150" ry={ry} />
        ))}
        <line x1="50" y1="200" x2="350" y2="200" />
      </g>

      {/* a few gold "knowledge points" on the sphere */}
      <g fill="#E8B64C">
        <circle cx="150" cy="120" r="3" />
        <circle cx="262" cy="168" r="3" />
        <circle cx="176" cy="262" r="3" />
        <circle cx="248" cy="250" r="2.5" />
      </g>

      {/* slow-rotating orbit ring + satellite */}
      <g className="origin-center animate-spinslow">
        <circle cx="200" cy="200" r="178" stroke="#E8B64C" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 10" />
        <circle cx="200" cy="22" r="4" fill="#E8B64C" />
      </g>
    </svg>
  );
}
