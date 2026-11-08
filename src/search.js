// The threshold of the search for the first map follows what the lights give. Half the median of the strongest fresh responses of the last pictures, between a floor and
// the one asked (80 for the arcs, 50 for the LEDs). The 16th test lost the map for tens of seconds because the arcs, with a lower exposure, answered under 80: the square
// search finds nothing then, whatever the tilt (in simulation it finds the square 100 % at any tilt with arcs at 100, 0 % with arcs at 70). `quiet`: nothing blinks in the
// picture (the median of the peaks is under 28), so nothing is looked for: the search would only find noise.
export const QUIET_PEAK = 28;
export function searchThreshold(hist, peak, asked, floor, keep = 9) {
  hist.push(peak);
  if (hist.length > keep) hist.shift();
  const med = hist.slice().sort((a, b) => a - b)[hist.length >> 1];
  return { thr: Math.round(Math.min(asked, Math.max(floor, 0.5 * med))), quiet: med < QUIET_PEAK, median: med };
}
