/**
 * The FlowTask mark: three board columns and a check, in currentColor. Put it
 * on a coloured square, as the favicon and docs/assets/logo.svg do:
 *
 *   <div className="bg-primary-600 rounded-lg ..."><BrandMark className="h-5 w-5 text-white" /></div>
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden className={className} viewBox="8.5 8 48 48" fill="none">
      <rect x="13" y="14" width="10" height="36" rx="3" fill="currentColor" fillOpacity={0.55} />
      <rect x="27" y="14" width="10" height="26" rx="3" fill="currentColor" fillOpacity={0.8} />
      <rect x="41" y="14" width="10" height="16" rx="3" fill="currentColor" />
      <path
        d="M40 44l4 4l8-9"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
