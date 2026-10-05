import { createContext, useContext } from "react";

/** The main content scroller; virtualised lists measure against it. */
export const ScrollContext = createContext<HTMLElement | null>(null);

export function useScrollElement() {
  return useContext(ScrollContext);
}
