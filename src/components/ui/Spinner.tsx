export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="rounded-full border-2 border-lime-200 border-t-lime-400 animate-spin shrink-0"
    />
  );
}
