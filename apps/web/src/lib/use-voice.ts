"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

/** The browser's speech engine, if it has one (Chrome, Edge and Safari do; the words are then sent to the browser's speech service). */
const engine = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Speak a question: listens once and exposes the words as text for the question box to show, never sent on its own. */
export function useVoice() {
  const supported = useSyncExternalStore(() => () => {}, () => engine() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    return () => rec.current?.abort(); // never leave the microphone open after the panel goes away
  }, []);

  const toggle = useCallback(() => {
    if (rec.current) return rec.current.stop();
    const Ctor = engine();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => setTranscript(Array.from(e.results, (alt) => alt[0]?.transcript ?? "").join("").trim());
    const done = () => {
      rec.current = null;
      setListening(false);
    };
    r.onend = done;
    r.onerror = done;
    setTranscript("");
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  return { supported, listening, transcript, toggle };
}
