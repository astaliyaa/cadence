import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useScrollElement } from "../lib/scroll";

interface Props<T> {
  items: T[];
  minWidth?: number;
  gap?: number;
  /** Height of the text under the square artwork. */
  footer?: number;
  render: (item: T, width: number) => ReactNode;
  getKey: (item: T) => string;
  onEndReached?: () => void;
}

/** Responsive, virtualised grid of square cards that scrolls with the page. */
export function VirtualGrid<T>({ items, minWidth = 170, gap = 22, footer = 46, render, getKey, onEndReached }: Props<T>) {
  const scrollEl = useScrollElement();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !scrollEl) return;
    const measure = () => {
      setWidth(el.clientWidth);
      setMargin(el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollEl]);

  const cols = Math.max(2, Math.floor((width + gap) / (minWidth + gap)));
  const colWidth = width ? (width - gap * (cols - 1)) / cols : minWidth;
  const rowHeight = colWidth + footer + gap;
  const rows = Math.ceil(items.length / cols);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin: margin,
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  const virtualRows = virtualizer.getVirtualItems();
  const last = virtualRows[virtualRows.length - 1];
  const nearEnd = !!last && last.index >= rows - 3;
  const endRef = useRef(onEndReached);
  endRef.current = onEndReached;
  useLayoutEffect(() => {
    if (nearEnd) endRef.current?.();
  }, [nearEnd, items.length]);

  return (
    <div ref={ref} className="vgrid" style={{ height: rows * rowHeight }}>
      {width > 0 &&
        virtualRows.map((row) => (
          <div
            key={row.key}
            className="vgrid-row"
            style={{
              transform: `translateY(${row.start - margin}px)`,
              gridTemplateColumns: `repeat(${cols}, ${colWidth}px)`,
              columnGap: gap,
            }}
          >
            {items.slice(row.index * cols, row.index * cols + cols).map((item) => (
              <div key={getKey(item)} style={{ width: colWidth }}>
                {render(item, colWidth)}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
