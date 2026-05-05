// ── Deep sky object catalog ──────────────────────────────────────────
const DEEP_SKY = [
  // ── Emission nebulae ───────────────────────────────────────────────
  { name: 'M8',        common: 'Lagoon Nebula',        ra: 18.063, dec: -24.38, type: 'Emission nebula',    mag: 6.0, r: 22, color: '178, 68, 88',   dist: '4,100 ly',   note: 'One of the largest star-forming regions visible from Earth',                                                              pa: 80,  aspect: 0.44 },
  { name: 'M20',       common: 'Trifid Nebula',        ra: 18.043, dec: -23.03, type: 'Emission nebula',    mag: 6.3, r: 16, color: '170, 65, 95',   dist: '5,200 ly',   note: 'Three-lobed structure divided by dark dust lanes — emission, reflection, and dark nebula in one' },
  { name: 'M17',       common: 'Omega Nebula',         ra: 18.346, dec: -16.18, type: 'Emission nebula',    mag: 6.0, r: 14, color: '175, 65, 85',   dist: '5,500 ly',   note: 'Also called the Swan, Checkmark, or Horseshoe Nebula',                                                                    pa: 30,  aspect: 0.75 },
  { name: 'M16',       common: 'Eagle Nebula',         ra: 18.313, dec: -13.79, type: 'Emission nebula',    mag: 6.0, r: 12, color: '175, 70, 88',   dist: '7,000 ly',   note: 'Home to the Pillars of Creation — photographed by Hubble in 1995',                                                        pa: 10,  aspect: 0.80 },
  { name: 'NGC 6888',  common: 'Crescent Nebula',      ra: 20.212, dec:  38.35, type: 'Emission nebula',    mag: 7.4, r: 10, color: '172, 62, 82',   dist: '5,000 ly',   note: 'Shaped by the fierce stellar wind of the Wolf-Rayet star WR 136',                                                         pa: 75,  aspect: 0.60 },
  { name: 'NGC 7000',  common: 'North America Nebula', ra: 20.983, dec:  44.50, type: 'Emission nebula',    mag: 4.0, r: 32, color: '168, 58, 78',   dist: '1,600 ly',   note: 'Outline resembles North America — best seen in binoculars or wide-field imaging',                                          pa: 0,   aspect: 0.83 },
  // ── Planetary nebulae ──────────────────────────────────────────────
  { name: 'M57',       common: 'Ring Nebula',          ra: 18.893, dec:  33.03, type: 'Planetary nebula',  mag: 8.8, r: 5,  color: '100, 170, 170', dist: '2,300 ly',   note: 'Formed by a dying sun-like star shedding its outer layers',                                                               pa: 60,  aspect: 0.71 },
  { name: 'M27',       common: 'Dumbbell Nebula',      ra: 19.993, dec:  22.72, type: 'Planetary nebula',  mag: 7.5, r: 7,  color: '110, 165, 165', dist: '1,360 ly',   note: 'First planetary nebula discovered — Charles Messier, 1764',                                                               pa: 145, aspect: 0.71 },
  { name: 'NGC 7293',  common: 'Helix Nebula',         ra: 22.494, dec: -20.84, type: 'Planetary nebula',  mag: 7.3, r: 14, color: '95, 175, 172',  dist: '655 ly',     note: 'Closest planetary nebula to Earth · Largest apparent-size planetary nebula in the sky',                                   pa: 0,   aspect: 0.75 },
  // ── Supernova remnants ─────────────────────────────────────────────
  { name: 'NGC 6992',  common: 'Eastern Veil Nebula',  ra: 20.934, dec:  31.73, type: 'Supernova remnant', mag: 7.0, r: 22, color: '162, 88, 185',  dist: '2,100 ly',   note: 'Part of the Cygnus Loop — shock wave from a supernova ~10,000 years ago',                                                 pa: 5,   aspect: 0.13 },
  { name: 'NGC 6960',  common: 'Western Veil Nebula',  ra: 20.756, dec:  30.72, type: 'Supernova remnant', mag: 7.0, r: 18, color: '162, 88, 185',  dist: '2,100 ly',   note: 'Passes through the star 52 Cygni — also known as the Witch\'s Broom Nebula',                                               pa: 20,  aspect: 0.11 },
  // ── Globular clusters ──────────────────────────────────────────────
  { name: 'M13',       common: 'Great Hercules Cluster', ra: 16.695, dec: 36.46, type: 'Globular cluster', mag: 5.8, r: 16, color: '200, 182, 135', dist: '22,200 ly',  note: 'Northern sky showpiece — ~300,000 stars · Target of the 1974 Arecibo Message' },
  { name: 'M5',        common: null,                   ra: 15.310, dec:   2.08, type: 'Globular cluster',  mag: 5.6, r: 14, color: '198, 178, 132', dist: '24,500 ly',  note: 'One of the finest globulars in the sky — older than the solar system at ~13 billion years' },
  { name: 'M4',        common: null,                   ra: 16.393, dec: -26.53, type: 'Globular cluster',  mag: 5.4, r: 14, color: '196, 176, 130', dist: '7,200 ly',   note: 'One of the nearest globular clusters · First to have individual stars resolved' },
  { name: 'M22',       common: null,                   ra: 18.607, dec: -23.90, type: 'Globular cluster',  mag: 5.1, r: 14, color: '200, 180, 130', dist: '10,400 ly',  note: 'One of the nearest globulars · Contains two planetary nebulae within its core' },
  { name: 'M92',       common: null,                   ra: 17.285, dec:  43.14, type: 'Globular cluster',  mag: 6.4, r: 10, color: '197, 177, 131', dist: '26,700 ly',  note: 'Overshadowed only by its neighbor M13 — would be a celebrated showpiece anywhere else' },
  { name: 'M10',       common: null,                   ra: 16.952, dec:  -4.10, type: 'Globular cluster',  mag: 6.4, r: 10, color: '196, 176, 130', dist: '14,300 ly',  note: 'Bright globular in Ophiuchus · Apparent size varies dramatically with conditions' },
  { name: 'M12',       common: null,                   ra: 16.787, dec:  -1.95, type: 'Globular cluster',  mag: 6.7, r: 9,  color: '195, 175, 128', dist: '16,000 ly',  note: 'Unusually depleted of low-mass stars, possibly stripped by the Milky Way\'s gravity' },
  { name: 'M62',       common: null,                   ra: 17.020, dec: -30.11, type: 'Globular cluster',  mag: 6.6, r: 7,  color: '196, 176, 130', dist: '22,500 ly',  note: 'Asymmetric shape — one of the closest globulars to the galactic center' },
  { name: 'M19',       common: null,                   ra: 17.043, dec: -26.27, type: 'Globular cluster',  mag: 6.8, r: 7,  color: '194, 174, 127', dist: '28,700 ly',  note: 'One of the most oblate (flattened) globular clusters known' },
  { name: 'M28',       common: null,                   ra: 18.410, dec: -24.87, type: 'Globular cluster',  mag: 6.8, r: 6,  color: '194, 174, 127', dist: '18,300 ly',  note: 'First globular cluster in which a millisecond pulsar was discovered' },
  { name: 'M9',        common: null,                   ra: 17.320, dec: -18.52, type: 'Globular cluster',  mag: 7.7, r: 6,  color: '193, 173, 126', dist: '25,800 ly',  note: 'Partially obscured by interstellar dust near the galactic center' },
  { name: 'M14',       common: null,                   ra: 17.627, dec:  -3.25, type: 'Globular cluster',  mag: 7.6, r: 7,  color: '194, 174, 127', dist: '30,300 ly',  note: 'A nova appeared within this globular in 1938 and was only discovered on archival plates in 1964' },
  { name: 'M80',       common: null,                   ra: 16.285, dec: -22.98, type: 'Globular cluster',  mag: 7.2, r: 6,  color: '196, 176, 130', dist: '32,600 ly',  note: 'One of the densest globulars — site of an 1860 nova that briefly outshone everything else in the cluster' },
  { name: 'M69',       common: null,                   ra: 18.523, dec: -32.35, type: 'Globular cluster',  mag: 7.6, r: 6,  color: '195, 175, 128', dist: '29,700 ly',  note: 'One of the metal-richest globulars — contains relatively few RR Lyrae variable stars' },
  { name: 'M70',       common: null,                   ra: 18.721, dec: -32.30, type: 'Globular cluster',  mag: 7.8, r: 6,  color: '194, 174, 127', dist: '29,300 ly',  note: 'Sibling cluster to M69 · Hale-Bopp was discovered nearby in 1995' },
  { name: 'M54',       common: null,                   ra: 18.918, dec: -30.48, type: 'Globular cluster',  mag: 7.7, r: 6,  color: '193, 173, 126', dist: '87,400 ly',  note: 'Does not belong to the Milky Way — it is the core of the Sagittarius Dwarf Galaxy' },
  { name: 'M107',      common: null,                   ra: 16.543, dec: -13.05, type: 'Globular cluster',  mag: 7.9, r: 6,  color: '193, 173, 126', dist: '20,900 ly',  note: 'One of the southernmost Messier globulars, in Ophiuchus' },
  { name: 'M15',       common: null,                   ra: 21.500, dec:  12.17, type: 'Globular cluster',  mag: 6.2, r: 10, color: '198, 180, 135', dist: '33,600 ly',  note: 'One of the most densely packed globulars · Contains a planetary nebula, Pease 1' },
  { name: 'M2',        common: null,                   ra: 21.558, dec:  -0.82, type: 'Globular cluster',  mag: 6.5, r: 9,  color: '196, 176, 130', dist: '37,500 ly',  note: 'One of the oldest globulars — ~13 billion years old' },
  { name: 'M56',       common: null,                   ra: 19.273, dec:  30.19, type: 'Globular cluster',  mag: 8.3, r: 6,  color: '192, 172, 126', dist: '32,900 ly',  note: 'In Lyra, between Sulafat and Albireo' },
  { name: 'M71',       common: null,                   ra: 19.896, dec:  18.78, type: 'Globular cluster',  mag: 8.2, r: 6,  color: '195, 175, 128', dist: '13,000 ly',  note: 'Unusually loose for a globular — long debated whether it was an open or globular cluster' },
  { name: 'M55',       common: null,                   ra: 19.667, dec: -30.96, type: 'Globular cluster',  mag: 7.4, r: 10, color: '195, 178, 132', dist: '17,600 ly',  note: 'Large, loosely concentrated globular in Sagittarius' },
  { name: 'M75',       common: null,                   ra: 20.101, dec: -21.92, type: 'Globular cluster',  mag: 8.6, r: 5,  color: '193, 173, 126', dist: '67,500 ly',  note: 'One of the most concentrated and remote Messier globulars' },
  { name: 'M72',       common: null,                   ra: 20.891, dec: -12.54, type: 'Globular cluster',  mag: 9.3, r: 5,  color: '192, 172, 125', dist: '55,400 ly',  note: 'One of the more remote Messier objects — surrounded by a loose star cloud, M73' },
  // ── Open clusters ──────────────────────────────────────────────────
  { name: 'M7',        common: "Ptolemy's Cluster",    ra: 17.899, dec: -34.82, type: 'Open cluster',      mag: 3.3, r: 22, color: '145, 163, 202', dist: '980 ly',     note: 'Recorded by Ptolemy in 130 AD · One of the most prominent naked-eye clusters' },
  { name: 'M6',        common: 'Butterfly Cluster',    ra: 17.668, dec: -32.21, type: 'Open cluster',      mag: 4.2, r: 14, color: '140, 160, 200', dist: '1,600 ly',   note: 'Named for its butterfly shape · ~80 stars dominated by the orange giant BM Scorpii' },
  { name: 'M24',       common: 'Sagittarius Star Cloud', ra: 18.283, dec: -18.55, type: 'Star cloud',      mag: 4.5, r: 42, color: '212, 198, 158', dist: '~10,000 ly', note: 'Largest Messier object by apparent size — a 2° window directly into the Milky Way core' },
  { name: 'M25',       common: null,                   ra: 18.527, dec: -19.25, type: 'Open cluster',      mag: 4.6, r: 14, color: '142, 162, 200', dist: '2,000 ly',   note: 'Contains U Sagittarii, a bright Cepheid variable pulsing every 6.7 days' },
  { name: 'M23',       common: null,                   ra: 17.947, dec: -19.02, type: 'Open cluster',      mag: 6.9, r: 10, color: '140, 160, 198', dist: '2,150 ly',   note: 'Rich cluster of ~150 stars spanning nearly a full degree' },
  { name: 'M21',       common: null,                   ra: 18.077, dec: -22.50, type: 'Open cluster',      mag: 6.5, r: 8,  color: '138, 158, 196', dist: '4,250 ly',   note: 'Young open cluster physically near the Trifid Nebula' },
  { name: 'M18',       common: null,                   ra: 18.333, dec: -17.08, type: 'Open cluster',      mag: 7.5, r: 8,  color: '138, 158, 196', dist: '4,900 ly',   note: 'Young sparse cluster embedded in Milky Way star fields' },
  { name: 'M26',       common: null,                   ra: 18.755, dec:  -9.38, type: 'Open cluster',      mag: 8.0, r: 7,  color: '138, 158, 196', dist: '5,000 ly',   note: 'Compact open cluster in Scutum — overshadowed by its neighbor M11' },
  { name: 'M11',       common: 'Wild Duck Cluster',    ra: 18.851, dec:  -6.27, type: 'Open cluster',      mag: 6.3, r: 12, color: '140, 160, 200', dist: '6,200 ly',   note: 'One of the richest open clusters known — ~2,900 stars' },
  { name: 'M29',       common: null,                   ra: 20.398, dec:  38.53, type: 'Open cluster',      mag: 7.1, r: 8,  color: '140, 158, 195', dist: '4,000 ly',   note: 'Compact cluster near Sadr in Cygnus · Heavily reddened by dust' },
  { name: 'M39',       common: null,                   ra: 21.535, dec:  48.44, type: 'Open cluster',      mag: 4.6, r: 16, color: '145, 162, 200', dist: '825 ly',     note: 'Naked-eye cluster of ~30 bright stars — one of the closest Messier objects' },
  { name: 'NGC 869',   common: 'Double Cluster (h Per)', ra: 2.319, dec:  57.13, type: 'Open cluster',     mag: 4.3, r: 14, color: '140, 158, 198', dist: '7,500 ly',   note: 'Eastern component of Perseus\'s Double Cluster · ~350 blue-white supergiant stars' },
  { name: 'NGC 884',   common: 'Double Cluster (χ Per)', ra: 2.370, dec:  57.13, type: 'Open cluster',     mag: 4.4, r: 14, color: '140, 158, 198', dist: '7,600 ly',   note: 'Western component of the Double Cluster · Contains several striking red supergiants' },
  { name: 'M34',       common: null,                   ra:  2.702, dec:  42.78, type: 'Open cluster',      mag: 5.5, r: 12, color: '142, 161, 198', dist: '1,400 ly',   note: 'Coarse open cluster in Perseus — pairs nicely with the Double Cluster in the same field' },
  { name: 'M45',       common: 'Pleiades',             ra:  3.791, dec:  24.12, type: 'Open cluster',      mag: 1.6, r: 28, color: '148, 168, 208', dist: '444 ly',     note: 'The Seven Sisters · Embedded in reflection nebulosity · ~3,000 stars in the cluster · Known to every human culture in history' },
  // ── Galaxies ───────────────────────────────────────────────────────
  { name: 'M31',       common: 'Andromeda Galaxy',     ra:  0.712, dec:  41.27, type: 'Spiral galaxy',     mag: 3.44, r: 52, color: '218, 182, 115', dist: '2.537 Mly',  note: 'Nearest major galaxy · ~1 trillion stars · On a collision course with the Milky Way in ~4.5 billion years', pa: 22,  aspect: 0.32 },
  { name: 'M32',       common: null,                   ra:  0.712, dec:  40.87, type: 'Elliptical galaxy',  mag: 8.7, r: 7,  color: '212, 176, 110', dist: '2.49 Mly',   note: 'Compact elliptical companion to M31 · Likely a once-larger spiral galaxy stripped by tidal forces',         pa: 170, aspect: 0.75 },
  { name: 'M110',      common: null,                   ra:  0.672, dec:  41.69, type: 'Elliptical galaxy',  mag: 8.1, r: 9,  color: '210, 174, 108', dist: '2.69 Mly',   note: 'Dwarf elliptical companion to M31 · Last object added to the Messier catalog',                                pa: 170, aspect: 0.52 },
  { name: 'M33',       common: 'Triangulum Galaxy',    ra:  1.564, dec:  30.66, type: 'Spiral galaxy',     mag: 5.72, r: 28, color: '215, 178, 112', dist: '2.73 Mly',   note: 'Third-largest Local Group member · Lowest surface brightness of any naked-eye object',                        pa: 23,  aspect: 0.60 },
  { name: 'M74',       common: 'Phantom Galaxy',       ra:  1.611, dec:  15.78, type: 'Spiral galaxy',     mag: 9.4, r: 10, color: '212, 175, 108', dist: '32 Mly',     note: 'Nearly perfect face-on grand design spiral · One of the most difficult Messier objects to observe',            pa: 0,   aspect: 0.95 },
  { name: 'NGC 7331',  common: null,                   ra: 22.617, dec:  34.42, type: 'Spiral galaxy',     mag: 9.5, r: 10, color: '213, 177, 111', dist: '49 Mly',     note: 'Often called the Milky Way\'s twin · Surrounded by the Deer Lick Group of background galaxies',              pa: 171, aspect: 0.35 },
];

// ── Star color utilities ────────────────────────────────────────────
let STAR_COLORS = {};

function bvToColor(bv) {
  if (bv == null) return null;
  bv = Math.max(-0.4, Math.min(2.0, bv));
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  if (t >= 30000) return '180, 200, 255'; if (t >= 20000) return '185, 205, 250';
  if (t >= 15000) return '190, 205, 245'; if (t >= 10000) return '195, 208, 240';
  if (t >= 8000)  return '210, 215, 235'; if (t >= 6500)  return '225, 225, 225';
  if (t >= 5500)  return '235, 225, 205'; if (t >= 4500)  return '240, 215, 185';
  if (t >= 3500)  return '235, 200, 160'; return '230, 185, 145';
}
function getStarColor(name, mag, bv) {
  if (name && STAR_COLORS[name]) return STAR_COLORS[name];
  const c = bvToColor(bv); if (c) return c;
  if (mag < 2) return '205, 210, 225'; if (mag < 4) return '210, 210, 215';
  return '212, 210, 208';
}

function magToRadius(mag) {
  if (mag < 0.5) return 2.8; if (mag < 1.5) return 2.2; if (mag < 2.5) return 1.7;
  if (mag < 3.5) return 1.4; if (mag < 4.5) return 1.0; if (mag < 5.5) return 0.7;
  if (mag < 6.5) return 0.55; if (mag < 7.5) return 0.42; if (mag < 8.5) return 0.32; return 0.22;
}
function magToBaseOpacity(mag) {
  if (mag < 0.5) return 0.50; if (mag < 1.5) return 0.40; if (mag < 2.5) return 0.32;
  if (mag < 3.5) return 0.28; if (mag < 4.5) return 0.24; if (mag < 5.5) return 0.16;
  if (mag < 6.5) return 0.11; if (mag < 7.5) return 0.09; if (mag < 8.5) return 0.07; return 0.055;
}

function bprpToRgb(bprp) {
  // BP-RP color index → RGB string.  Keypoints span O/B blue to M red.
  const keys = [
    [-0.5, 155, 185, 255],
    [ 0.0, 210, 225, 255],
    [ 0.3, 240, 240, 255],
    [ 0.82,255, 244, 210],
    [ 1.5, 255, 210, 155],
    [ 2.5, 255, 155, 100],
    [ 3.5, 230,  90,  70],
  ];
  const t = Math.max(keys[0][0], Math.min(keys[keys.length-1][0], bprp ?? 0.3));
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i-1], b = keys[i], f = (t - a[0]) / (b[0] - a[0]);
      return `${Math.round(a[1]+(b[1]-a[1])*f)},${Math.round(a[2]+(b[2]-a[2])*f)},${Math.round(a[3]+(b[3]-a[3])*f)}`;
    }
  }
}
