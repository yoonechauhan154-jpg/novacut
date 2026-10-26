// Playwright test probe — injected before the app loads via page.addInitScript
// Logs all media element events, wraps AudioContext for RMS measurement,
// exposes window.__probe with live counters for Bug A and Bug B acceptance.

(function () {
  const events = [];
  const MAX_EVENTS = 500;

  function logEvent(type, el, detail = {}) {
    events.push({
      t: performance.now(),
      type,
      id: el.id || el.dataset.clipId || 'unknown',
      tag: el.tagName,
      currentTime: el.currentTime !== undefined ? Number(el.currentTime.toFixed(3)) : null,
      paused: el.paused !== undefined ? el.paused : null,
      readyState: el.readyState !== undefined ? el.readyState : null,
      ...detail,
    });
    if (events.length > MAX_EVENTS) events.shift();
  }

  // Patch HTMLMediaElement.prototype to capture events
  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    const el = this;
    if (
      el instanceof HTMLVideoElement ||
      el instanceof HTMLAudioElement
    ) {
      const wrapped = (ev) => {
        logEvent(type, el);
        return listener.call(this, ev);
      };
      el._probeWrapped = el._probeWrapped || {};
      el._probeWrapped[type] = wrapped;
      return origAddEventListener.call(this, type, wrapped, options);
    }
    return origAddEventListener.call(this, type, listener, options);
  };

  // Patch play() and pause() to log
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this;
    const promise = origPlay.call(this);
    if (promise && promise.then) {
      promise.then(
        () => logEvent('play-resolved', el),
        (err) => logEvent('play-rejected', el, { error: err.name + ': ' + err.message })
      );
    } else {
      logEvent('play-called', el);
    }
    return promise;
  };

  const origPause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function () {
    const el = this;
    logEvent('pause-called', el);
    return origPause.call(this);
  };

  // Patch AudioContext to track source nodes
  let activeAudioSources = 0;
  let audioContextSuspended = false;
  const analyserNodes = [];

  const origAudioContext = window.AudioContext || window.webkitAudioContext;
  if (origAudioContext) {
    const wrappedAudioContext = function (...args) {
      const ctx = new origAudioContext(...args);
      const origCreateBufferSource = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = function (...args) {
        const node = origCreateBufferSource(...args);
        const origStart = node.start;
        node.start = function (...args) {
          activeAudioSources++;
          return origStart.call(this, ...args);
        };
        const origStop = node.stop;
        node.stop = function (...args) {
          activeAudioSources = Math.max(0, activeAudioSources - 1);
          return origStop.call(this, ...args);
        };
        const origDisconnect = node.disconnect;
        node.disconnect = function (...args) {
          activeAudioSources = Math.max(0, activeAudioSources - 1);
          return origDisconnect.call(this, ...args);
        };
        return node;
      };
      const origCreateMediaElementSource = ctx.createMediaElementSource.bind(ctx);
      ctx.createMediaElementSource = function (mediaElement) {
        const node = origCreateMediaElementSource(mediaElement);
        const origConnect = node.connect;
        node.connect = function (...args) {
          activeAudioSources++;
          return origConnect.call(this, ...args);
        };
        const origDisconnect2 = node.disconnect;
        node.disconnect = function (...args) {
          activeAudioSources = Math.max(0, activeAudioSources - 1);
          return origDisconnect2.call(this, ...args);
        };
        return node;
      };
      const origSuspend = ctx.suspend.bind(ctx);
      ctx.suspend = function (...args) {
        audioContextSuspended = true;
        return origSuspend(...args);
      };
      const origResume = ctx.resume.bind(ctx);
      ctx.resume = function (...args) {
        audioContextSuspended = false;
        return origResume(...args);
      };
      return ctx;
    };
    wrappedAudioContext.prototype = origAudioContext.prototype;
    window.AudioContext = wrappedAudioContext;
    if (window.webkitAudioContext) {
      window.webkitAudioContext = wrappedAudioContext;
    }
  }

  // Expose probe
  window.__probe = {
    get events() { return events; },
    clearEvents() { events.length = 0; },
    get playingMediaCount() {
      let count = 0;
      document.querySelectorAll('video, audio').forEach((el) => {
        if (!el.paused) count++;
      });
      return count;
    },
    get activeAudioSources() { return activeAudioSources; },
    get audioContextSuspended() { return audioContextSuspended; },
    getMediaState() {
      const els = [];
      document.querySelectorAll('video, audio').forEach((el) => {
        els.push({
          id: el.id || el.dataset.clipId || 'unknown',
          tag: el.tagName,
          currentTime: el.currentTime,
          paused: el.paused,
          readyState: el.readyState,
          muted: el.muted,
          volume: el.volume,
          duration: el.duration,
        });
      });
      return els;
    },
    getActiveClipInfo() {
      // The app exposes debug info via window.__debug if available
      return window.__debug || {};
    },
    analyserNodes,
  };

  // Auto-attach event listeners to existing and future media elements
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement) {
          ['play', 'pause', 'seeking', 'seeked', 'waiting', 'stalled', 'timeupdate', 'ended', 'error'].forEach((ev) => {
            node.addEventListener(ev, () => logEvent(ev, node));
          });
        }
      }
    }
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
})();
