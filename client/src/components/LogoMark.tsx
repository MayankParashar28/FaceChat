import { useId, type SVGAttributes } from "react";
import { cn } from "@/lib/utils";

type LogoMarkProps = SVGAttributes<SVGSVGElement>;

export function LogoMark({ className, ...props }: LogoMarkProps) {
  const gradientId = useId();
  const lensId = `${gradientId}-lens`;

  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
      className={cn("h-8 w-8", className)}
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="20%" y1="85%" x2="85%" y2="15%">
          <stop offset="0%" stopColor="#191a33" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <radialGradient id={lensId} cx="50%" cy="45%" r="40%">
          <stop offset="0%" stopColor="#b9c0ff" />
          <stop offset="100%" stopColor="#4c5bff" />
        </radialGradient>
      </defs>

      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <path
        d="M17 28c0-6.075 4.925-11 11-11h8c6.075 0 11 4.925 11 11v2.8l6.4-3.7a2.6 2.6 0 0 1 3.9 2.25v15.3a2.6 2.6 0 0 1-3.9 2.25L47 43.2V46c0 6.075-4.925 11-11 11H28c-6.075 0-11-4.925-11-11Zm19 1c-5.523 0-10 4.477-10 10s4.477 10 10 10 10-4.477 10-10-4.477-10-10-10Z"
        fill="rgba(247,248,255,0.96)"
      />
      <circle cx="32" cy="39" r="7" fill={`url(#${lensId})`} />
      <path
        d="M23 18c2.4-2.8 5.9-4.5 9.8-4.5 3.9 0 7.5 1.7 9.9 4.5"
        stroke="#8f95ff"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M19 20c3.1-4.3 8.1-7.1 13.9-7.1 5.8 0 10.9 2.8 14 7.1"
        stroke="#4e5cff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}

