const MOBILE_BREAKPOINT = 640;
const TABLET_BREAKPOINT = 1024;
const MOBILE_PREVIEW_HEIGHT = 960;
const TABLET_PREVIEW_HEIGHT = 1120;
const DESKTOP_PREVIEW_HEIGHT = 1320;

export function getArticlePreviewHeight(viewportWidth: number) {
  if (viewportWidth < MOBILE_BREAKPOINT) {
    return MOBILE_PREVIEW_HEIGHT;
  }

  if (viewportWidth < TABLET_BREAKPOINT) {
    return TABLET_PREVIEW_HEIGHT;
  }

  return DESKTOP_PREVIEW_HEIGHT;
}
