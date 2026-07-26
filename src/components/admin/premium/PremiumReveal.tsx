"use client";

import { useEffect, useRef } from "react";

/**
 * PremiumReveal — reveals its children with the Dragons "ARRIVAL" entrance
 * (rise + fade + faint scale-in) on mount, via the Web Animations API.
 *
 * - transform/opacity only → composited, 60fps.
 * - No-op under prefers-reduced-motion: reduce (children appear instantly).
 * - `delay` staggers a list (e.g. index * 60ms) so a queue cascades in.
 * - `as` lets a caller keep correct semantics (e.g. "li" inside a <ul>).
 *
 * Builders wrap cards/rows: <PremiumReveal as="li" delay={i * 60}>…</PremiumReveal>.
 * It only orchestrates the mount animation — it never alters layout, props,
 * or the child's own behaviour.
 */
type PremiumRevealProps<T extends keyof React.JSX.IntrinsicElements> = {
  as?: T;
  delay?: number;
  children: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "children" | "ref">;

export function PremiumReveal<T extends keyof React.JSX.IntrinsicElements = "div">({
  as,
  delay = 0,
  children,
  ...rest
}: PremiumRevealProps<T>) {
  const ref = useRef<HTMLElement>(null);
  const Tag = (as ?? "div") as keyof React.JSX.IntrinsicElements;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Reduced motion, no WAAPI support, or SSR fallback → show instantly.
    if (prefersReduced || typeof el.animate !== "function") return;

    const anim = el.animate(
      [
        { opacity: 0, transform: "translate3d(0,14px,0) scale(0.985)" },
        { opacity: 1, transform: "translate3d(0,0,0) scale(1)" },
      ],
      {
        duration: 520,
        delay,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "backwards",
      },
    );

    return () => anim.cancel();
  }, [delay]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Comp = Tag as any;
  return (
    <Comp ref={ref} {...rest}>
      {children}
    </Comp>
  );
}
