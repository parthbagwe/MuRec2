import { motion, useReducedMotion } from "motion/react";
import StudioIcon from "./StudioIcon";
import { STARTER_TRACKS } from "../discoveryTracks";
import { startDiscoveryTrack } from "../startDiscoveryTrack";

export function focusSongSearch() {
  document.querySelector('input[aria-label="Search songs"]')?.focus();
}

export default function DiscoveryHome({ onSelect }) {
  const reducedMotion = useReducedMotion();
  const featured = STARTER_TRACKS[0];
  return <div className="discovery-home" id="top">
    <header className="discovery-heading"><div><p className="studio-overline">YOUR LISTENING ROOM</p><h1>Discover</h1></div><span className="preview-pill"><StudioIcon name="headphones" />30-second previews</span></header>
    <div className="feature-row">
      <section className="featured-record" aria-labelledby="featured-title">
        <div className="record-copy"><p className="studio-overline"><i />A PLACE TO START</p><h2 id="featured-title">Blinding<br />Lights</h2><p className="record-artist">The Weeknd <span>· After Hours</span></p><p className="record-description">Start with this track. Find five more<br className="desktop-break" /> that share its sound.</p><button className="studio-primary" onClick={() => startDiscoveryTrack(featured, onSelect)}><StudioIcon name="play" />Start a mix</button></div>
        <motion.div className="record-scene" aria-hidden="true" initial={reducedMotion ? false : { opacity: 0, x: 28, rotate: 6 }} animate={{ opacity: 1, x: 0, rotate: 0 }} transition={{ type: "spring", stiffness: 65, damping: 20 }}>
          <div className="vinyl-disc"><div className="vinyl-label"><img src={featured.artwork_url} alt="" /></div></div>
          <div className="record-sleeve"><img src={featured.artwork_url.replace("100x100bb", "400x400bb")} alt="" fetchPriority="high" /><span className="sleeve-edge" /></div>
        </motion.div>
        <span className="record-caption">01 / THE STARTING POINT</span>
      </section>
      <a className="bridge-teaser" href="#mix"><span className="studio-overline">THE MIX STUDIO</span><div className="bridge-art" aria-hidden="true"><div /><i /><div /></div><h2>Two tracks.<br />Find the in-between.</h2><p>Pick a start and finish. Discover the songs that connect them.</p><span className="teaser-action">Make a sound bridge <StudioIcon name="arrow" /></span></a>
    </div>
    <section className="discovery-shelf" aria-labelledby="shelf-title">
      <div className="shelf-heading"><div><h2 id="shelf-title">Different sounds. New directions.</h2><p>Handpicked starting points. Your mix begins with one.</p></div><button onClick={focusSongSearch}>Find a song <StudioIcon name="arrow" /></button></div>
      <div className="starter-shelf">
        {STARTER_TRACKS.map((track) => <motion.button key={track.track_id} className="starter-track" onClick={() => startDiscoveryTrack(track, onSelect)} aria-label={`Start a mix with ${track.title} by ${track.artist}`} whileHover={reducedMotion ? undefined : { y: -5 }} whileTap={reducedMotion ? undefined : { scale: .98 }}>
          <span className="starter-art"><img src={track.artwork_url.replace("100x100bb", "300x300bb")} alt="" loading="lazy" /><span className="starter-play"><StudioIcon name="play" /></span><small>30s preview</small></span><strong>{track.title}</strong><span className="starter-artist">{track.artist}</span>
        </motion.button>)}
      </div>
    </section>
  </div>;
}
