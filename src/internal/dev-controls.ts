export interface HiddenDevControlStyleOptions {
  offsetPx?: number;
}

export function styleHiddenDevControl(
  control: HTMLElement,
  options: HiddenDevControlStyleOptions = {},
): void {
  Object.assign(control.style, {
    position: 'fixed',
    top: '0',
    left: `${options.offsetPx ?? 0}px`,
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'auto',
    zIndex: '2147483647',
  });
}
