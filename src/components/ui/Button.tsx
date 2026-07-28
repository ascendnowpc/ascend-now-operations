import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "xs" | "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-lime-300 text-navy-700 hover:bg-lime-400 focus-visible:bg-lime-400",
  secondary: "bg-navy-600 text-white hover:bg-navy-700 focus-visible:bg-navy-700",
  danger: "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
  ghost: "bg-transparent text-navy-600 hover:bg-navy-50 border border-navy-200",
};

const sizeClasses: Record<Size, string> = {
  xs: "px-2.5 py-1 text-xs",
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`rounded-pill font-semibold transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
