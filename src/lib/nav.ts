// Lets non-component code (context menus, keyboard shortcuts) navigate.
type NavigateFn = (to: string) => void;

let navigateFn: NavigateFn = (to) => {
  window.location.hash = to;
};

export function setNavigate(fn: NavigateFn) {
  navigateFn = fn;
}

export function go(to: string) {
  navigateFn(to);
}
