export function durationToString(duration: number): string {
  duration = Math.floor(duration / 1000);
  let s = (duration % 60) + 's';
  duration = Math.floor(duration / 60);
  if (duration === 0) return s;
  s = (duration % 60) + 'm ' + s;
  duration = Math.floor(duration / 60);
  if (duration === 0) return s;
  return duration + 'h ' + s;
}