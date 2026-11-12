"use client";

import { AnimatePresence, motion, useReducedMotion, type TargetAndTransition } from "framer-motion";
import { cn } from "@/lib/cn";
import type { AonPose } from "@/lib/aon";

/*
 * Aon is Hudhud, a hoopoe (the messenger bird). One pose per thing Aon is doing; each pose has its own calm loop and
 * the poses cross-fade, so the bird feels alive without ever demanding attention. The art and the motion are the same
 * as in ShopSyncer.
 */

const sprite = (pose: AonPose | "mark") => `/aon/${pose}.webp`;

const EASE = "easeInOut" as const;
const LOOPS: Record<AonPose, TargetAndTransition> = {
  idle: { scaleY: [1, 1.018, 1], y: [0, -1.5, 0], transition: { duration: 4, repeat: Infinity, ease: EASE } },
  listening: { rotate: [-1.5, 0.8, -1.5], x: [0, 2, 0], transition: { duration: 2.4, repeat: Infinity, ease: EASE } },
  thinking: { rotate: [-2, 2, -2], transition: { duration: 3.2, repeat: Infinity, ease: EASE } },
  searching: { y: [0, -7, 0], rotate: [0, 1.5, 0], transition: { duration: 1.1, repeat: Infinity, ease: EASE } },
  success: {
    y: [0, -16, 0, -6, 0],
    scaleY: [1, 1.05, 0.96, 1.02, 1],
    transition: { duration: 1.1, ease: "easeOut" },
  },
  sleeping: { scaleY: [1, 1.03, 1], transition: { duration: 5, repeat: Infinity, ease: EASE } },
};

function Sparkle({ className, delay }: { className: string; delay: number }) {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className={cn("absolute h-[9%] w-[9%] fill-amber-400", className)}
      initial={{ scale: 0, opacity: 0, rotate: 0 }}
      animate={{ scale: [0, 1.2, 0.8, 0], opacity: [0, 1, 1, 0], rotate: [0, 25, 45, 60] }}
      transition={{ duration: 1.4, delay, ease: "easeOut" }}
      aria-hidden
    >
      <path d="M12 0 l3 8 8 4 -8 4 -3 8 -3 -8 -8 -4 8 -4Z" />
    </motion.svg>
  );
}

/** Little extras around the bird: a thought-dot trail, listening ticks, sparkles, sleepy z's. */
function Extras({ pose }: { pose: AonPose }) {
  if (pose === "thinking" || pose === "searching") {
    return (
      <div className="absolute right-[2%] top-[4%] flex gap-[5%]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block h-[7px] w-[7px] rounded-full bg-primary/70"
            animate={{ y: [4, -6], opacity: [0, 1, 0], scale: [0.5, 1, 0.8] }}
            transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.3, ease: "easeOut" }}
          />
        ))}
      </div>
    );
  }
  if (pose === "listening") {
    return (
      <div className="absolute right-[8%] top-[18%] flex flex-col gap-[5px]" aria-hidden>
        {[-16, 0, 16].map((rotate, i) => (
          <motion.span
            key={rotate}
            className="block h-[3px] w-[14px] origin-left rounded-full bg-amber-500/80"
            style={{ rotate }}
            animate={{ opacity: [0.15, 1, 0.15], scaleX: [0.6, 1, 0.6] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.18, ease: EASE }}
          />
        ))}
      </div>
    );
  }
  if (pose === "success") {
    return (
      <>
        <Sparkle className="left-[6%] top-[22%]" delay={0.05} />
        <Sparkle className="right-[8%] top-[10%]" delay={0.2} />
        <Sparkle className="right-[2%] top-[46%]" delay={0.35} />
        <Sparkle className="left-[22%] top-[2%]" delay={0.5} />
      </>
    );
  }
  if (pose === "sleeping") {
    return (
      <div className="absolute right-[6%] top-[6%] flex flex-col items-start font-semibold text-primary/60" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="leading-none"
            style={{ fontSize: `${10 + i * 4}px`, marginLeft: `${i * 6}px` }}
            animate={{ y: [6, -10], opacity: [0, 1, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
          >
            z
          </motion.span>
        ))}
      </div>
    );
  }
  return null;
}

/** The full bird. Size it with a width/height class (it keeps a square stage and its feet on the ground line). */
export function AonMascot({ pose, className }: { pose: AonPose; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  return (
    <div className={cn("relative aspect-square select-none", className)} aria-hidden>
      <motion.span
        className="absolute bottom-[2%] left-1/2 h-[7%] w-[54%] -translate-x-1/2 rounded-full bg-fg/10 blur-[6px]"
        animate={reduce ? undefined : { scaleX: pose === "searching" ? [1, 0.8, 1] : [1, 0.94, 1] }}
        transition={{ duration: pose === "searching" ? 1.1 : 4, repeat: Infinity, ease: EASE }}
      />
      <AnimatePresence initial={false}>
        <motion.div
          key={pose}
          className="absolute inset-0"
          initial={reduce ? false : { opacity: 0, scale: 0.93, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16 } }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
        >
          <motion.div className="h-full w-full" style={{ transformOrigin: "50% 100%" }} animate={reduce ? undefined : LOOPS[pose]}>
            {/* eslint-disable-next-line @next/next/no-img-element -- fixed local art, nothing for next/image to optimise */}
            <img src={sprite(pose)} alt="" draggable={false} className="h-full w-full object-contain object-bottom drop-shadow-md" />
          </motion.div>
        </motion.div>
      </AnimatePresence>
      {!reduce && <Extras pose={pose} />}
    </div>
  );
}

/** Hudhud's face and crest, for the small places (top bar, header, answer avatars). It breathes, glows while Aon works and pops when an answer lands. */
export function AonMark({ pose = "idle", className }: { pose?: AonPose; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const working = pose === "thinking" || pose === "searching";
  return (
    <span className={cn("relative inline-grid place-items-center", className)} aria-hidden>
      {working && !reduce && (
        <motion.span
          className="absolute inset-[-3px] rounded-full ring-2 ring-primary/40"
          animate={{ scale: [0.9, 1.15], opacity: [0.8, 0] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <motion.img
        src={sprite("mark")}
        alt=""
        draggable={false}
        className="h-full w-full object-contain"
        style={{ transformOrigin: "50% 100%" }}
        animate={
          reduce
            ? undefined
            : pose === "success"
              ? { scale: [1, 1.25, 0.95, 1], rotate: [0, -6, 4, 0], transition: { duration: 0.7 } }
              : pose === "sleeping"
                ? { scaleY: [1, 1.03, 1], opacity: 0.8, transition: { duration: 5, repeat: Infinity, ease: EASE } }
                : { scaleY: [1, 1.04, 1], transition: { duration: working ? 1.2 : 4, repeat: Infinity, ease: EASE } }
        }
      />
    </span>
  );
}
