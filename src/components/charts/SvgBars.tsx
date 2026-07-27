/**
 * SvgBars — reusable hand-rolled SVG bar chart (vertical histogram or
 * horizontal bar list). Zero npm deps, zero client JS: the "reveal" grow
 * animation and the hover shimmer are pure CSS (embedded <style>, scoped to
 * this component's class names) gated by `prefers-reduced-motion` — the
 * literal WAAPI approach used by PremiumReveal needs a client component +
 * a ref per bar, which would force every future dashboard that imports this
 * into "use client"; a CSS @keyframes animation is compositor-only
 * (transform-only) so it's just as smooth and keeps this a server
 * component. Tooltips are native SVG <title> — also zero JS.
 *
 * Two pure layout helpers (`scaleToPixels`, `barSlot`) are exported
 * separately so the scale math can be unit-tested without rendering React.
 */

export interface SvgBarDatum {
  /** Stable React key. */
  key: string;
  /** Axis / row label. */
  label: string;
  /** Bar magnitude (drives length). */
  value: number;
  /** Hover <title> text; defaults to "label: formattedValue". */
  tooltip?: string;
  /** Amethyst accent instead of gold (e.g. the max day). */
  highlight?: boolean;
  /** Horizontal mode only — text drawn past the bar's end (e.g. "1 240 MDL"). */
  secondaryLabel?: string;
}

export interface SvgBarsProps {
  data: SvgBarDatum[];
  orientation?: "vertical" | "horizontal";
  width?: number;
  height?: number;
  /** Unique per chart instance — avoids <linearGradient> id collisions when
   * several SvgBars render on one page. */
  gradientId: string;
  valueFormatter?: (value: number) => string;
  ariaLabel: string;
  /** Vertical mode only — show an x-axis label every Nth bar (24 hourly bars
   * would collide if every one printed its label). */
  axisLabelEvery?: number;
  /** "brand" (default) = gold bars, amethyst `highlight`. "muted" flips it for
   * restrained info-section charts (e.g. popular-times): non-highlighted bars
   * render as a desaturated navy-indigo solid, `highlight` bars stay gold —
   * "current hour gold, the rest navy-muted". */
  theme?: "brand" | "muted";
}

const GOLD_FROM = "#b8860b";
const GOLD_TO = "#f5c542";
const AMETHYST_FROM = "#6d28d9";
const AMETHYST_TO = "#c084fc";
/** Desaturated navy-indigo — reads as "muted" against the dark navy field
 * without disappearing into it (theme="muted" default bar fill). */
const MUTED_FILL = "rgba(120,128,168,0.28)";

/** value -> pixel length along the value axis. Guards a zero/negative max
 * or track so an all-empty dataset never divides by zero or emits NaN. */
export function scaleToPixels(value: number, maxValue: number, trackPx: number): number {
  if (!(maxValue > 0) || !(trackPx > 0)) return 0;
  const clamped = Math.min(Math.max(value, 0), maxValue);
  return (clamped / maxValue) * trackPx;
}

/** index -> {start,size} for `count` even slots across `trackPx`, separated
 * by `gapPx`. */
export function barSlot(index: number, count: number, trackPx: number, gapPx: number): { start: number; size: number } {
  if (count <= 0) return { start: 0, size: 0 };
  const size = Math.max((trackPx - gapPx * (count - 1)) / count, 0);
  const start = index * (size + gapPx);
  return { start, size };
}

export function SvgBars({
  data,
  orientation = "vertical",
  width = 640,
  height = 220,
  gradientId,
  valueFormatter = (v) => String(v),
  ariaLabel,
  axisLabelEvery = 1,
  theme = "brand",
}: SvgBarsProps) {
  const maxValue = Math.max(...data.map((d) => d.value), 0);
  const padding = {
    top: 14,
    right: 8,
    bottom: orientation === "vertical" ? 24 : 8,
    left: orientation === "vertical" ? 8 : 116,
  };
  const trackW = Math.max(width - padding.left - padding.right, 0);
  const trackH = Math.max(height - padding.top - padding.bottom, 0);
  const gap = orientation === "vertical" ? 4 : 10;
  const hlId = `${gradientId}-hl`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      className="w-full"
      style={{ aspectRatio: `${width} / ${height}` }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={GOLD_FROM} />
          <stop offset="100%" stopColor={GOLD_TO} />
        </linearGradient>
        <linearGradient id={hlId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={AMETHYST_FROM} />
          <stop offset="100%" stopColor={AMETHYST_TO} />
        </linearGradient>
      </defs>
      {/* Scoped to this component's own class names — safe to repeat across
          several SvgBars instances on the same page (identical rules). */}
      <style>{`
        .svgbars-bar { transform: scale(1); }
        @media (prefers-reduced-motion: no-preference) {
          .svgbars-v { animation: svgbars-grow-v 640ms cubic-bezier(.22,1,.36,1) both; }
          .svgbars-h { animation: svgbars-grow-h 640ms cubic-bezier(.22,1,.36,1) both; }
        }
        @keyframes svgbars-grow-v { from { transform: scaleY(0); } to { transform: scaleY(1); } }
        @keyframes svgbars-grow-h { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .svgbars-hit:hover .svgbars-fill { filter: brightness(1.18); }
        .svgbars-glint { opacity: 0; transition: opacity 180ms ease; }
        .svgbars-hit:hover .svgbars-glint { opacity: 0.5; }
      `}</style>
      {orientation === "vertical" ? (
        <line
          x1={padding.left} y1={padding.top + trackH} x2={padding.left + trackW} y2={padding.top + trackH}
          stroke="rgba(255,255,255,0.12)" strokeWidth={1}
        />
      ) : (
        <line
          x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + trackH}
          stroke="rgba(255,255,255,0.12)" strokeWidth={1}
        />
      )}
      {data.map((d, i) => {
        const trackForSlots = orientation === "vertical" ? trackW : trackH;
        const { start, size } = barSlot(i, data.length, trackForSlots, gap);
        const barLen = Math.max(scaleToPixels(d.value, maxValue, orientation === "vertical" ? trackH : trackW), d.value > 0 ? 1 : 0);
        const fill =
          theme === "muted"
            ? d.highlight
              ? `url(#${gradientId})`
              : MUTED_FILL
            : d.highlight
              ? `url(#${hlId})`
              : `url(#${gradientId})`;
        const title = d.tooltip ?? `${d.label}: ${valueFormatter(d.value)}`;

        if (orientation === "vertical") {
          const x = padding.left + start;
          const y = padding.top + trackH - barLen;
          const showLabel = axisLabelEvery > 0 && i % axisLabelEvery === 0;
          return (
            <g key={d.key} className="svgbars-hit">
              <title>{title}</title>
              <rect
                className="svgbars-fill svgbars-bar svgbars-v" x={x} y={y} width={size} height={barLen} rx={2} fill={fill}
                style={{ transformOrigin: `${x + size / 2}px ${padding.top + trackH}px`, animationDelay: `${i * 18}ms` }}
              />
              <rect className="svgbars-glint" x={x} y={y} width={size} height={barLen} rx={2} fill="rgba(255,255,255,0.35)" />
              {showLabel && (
                <text x={x + size / 2} y={height - 6} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.4)">
                  {d.label}
                </text>
              )}
            </g>
          );
        }

        const y = padding.top + start;
        const x = padding.left;
        return (
          <g key={d.key} className="svgbars-hit">
            <title>{title}</title>
            <text x={padding.left - 10} y={y + size / 2 + 3} textAnchor="end" fontSize={11} fill="rgba(255,255,255,0.75)">
              {d.label}
            </text>
            <rect
              className="svgbars-fill svgbars-bar svgbars-h" x={x} y={y} width={barLen} height={size} rx={2} fill={fill}
              style={{ transformOrigin: `${x}px ${y + size / 2}px`, animationDelay: `${i * 18}ms` }}
            />
            <rect className="svgbars-glint" x={x} y={y} width={barLen} height={size} rx={2} fill="rgba(255,255,255,0.35)" />
            <text x={x + barLen + 8} y={y + size / 2 + 3} fontSize={11} fill="#f5c542">
              {d.secondaryLabel ?? valueFormatter(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
