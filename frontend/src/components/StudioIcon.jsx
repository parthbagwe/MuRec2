const paths = {
  discover: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM16 8l-2.5 5.5L8 16l2.5-5.5L16 8Z",
  mix: "M4 7h3c5 0 5 10 10 10h3m-3-3 3 3-3 3M4 17h3c2 0 3-2 4-4m2-2c1-2 2-4 4-4h3m-3-3 3 3-3 3",
  chart: "M5 20V10m7 10V4m7 16v-7",
  library: "M4 4v16m5-16v16m5-16 5 16",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  play: "m9 5 11 7-11 7V5Z",
  heart: "M20 5a5 5 0 0 0-7 0l-1 1-1-1a5 5 0 0 0-7 7l8 8 8-8a5 5 0 0 0 0-7Z",
  history: "M12 8v5l3 2M4.9 5.1A9 9 0 1 1 3 12m0-5v5h5",
  headphones: "M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4Zm16 0h1v7h-4v-7h3Z",
};

export default function StudioIcon({ name, className = "" }) {
  return <svg className={`studio-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.discover} /></svg>;
}
