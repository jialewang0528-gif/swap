/* On-device answers for Ask Swap. Bridges to the iPhone app's Apple Intelligence model
   (FoundationModels, iOS 26+) through the "ask" message handler in ios/Swap/SwapApp.swift.
   Nothing leaves the phone. On the web (no native handler) available() is false and the chat
   keeps its scripted answers.
   window.SwapNative.ai is injected by the app at document start: "available" or a reason
   ("appleIntelligenceNotEnabled", "modelNotReady", "deviceNotEligible", "unsupportedOS"). */
(function () {
  const calls = new Map();
  let seq = 0;
  const handler = () => {
    try { return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ask; }
    catch (e) { return null; }
  };
  const settle = (id, ok, value) => {
    const c = calls.get(id);
    if (!c) return;
    calls.delete(id);
    clearTimeout(c.timer);
    ok ? c.resolve(String(value || "")) : c.reject(new Error(String(value || "failed")));
  };

  const SwapAI = {
    status() { return (window.SwapNative && window.SwapNative.ai) || (handler() ? "unknown" : "web"); },
    available() { return !!handler() && SwapAI.status() === "available"; },

    // ask(question, context, { onPartial, rideApp }) -> Promise<string>. context is a string (or
    // any JSON-able value). onPartial(text) gets the growing answer while the model streams.
    // rideApp: true only on the founder's build, where his ride app may be suggested.
    ask(question, context, opts = {}) {
      if (!SwapAI.available()) return Promise.reject(new Error(SwapAI.status()));
      const id = `q${++seq}_${Date.now()}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => settle(id, false, "timeout"), opts.timeout || 25000);
        calls.set(id, { resolve, reject, timer, onPartial: opts.onPartial });
        try {
          handler().postMessage({ id, question: String(question), context: typeof context === "string" ? context : JSON.stringify(context), rideApp: !!opts.rideApp });
        } catch (e) { settle(id, false, e && e.message); }
      });
    },

    // Loads the model ahead of the first question (optional, cheap if repeated).
    prewarm(context, opts = {}) {
      if (!SwapAI.available()) return;
      try { handler().postMessage({ type: "prewarm", context: typeof context === "string" ? context : JSON.stringify(context || ""), rideApp: !!opts.rideApp }); } catch (e) {}
    },

    // Called by the app.
    _partial(id, text) { const c = calls.get(id); if (c && c.onPartial) { try { c.onPartial(String(text || "")); } catch (e) {} } },
    _resolve(id, text) { settle(id, true, text); },
    _reject(id, reason) { settle(id, false, reason); },
    _status(s) { window.SwapNative = Object.assign(window.SwapNative || {}, { ai: s }); }
  };
  window.SwapAI = SwapAI;
})();
