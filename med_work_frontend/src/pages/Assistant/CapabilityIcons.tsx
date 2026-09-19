import type { SVGProps } from 'react';

function CapabilityIcon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function MedicalQuestionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CapabilityIcon {...props}>
      <path d="M11 2v2M5 2v2m0-1H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" />
      <path d="M8 15a6 6 0 0 0 12 0v-3" />
      <circle cx="20" cy="10" r="2" />
    </CapabilityIcon>
  );
}

export function RecordAnalysisIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CapabilityIcon {...props}>
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <circle cx="11.5" cy="14.5" r="2.5" />
      <path d="M13.3 16.3 15 18" />
    </CapabilityIcon>
  );
}

export function KnowledgeSearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CapabilityIcon {...props}>
      <path d="M11 22H5.5a1 1 0 0 1 0-5h4.501M21 22l-1.879-1.878" />
      <path d="M3 19.5v-15A2.5 2.5 0 0 1 5.5 2H18a1 1 0 0 1 1 1v8" />
      <circle cx="17" cy="18" r="3" />
    </CapabilityIcon>
  );
}

export function DataAnalysisIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <CapabilityIcon {...props}>
      <path d="M12 16v5m4-6.361V21m4-10.344V21m2-18-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15m2 3.463V21m4-6.344V21" />
    </CapabilityIcon>
  );
}
