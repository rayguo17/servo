/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

(() => {
  "use strict";

  // States.
  const BUFFERING = "buffering";
  const ENDED = "ended";
  const ERRORED = "errored";
  const PAUSED = "paused";
  const PLAYING = "playing";

  // State transitions.
  const TRANSITIONS = {
    buffer: {
      paused: BUFFERING
    },
    end: {
      playing: ENDED,
      paused: ENDED
    },
    error: {
      buffering: ERRORED,
      playing: ERRORED,
      paused: ERRORED
    },
    pause: {
      buffering: PAUSED,
      playing: PAUSED
    },
    play: {
      buffering: PLAYING,
      ended: PLAYING,
      paused: PLAYING
    }
  };

  function generateMarkup(isAudioOnly) {
    return `
      <div class="controls two-row">
        <div class="row1">
          <div class="left">
            <button id="play-pause-button"></button>
            <span id="position-duration-box" class="hidden">
              <span id="position-text">#1</span>
              <span id="duration"> / #2</span>
            </span>
          </div>

          <div class="right">
            <div class="volume">
              <button id="volume-switch"></button>
              <input id="volume-level" type="range" value="100" min="0" max="100" step="1"></input>
            </div>
            ${isAudioOnly ? "" : '<button id="fullscreen-switch" class="fullscreen"></button>'}
          </div>
        </div>

        <div class="row2">
          <input id="progress" type="range" value="0" min="0" max="100" step="1"></input>
        </div>
      </div>
    `;
  }

  function camelCase(str) {
    const rdashes = /-(.)/g;
    return str.replace(rdashes, (str, p1) => {
      return p1.toUpperCase();
    });
  }

  function formatTime(time, showHours = false) {
    // Format the duration as "h:mm:ss" or "m:ss"
    time = Math.round(time / 1000);

    const hours = Math.floor(time / 3600);
    const mins = Math.floor((time % 3600) / 60);
    const secs = Math.floor(time % 60);

    const formattedHours =
      hours || showHours ? `${hours.toString().padStart(2, "0")}:` : "";

    return `${formattedHours}${mins
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  class MediaControls {
    constructor() {
      this.nonce = Date.now();
      // Get the instance of the shadow root where these controls live.
      this.controls = document.servoGetMediaControls("@@@id@@@");
      // Get the instance of the host of these controls.
      this.media = this.controls.host;
      this.hideTimer = null;

      this.mutationObserver = new MutationObserver(() => {
        // We can only get here if the `controls` attribute is removed.
        this.cleanup();
      });
      this.mutationObserver.observe(this.media, {
        attributeFilter: ["controls"]
      });

      this.isAudioOnly = this.media.localName == "audio";

      // Create root element and load markup.
      this.root = document.createElement("div");
      this.root.classList.add("root");
      this.root.innerHTML = generateMarkup(this.isAudioOnly);
      this.controls.appendChild(this.root);

      this.controlsElement = this.root.querySelector(".controls");
      if (!this.controlsElement) {
        throw new Error("Missing .controls element");
      }

      // Debug: log geometry after layout.
      this.logGeometrySoon();

      // Make the media focusable so tabbing can reveal controls.
      if (!this.media.hasAttribute("tabindex")) {
        this.media.setAttribute("tabindex", "0");
      }


      const elementNames = [
        "duration",
        "play-pause-button",
        "position-duration-box",
        "position-text",
        "progress",
        "volume-switch",
        "volume-level"
      ];

      if (!this.isAudioOnly) {
        elementNames.push("fullscreen-switch");
      }

      // Import elements.
      this.elements = {};
      elementNames.forEach(id => {
        this.elements[camelCase(id)] = this.controls.getElementById(id);
      });

      // Init position duration box.
      const positionTextNode = this.elements.positionText;
      const durationSpan = this.elements.duration;
      const durationFormat = durationSpan.textContent;
      const positionFormat = positionTextNode.textContent;

      durationSpan.classList.add("duration");
      durationSpan.setAttribute("role", "none");

      Object.defineProperties(this.elements.positionDurationBox, {
        durationSpan: {
          value: durationSpan
        },
        position: {
          get: () => {
            return positionTextNode.textContent;
          },
          set: v => {
            positionTextNode.textContent = positionFormat.replace("#1", v);
          }
        },
        duration: {
          get: () => {
            return durationSpan.textContent;
          },
          set: v => {
            durationSpan.textContent = v ? durationFormat.replace("#2", v) : "";
          }
        },
        show: {
          value: (currentTime, duration) => {
            const self = this.elements.positionDurationBox;
            if (self.position != currentTime) {
              self.position = currentTime;
            }
            if (self.duration != duration) {
              self.duration = duration;
            }
            self.classList.remove("hidden");
          }
        }
      });

      // Add event listeners.
      this.mediaEvents = [
        "play",
        "pause",
        "ended",
        "volumechange",
        "loadeddata",
        "loadstart",
        "timeupdate",
        "progress",
        "playing",
        "waiting",
        "canplay",
        "canplaythrough",
        "seeking",
        "seeked",
        "emptied",
        "loadedmetadata",
        "error",
        "suspend"
      ];
      this.mediaEvents.forEach(event => {
        this.media.addEventListener(event, this);
      });

      this.controlEvents = [
        { el: this.elements.playPauseButton, type: "click" },
        { el: this.elements.volumeSwitch, type: "click" },
        { el: this.elements.volumeLevel, type: "input" }
      ];

      if (!this.isAudioOnly) {
        this.controlEvents.push({ el: this.elements.fullscreenSwitch, type: "click" });
      }

      this.controlEvents.forEach(({ el, type }) => {
        el.addEventListener(type, this);
      });

      // Activity listeners for showing and auto-hiding controls while playing.
      this.activityEvents = [
        "mousemove",
        "mouseenter",
        "pointerdown",
        "touchstart",
        "focus",
        "focusin",
      ];
      this.activityEvents.forEach(type => {
        this.media.addEventListener(type, this, { passive: true });
      });

      // Create state transitions.
      //
      // It exposes one method per transition. i.e. this.pause(), this.play(), etc.
      // For each transition, we check that the transition is possible and call
      // the `onStateChange` handler.
      for (let name in TRANSITIONS) {
        if (!TRANSITIONS.hasOwnProperty(name)) {
          continue;
        }
        this[name] = () => {
          const from = this.state;

          // Checks if the transition is valid in the current state.
          if (!TRANSITIONS[name][from]) {
            const error = `Transition "${name}" invalid for the current state "${from}"`;
            console.error(error);
            throw new Error(error);
          }

          const to = TRANSITIONS[name][from];

          if (from == to) {
            return;
          }

          // Transition to the next state.
          this.state = to;
          this.onStateChange(from);
        };
      }

      // Set initial state.
      this.state = this.media.paused ? PAUSED : PLAYING;
      this.onStateChange(null);
    }

    logGeometrySoon() {
      const log = () => {
        const entries = [];
        const add = (label, el) => {
          if (!el) return;
          const r = el.getBoundingClientRect();
          entries.push({
            label,
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        };

        add("media", this.media);
        add("root", this.root);
        add("controls", this.controlsElement);
        add("playPauseButton", this.elements?.playPauseButton);
        add("positionDurationBox", this.elements?.positionDurationBox);
        add("progress", this.elements?.progress);
        add("volumeSwitch", this.elements?.volumeSwitch);
        add("volumeLevel", this.elements?.volumeLevel);
        add("fullscreenSwitch", this.elements?.fullscreenSwitch);

        console.log("[media-controls geometry]", entries);
      };

      // Wait for at least one layout pass.
      requestAnimationFrame(() => requestAnimationFrame(log));
    }

    cleanup() {
      this.mutationObserver.disconnect();
      this.mediaEvents.forEach(event => {
        this.media.removeEventListener(event, this);
      });
      this.controlEvents.forEach(({ el, type }) => {
        el.removeEventListener(type, this);
      });
      this.activityEvents.forEach(type => {
        this.media.removeEventListener(type, this);
      });
      this.clearAutoHideTimer();
    }

    clearAutoHideTimer() {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
    }

    showControls() {
      this.controlsElement.classList.remove("controls-hidden");
    }

    hideControls() {
      this.controlsElement.classList.add("controls-hidden");
    }

    scheduleAutoHide() {
      this.clearAutoHideTimer();
      if (this.state !== PLAYING) {
        this.showControls();
        return;
      }
      this.hideTimer = setTimeout(() => {
        if (this.state === PLAYING) {
          this.hideControls();
        }
      }, 3000);
    }

    bumpActivity() {
      this.showControls();
      this.scheduleAutoHide();
    }

    // State change handler
    onStateChange(from) {
      this.render(from);
    }

    render(from = this.state) {
      // Error
      if (this.state == ERRORED) {
        // XXX render errored state
        return;
      }

      if (this.state != from) {
        // Play/Pause button.
        const playPauseButton = this.elements.playPauseButton;
        playPauseButton.classList.remove(from);
        playPauseButton.classList.add(this.state);
      }

      // Progress.
      const positionPercent =
        (this.media.currentTime / this.media.duration) * 100;
      if (Number.isFinite(positionPercent)) {
        this.elements.progress.value = positionPercent;
      } else {
        this.elements.progress.value = 0;
      }

      // Current time and duration.
      let currentTime = formatTime(0);
      let duration = formatTime(0);
      if (!isNaN(this.media.currentTime) && !isNaN(this.media.duration)) {
        currentTime = formatTime(Math.round(this.media.currentTime * 1000));
        duration = formatTime(Math.round(this.media.duration * 1000));
      }
      this.elements.positionDurationBox.show(currentTime, duration);

      // Volume.
      this.elements.volumeSwitch.className =
        this.media.muted || !this.media.volume ? "muted" : "volumeup";
      const volumeLevelValue = this.media.muted
        ? 0
        : Math.round(this.media.volume * 100);
      if (this.elements.volumeLevel.value != volumeLevelValue) {
        this.elements.volumeLevel.value = volumeLevelValue;
      }

      this.scheduleAutoHide();
    }

    handleEvent(event) {
      if (!event.isTrusted) {
        console.warn(`Drop untrusted event ${event.type}`);
        return;
      }

      if (this.mediaEvents.includes(event.type)) {
        this.onMediaEvent(event);
      } else if (this.activityEvents.includes(event.type)) {
        this.bumpActivity();
      } else {
        this.onControlEvent(event);
      }
    }

    onControlEvent(event) {
      switch (event.type) {
        case "click":
          this.bumpActivity();
          switch (event.currentTarget) {
            case this.elements.playPauseButton:
              this.playOrPause();
              break;
            case this.elements.volumeSwitch:
              this.toggleMuted();
              break;
            case this.elements.fullscreenSwitch:
                this.toggleFullscreen();
                break;
          }
          break;
        case "input":
          this.bumpActivity();
          switch (event.currentTarget) {
            case this.elements.volumeLevel:
              this.changeVolume();
              break;
          }
          break;
        default:
          throw new Error(`Unknown event ${event.type}`);
      }
    }

    // HTMLMediaElement event handler
    onMediaEvent(event) {
      switch (event.type) {
        case "ended":
          this.end();
          break;
        case "play":
        case "pause":
          // Transition to PLAYING or PAUSED state.
          this[event.type]();
          break;
        case "volumechange":
        case "timeupdate":
        case "resize":
          this.render();
          break;
        case "loadedmetadata":
          break;
      }
    }

    /* Media actions */

    playOrPause() {
      switch (this.state) {
        case PLAYING:
          this.media.pause();
          break;
        case BUFFERING:
        case ENDED:
        case PAUSED:
          this.media.play();
          break;
        default:
          throw new Error(`Invalid state ${this.state}`);
      }
    }

    toggleMuted() {
      this.media.muted = !this.media.muted;
    }

    toggleFullscreen() {
        const { fullscreenEnabled, fullscreenElement } = document;

        const isElementFullscreen = fullscreenElement && fullscreenElement === this.media;

        if (fullscreenEnabled && isElementFullscreen) {
            document.exitFullscreen().then(() => {
                this.elements.fullscreenSwitch.classList.remove("fullscreen-active");
            });
        } else {
            this.media.requestFullscreen().then(() => {
                this.elements.fullscreenSwitch.classList.add("fullscreen-active");
            });
        }
    }

    changeVolume() {
      const volume = parseInt(this.elements.volumeLevel.value);
      if (!isNaN(volume)) {
        this.media.volume = volume / 100;
      }
    }
  }

  new MediaControls();
})();

