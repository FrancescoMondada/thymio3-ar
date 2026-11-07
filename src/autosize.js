// The size the picture is analysed at, chosen from what is measured: the phone gets closer, farther, or zooms, and the LEDs are 6 px
// or 60 px apart. The gap between two LEDs of a group (16 mm) is the measure: under 11 px at the size in use, the LEDs are too small
// for the detector (a bigger analysis gives them more pixels: 480 -> 640 -> 960 on a video 720 x 1280); when the gap would still be at
// least `comfort` px at the next smaller size, that one is enough and the page runs faster (the search costs about 4 times more at 960
// than at 480: in the user's 7th test it stayed at 960 for two minutes at 12 px/s analysed because only a gap over 42 px brought it
// down). `comfort` is above `small` with room for the ratio between two sizes, so the rule cannot go back and forth. With no scale at all (nothing found)
// but something responding in the picture (the phone is aimed at the robot), a bigger size is tried: from far away the LEDs may be
// too small to be found, so no scale can be measured either.
export const SIZES = [480, 640, 960];

// -> the size to use now (the same one when nothing is to be changed)
export function nextSize({ size, gapPx = NaN, samples = 0, foundShare = 0, unseenShare = 0, sizes = SIZES, small = 11, comfort = 15, minSamples = 20 } = {}) {
  const i = sizes.indexOf(size);
  if (i < 0) return size;
  if (samples >= minSamples && Number.isFinite(gapPx)) {
    if (gapPx < small && i < sizes.length - 1) return sizes[i + 1];
    if (i > 0 && (gapPx * sizes[i - 1]) / size >= comfort) return sizes[i - 1];
    return size;
  }
  if (samples < minSamples && unseenShare < 0.3 && foundShare < 0.05 && i < sizes.length - 1) return sizes[i + 1];
  return size;
}
