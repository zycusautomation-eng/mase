"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Voice dictation via the browser Web Speech API (SpeechRecognition). Client-only,
// zero backend, zero cost — works in Chromium browsers (Chrome/Edge). Unsupported
// browsers (e.g. Firefox) report supported:false so the caller can hide the mic.
//
// Contract: the hook NEVER sends anything. It transcribes speech and hands each
// FINALISED chunk to onFinal() so the caller can append it to its own input; the
// user still reviews the text and presses Enter to send. Live (not-yet-final) words
// are exposed as `interim` for an on-screen "listening…" preview.
import { useCallback, useEffect, useRef, useState } from "react";

function getSR(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function useDictation({ lang = "en-US", onFinal }: { lang?: string; onFinal: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef<any>(null);
  // Keep the latest onFinal without re-creating the recognizer each render.
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  // True only when the USER stopped (or the component unmounted) — distinguishes a
  // deliberate stop from Chrome's auto-end after silence (which we auto-restart, so
  // `continuous` dictation survives natural pauses).
  const manualStopRef = useRef(false);

  useEffect(() => { setSupported(!!getSR()); }, []);

  const stop = useCallback(() => {
    manualStopRef.current = true;
    setListening(false);
    setInterim("");
    try { recRef.current?.stop(); } catch { /* already stopped */ }
  }, []);

  const start = useCallback(() => {
    const SR = getSR();
    if (!SR) return;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    manualStopRef.current = false;

    rec.onresult = (e: any) => {
      let fin = "", intr = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript;
        else intr += res[0].transcript;
      }
      if (fin.trim()) onFinalRef.current(fin.trim());
      setInterim(intr);
    };
    rec.onerror = (ev: any) => {
      // Permission / service denials must NOT auto-restart (would loop forever).
      if (ev?.error === "not-allowed" || ev?.error === "service-not-allowed" || ev?.error === "audio-capture") {
        manualStopRef.current = true;
        setListening(false);
        setInterim("");
      }
      // 'no-speech' / 'aborted' fall through to onend, which restarts if still active.
    };
    rec.onend = () => {
      setInterim("");
      if (!manualStopRef.current) {
        // Chrome ends the session after a silence gap even with continuous=true —
        // restart so the mic keeps listening until the user taps stop.
        try { rec.start(); return; } catch { /* fall through to stopped */ }
      }
      setListening(false);
    };

    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { /* start can throw if already running */ }
  }, [lang]);

  const toggle = useCallback(() => { if (listening) stop(); else start(); }, [listening, start, stop]);

  // Stop + release the mic on unmount.
  useEffect(() => () => { manualStopRef.current = true; try { recRef.current?.stop(); } catch { /* ignore */ } }, []);

  return { supported, listening, interim, start, stop, toggle };
}
