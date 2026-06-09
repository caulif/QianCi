export interface ContentFrameLike {
  self: unknown;
  top: unknown;
}

/**
 * Checks whether the content app should bootstrap in the current frame.
 *
 * @param frame Browser frame-like object exposing self and top references.
 * @returns True when QianCi should start the content app for this frame.
 */
export function shouldBootstrapContentFrame(frame: ContentFrameLike): boolean {
  return frame.self === frame.top;
}
