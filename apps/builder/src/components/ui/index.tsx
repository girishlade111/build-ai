"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";
import styles from "./primitives.module.css";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Magic UI — DotPattern
 * Subtle radial-masked architectural dot grid backdrop for hero and settings canvases.
 */
export function DotPattern({
  width = 22,
  height = 22,
  cr = 1.15,
  className,
}: {
  width?: number;
  height?: number;
  cr?: number;
  className?: string;
}) {
  const id = useId();
  return (
    <svg aria-hidden="true" className={cx(styles.dotPattern, className)}>
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          patternContentUnits="userSpaceOnUse"
        >
          <circle cx={width / 2} cy={height / 2} r={cr} fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * Magic UI — MagicCard
 * Cursor-tracking spotlight card with crisp 1px obsidian hairline border.
 */
export function MagicCard({
  children,
  className,
  interactive = false,
  as = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  as?: "div" | "article" | "section" | "li";
} & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement | null>(null);

  function handlePointerMove(e: PointerEvent<HTMLElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spotlight-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--spotlight-y", `${e.clientY - rect.top}px`);
    el.style.setProperty("--spotlight-opacity", "1");
    rest.onPointerMove?.(e);
  }

  function handlePointerLeave(e: PointerEvent<HTMLElement>) {
    const el = ref.current;
    if (el) el.style.setProperty("--spotlight-opacity", "0");
    rest.onPointerLeave?.(e);
  }

  const Component = as;
  return (
    <Component
      {...rest}
      ref={ref as never}
      className={cx(styles.magicCard, interactive && styles.magicCardInteractive, className)}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className={styles.magicCardContent}>{children}</div>
    </Component>
  );
}

/**
 * Magic UI — BorderBeam
 * Animated luminous hairline perimeter beam for primary AI composer and agent surfaces.
 */
export function BorderBeam({
  children,
  active = false,
  className,
  innerClassName,
}: {
  children: ReactNode;
  active?: boolean;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div className={cx(styles.borderBeamWrap, active && styles.borderBeamActive, className)}>
      <div className={styles.borderBeamTrack} aria-hidden="true" />
      <div className={cx(styles.borderBeamInner, innerClassName)}>{children}</div>
    </div>
  );
}

/**
 * Magic UI — ShimmerButton
 * High-intent primary CTA with subtle specular light sweep and crisp elevation.
 */
export function ShimmerButton({
  children,
  compact = false,
  className,
  type = "button",
  ...rest
}: {
  compact?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(styles.shimmerBtn, compact && styles.shimmerBtnCompact, className)}
    >
      {children}
    </button>
  );
}

/**
 * 21st.dev — ActionButton
 * Developer-console secondary, outline, ghost, and destructive action button primitive.
 */
export function ActionButton({
  children,
  variant = "secondary",
  compact = false,
  className,
  type = "button",
  ...rest
}: {
  variant?: "secondary" | "outline" | "ghost" | "danger";
  compact?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(
        styles.actionBtn,
        variant === "ghost" && styles.actionBtnGhost,
        variant === "outline" && styles.actionBtnOutline,
        variant === "danger" && styles.actionBtnDanger,
        compact && styles.actionBtnCompact,
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * 21st.dev — SegmentedControl
 * Crisp studio segmented tab bar with single-line icon + label items.
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: {
  items: ReadonlyArray<{ value: T; label: string; icon?: ReactNode; title?: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cx(styles.segmented, className)} role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={styles.segmentedItem}
          aria-pressed={value === item.value}
          title={item.title}
          disabled={disabled}
          onClick={() => onChange(item.value)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Magic UI — BlurFade
 * Compositor-only entrance reveal for major sections (respects prefers-reduced-motion).
 */
export function BlurFade({
  children,
  delayMs = 0,
  className,
}: {
  children: ReactNode;
  delayMs?: number;
  className?: string;
}) {
  return (
    <div
      className={cx(styles.blurFade, className)}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * Magic UI — NumberTicker
 * Smooth tabular-numeral counter that settles quickly and honors prefers-reduced-motion.
 */
export function NumberTicker({
  value,
  prefix = "",
  suffix = "",
  format = (n: number) => n.toLocaleString(),
  className,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  format?: (n: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const start = prevRef.current;
    prevRef.current = value;
    if (
      start === value ||
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      return;
    }

    let rafId = 0;
    const duration = 260;
    const t0 = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (value - start) * eased));
      if (progress < 1) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        setDisplay(value);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [value]);

  return (
    <span className={cx(styles.ticker, className)}>
      {prefix}
      {format(display)}
      {suffix}
    </span>
  );
}

/**
 * Magic UI — BrowserFrame (adapted from Magic UI Safari frame)
 * Crisp browser window chrome framing the sandboxed live preview iframe.
 */
export function BrowserFrame({
  address,
  actions,
  children,
  className,
}: {
  address: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(styles.browserFrame, className)}>
      <div className={styles.browserChrome}>
        <div className={styles.browserLights} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className={styles.browserAddress} title={address}>
          {address}
        </div>
        {actions}
      </div>
      <div className={styles.browserBody}>{children}</div>
    </div>
  );
}
