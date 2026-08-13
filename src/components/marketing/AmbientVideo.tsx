"use client";

import { useEffect, useState } from "react";

// Ambient hero-video backdrop (Higgsfield/Seedance real loops — last frame
// equals first, so `loop` has no visible seam). Design contract from the
// generation brief: ALWAYS under a navy overlay for text legibility, poster
// as the SSR/LCP base layer, and prefers-reduced-motion gets the poster only.
// The <video> mounts client-side after the media query says motion is OK —
// no hydration mismatch, no bytes wasted for reduced-motion users.
export function AmbientVideo({ src, poster }: { src: string; poster: string }) {
  const [motionOk, setMotionOk] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setMotionOk(!mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- house style: plain img, CDN-proof */}
      <img src={poster} alt="" className="h-full w-full object-cover" />
      {motionOk && (
        <video
          // React does not reliably write the `muted` ATTRIBUTE from JSX
          // (facebook/react#10389) and un-muted videos are autoplay-blocked —
          // set it imperatively and kick play() explicitly.
          ref={(el) => {
            if (el) {
              el.muted = true;
              el.play().catch(() => {});
            }
          }}
          src={src}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* navy veil — keeps tiles/typography legible over any frame */}
      <div className="absolute inset-0 bg-[#0a0a14]/70" />
      {/* bottom anchor so content near the fold sits on near-solid ground */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#0a0a14] to-transparent" />
    </div>
  );
}
