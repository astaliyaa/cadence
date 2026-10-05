import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  title: ReactNode;
  seeAll?: string;
  children: ReactNode;
  className?: string;
}

/** A horizontally scrolling row of cards with Apple-style paging arrows. */
export function Shelf({ title, seeAll, children, className = "" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" });
  };

  return (
    <section className={`shelf ${className}`}>
      <div className="shelf-head">
        {seeAll ? (
          <Link to={seeAll} className="shelf-title linkish">
            {title}
            <ChevronRight size={20} strokeWidth={2.4} />
          </Link>
        ) : (
          <h2 className="shelf-title">{title}</h2>
        )}
      </div>
      <div className="shelf-body">
        {!edges.start && (
          <button className="shelf-arrow left" onClick={() => page(-1)} aria-label="Scroll left">
            <ChevronLeft size={22} />
          </button>
        )}
        <div ref={ref} className="shelf-scroll" onScroll={update}>
          {children}
        </div>
        {!edges.end && (
          <button className="shelf-arrow right" onClick={() => page(1)} aria-label="Scroll right">
            <ChevronRight size={22} />
          </button>
        )}
      </div>
    </section>
  );
}
