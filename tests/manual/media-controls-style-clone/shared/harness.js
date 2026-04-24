(() => {
  "use strict";

  function $(root, sel) {
    const el = root.querySelector(sel);
    if (!el) {
      throw new Error(`Missing element: ${sel}`);
    }
    return el;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function formatTimeSeconds(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const hh = h ? `${String(h).padStart(2, "0")}:` : "";
    return `${hh}${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function setOneOfClasses(el, next, allowed) {
    allowed.forEach(c => el.classList.remove(c));
    el.classList.add(next);
  }

  function initControls(root, { isAudioOnly }) {
    const controlsEl = root.querySelector(".controls");
    if (!controlsEl) {
      throw new Error("Missing element: .controls");
    }

    const stage = document.querySelector(".stage");
    if (stage && !stage.hasAttribute("tabindex")) {
      stage.setAttribute("tabindex", "0");
    }

    const playPause = $(root, "#play-pause-button");
    const progress = $(root, "#progress");
    const posBox = $(root, "#position-duration-box");
    const posText = $(root, "#position-text");
    const durationText = $(root, "#duration");
    const volSwitch = $(root, "#volume-switch");
    const volLevel = $(root, "#volume-level");
    const fullscreen = isAudioOnly ? null : root.querySelector("#fullscreen-switch");

    const state = {
      playback: "paused", // playing | paused | ended
      muted: false,
      durationSec: 5 * 60 + 42,
      currentSec: 0,
      volume: 100,
      fullscreenActive: false
    };

    let hideTimer = null;

    function showControls() {
      controlsEl.classList.remove("controls-hidden");
    }

    function scheduleAutoHide() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      if (state.playback !== "playing") {
        showControls();
        return;
      }
      hideTimer = setTimeout(() => {
        // Only hide if still playing.
        if (state.playback === "playing") {
          controlsEl.classList.add("controls-hidden");
        }
      }, 3000);
    }

    function bumpActivity() {
      showControls();
      scheduleAutoHide();
    }

    function render() {
      setOneOfClasses(playPause, state.playback, ["playing", "paused", "ended"]);
      setOneOfClasses(volSwitch, state.muted || state.volume === 0 ? "muted" : "volumeup", [
        "muted",
        "volumeup"
      ]);

      if (fullscreen) {
        fullscreen.classList.toggle("fullscreen-active", state.fullscreenActive);
      }

      const percent =
        state.durationSec > 0 ? (state.currentSec / state.durationSec) * 100 : 0;
      progress.value = String(clamp(Math.round(percent), 0, 100));
      volLevel.value = String(clamp(state.volume, 0, 100));

      posBox.classList.remove("hidden");
      posText.textContent = formatTimeSeconds(state.currentSec);
      durationText.textContent = ` / ${formatTimeSeconds(state.durationSec)}`;

      scheduleAutoHide();
    }

    function setCurrentFromProgress() {
      const p = clamp(parseInt(progress.value || "0", 10) || 0, 0, 100);
      state.currentSec = Math.round((p / 100) * state.durationSec);
      if (state.currentSec >= state.durationSec) {
        state.playback = "ended";
      } else if (state.playback === "ended") {
        state.playback = "paused";
      }
      render();
    }

    playPause.addEventListener("click", () => {
      state.playback =
        state.playback === "playing"
          ? "paused"
          : state.playback === "ended"
            ? "playing"
            : "playing";
      if (state.playback === "playing" && state.currentSec >= state.durationSec) {
        state.currentSec = 0;
      }
      bumpActivity();
      render();
    });

    volSwitch.addEventListener("click", () => {
      state.muted = !state.muted;
      bumpActivity();
      render();
    });

    volLevel.addEventListener("input", () => {
      state.volume = clamp(parseInt(volLevel.value || "0", 10) || 0, 0, 100);
      if (state.volume === 0) {
        state.muted = true;
      } else {
        state.muted = false;
      }
      bumpActivity();
      render();
    });

    if (fullscreen) {
      fullscreen.addEventListener("click", () => {
        state.fullscreenActive = !state.fullscreenActive;
        bumpActivity();
        render();
      });
    }

    progress.addEventListener("input", setCurrentFromProgress);

    // Keyboard helpers for quick style checking.
    document.addEventListener("keydown", e => {
      if (e.key === " ") {
        e.preventDefault();
        bumpActivity();
        playPause.click();
      } else if (e.key === "m" || e.key === "M") {
        bumpActivity();
        volSwitch.click();
      }
    });

    // Show controls when user is back “on” the video surface.
    if (stage) {
      stage.addEventListener("mousemove", bumpActivity);
      stage.addEventListener("mouseenter", bumpActivity);
      stage.addEventListener("focusin", bumpActivity);
      stage.addEventListener("pointerdown", bumpActivity);
    }

    render();
  }

  function init() {
    const root = document.querySelector(".controls-host");
    if (!root) return;
    const isAudioOnly = document.documentElement.dataset.kind === "audio";
    initControls(root, { isAudioOnly });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

