import type { ReactNode } from 'react';

const paths = {
  settings: <><path d="m9 3-.6 2.2-2 .9-2-.6-1.8 3.1 1.5 1.6-.2 2.2-1.5 1.6 1.8 3.1 2-.6 2 .9.6 2.2h3.6l.6-2.2 2-.9 2 .6 1.8-3.1-1.5-1.6.2-2.2 1.5-1.6-1.8-3.1-2 .6-2-.9L12.6 3Z"/><circle cx="10.8" cy="11.5" r="2.8"/></>,
  history: <><path d="M3 10a9 9 0 1 1 2.5 8M3 4v6h6"/><path d="M12 7v5l3 2"/></>,
  capture: <><path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m13-5v4a1 1 0 0 1-1 1h-4"/><path d="M8 12h8m-4-4v8"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  minimize: <path d="M5 12h14"/>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  edit: <><path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/><path d="M13 20h7"/></>,
  pin: <><path d="m9 3 6 0-1 6 4 4v2H6v-2l4-4Z"/><path d="M12 15v6"/></>,
  resize: <><path d="M14 3h7v7m0-7-7 7M10 21H3v-7m0 7 7-7"/></>,
  swap: <><path d="M8 3v17m-4-4 4 4 4-4M16 21V4m-4 4 4-4 4 4"/></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  external: <><path d="M14 3h7v7m0-7L10 14"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
  refresh: <><path d="M20 7a9 9 0 1 0 1 7M20 2v5h-5"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  language: <><path d="M3 5h12M9 3v2m4 0c-1 6-4 9-9 12m1-9c1 4 4 7 8 9m0 4 4-11 4 11m-6.5-4h5"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/></>,
  warning: <><path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></>
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

/** Small local SVG set: one stroke weight, no icon font or runtime dependency. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }): React.JSX.Element {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
