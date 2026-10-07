import { useId } from "react";

import type { Icon } from "./Icons";

/** OMP's π mark and gradient, as published at omp.sh. */
export const OmpIcon: Icon = (props) => {
  const gradientId = `${useId().replaceAll(":", "")}-omp`;

  return (
    <svg {...props} viewBox="10 13 44 44">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ed4abf" />
          <stop offset=".5" stopColor="#9b4dff" />
          <stop offset="1" stopColor="#5ad8e6" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradientId})`} d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
    </svg>
  );
};
