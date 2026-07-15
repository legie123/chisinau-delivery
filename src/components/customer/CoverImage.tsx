const CUISINE_COVER: Record<string, { gradient: string; emoji: string }> = {
  sushi: { gradient: "linear-gradient(135deg, #16213e 0%, #0f3460 55%, #e94560 130%)", emoji: "🍣" },
  fine_dining: { gradient: "linear-gradient(135deg, #1a1a2e 0%, #3d2c1e 60%, #f5a623 140%)", emoji: "🥂" },
  other: { gradient: "linear-gradient(135deg, #1a1a2e 0%, #252540 60%, #e94560 140%)", emoji: "🍽️" },
};

// Bolt-style large cover. Falls back to a branded gradient + dish emoji when
// the restaurant has no photo yet, so cards never look broken.
export function CoverImage({
  src,
  cuisine,
  alt,
  heightClass = "h-44",
  children,
}: {
  src: string | null;
  cuisine: string;
  alt: string;
  heightClass?: string;
  children?: React.ReactNode;
}) {
  const fallback = CUISINE_COVER[cuisine] ?? CUISINE_COVER.other;

  return (
    <div className={`relative w-full overflow-hidden rounded-2xl ${heightClass}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ background: fallback.gradient }}
        >
          <span className="text-6xl opacity-90" aria-hidden>
            {fallback.emoji}
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
