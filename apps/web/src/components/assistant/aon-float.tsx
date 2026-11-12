"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { AonPose } from "@/lib/aon";
import { AonMascot } from "./aon-mascot";

const POS_KEY = "schoolsyncer.aon.float";
const GREETED_KEY = "schoolsyncer.aon.greeted";
const SLEEP_AFTER_MS = 45_000;

function readPos(): { x: number; y: number } {
  try {
    const raw = JSON.parse(window.localStorage.getItem(POS_KEY) ?? "null") as { x?: unknown; y?: unknown } | null;
    if (raw && typeof raw.x === "number" && typeof raw.y === "number") return { x: raw.x, y: raw.y };
  } catch {
    // No storage (private window): he just starts in his corner every time.
  }
  return { x: 0, y: 0 };
}

/**
 * Hudhud on every screen while Aon is on: a small animated bird in the corner. Tap him to open Aon; drag him anywhere
 * if he is in the way (the spot is remembered on this device). He dozes after a quiet spell and hops awake when
 * touched. Hidden while the chat is open, since the chat shows him itself.
 */
export function AonFloat({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion() ?? false;
  const [asleep, setAsleep] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [greeting, setGreeting] = useState(false);
  const [hopping, setHopping] = useState(false);
  const [pos, setPos] = useState(readPos); // only rendered after the status loads in the browser, so there is no server render to mismatch
  const dragged = useRef(false);
  const bounds = useRef<HTMLDivElement>(null);

  // Any activity on the page wakes him; 45 s without any and he dozes off.
  useEffect(() => {
    let timer = window.setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    const wake = () => {
      setAsleep(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, []);

  // A short hello the first time he shows up in a browser session.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(GREETED_KEY)) return;
      window.sessionStorage.setItem(GREETED_KEY, "1");
    } catch {
      return;
    }
    const show = window.setTimeout(() => setGreeting(true), 2500);
    const hide = window.setTimeout(() => setGreeting(false), 8000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  if (open) return null;

  const pose: AonPose = hopping ? "success" : asleep ? "sleeping" : hovered ? "listening" : "idle";
  const bubble = greeting || hovered;

  return (
    <div ref={bounds} className="pointer-events-none fixed inset-0 z-30 print:hidden">
      <motion.button
        type="button"
        drag
        dragConstraints={bounds}
        dragElastic={0.12}
        dragMomentum={false}
        initial={false}
        animate={pos}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(_, info) => {
          const next = { x: pos.x + info.offset.x, y: pos.y + info.offset.y };
          setPos(next);
          try {
            window.localStorage.setItem(POS_KEY, JSON.stringify(next));
          } catch {
            // The spot just is not remembered.
          }
          window.setTimeout(() => {
            dragged.current = false;
          }, 0);
        }}
        onClick={() => {
          if (dragged.current) return;
          setHopping(true);
          window.setTimeout(() => setHopping(false), 900);
          onToggle();
        }}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        whileTap={reduce ? undefined : { scale: 0.94 }}
        aria-label="Ask Aon (Ctrl+/)"
        aria-keyshortcuts="Control+/ Meta+/"
        title="Aon (Ctrl+/). Drag to move."
        data-testid="aon-float"
        className="pointer-events-auto absolute bottom-20 end-3 touch-none cursor-grab rounded-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring active:cursor-grabbing md:end-5 lg:bottom-4"
      >
        <AnimatePresence>
          {bubble && (
            <motion.span
              key="bubble"
              initial={{ opacity: 0, y: 6, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 320, damping: 24 }}
              className="pointer-events-none absolute bottom-full end-2 mb-1 whitespace-nowrap rounded-2xl rounded-be-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg shadow-overlay"
            >
              {greeting && !hovered ? "Hi, I’m Aon. Ask me anything." : "Ask Aon"}
            </motion.span>
          )}
        </AnimatePresence>
        <AonMascot pose={pose} className="size-[84px] max-md:size-[72px]" />
      </motion.button>
    </div>
  );
}
