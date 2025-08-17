// Carga única de la IFrame API de YouTube (compartida por todas las instancias)
window.__ytApiReadyPromise = new Promise((resolve) => {
	if (window.YT && window.YT.Player) return resolve();
	const tag = document.createElement('script');
	tag.src = 'https://www.youtube.com/iframe_api';
	document.head.appendChild(tag);
	window.onYouTubeIframeAPIReady = () => resolve();
});

class LCYouTube extends HTMLElement {
	static get observedAttributes() { return ['video']; }

	constructor() {
		super();
		this._video = '';
		this._player = null;
		this._duration = 0;
		this._timer = null;
		this._lastTap = 0;
		this.attachShadow({ mode: 'open' });
		this.shadowRoot.innerHTML = `
      <style>
        :host{display:block}
        .yt-wrap{position:relative;max-width:1920px;margin:auto;background:#000;aspect-ratio:16/9;overflow:hidden;border-radius:5px}
        iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
        .overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:linear-gradient(to bottom, rgba(0,0,0,.35), rgba(0,0,0,.65));cursor:pointer;z-index:3}
        .overlay.playing{ background: transparent; }
        .overlay.playing .play{ display: none; }
        .overlay .play{width:84px;height:84px;border-radius:50%;background:#fff;display:grid;place-items:center;box-shadow:0 8px 30px rgba(0,0,0,.4)}
        .overlay .play:after{content:"";display:block;width:0;height:0;border-left:28px solid #000;border-top:18px solid transparent;border-bottom:18px solid transparent;margin-left:6px}
        .controls{position:absolute;left:0;right:0;bottom:0;padding:10px;display:flex;gap:10px;align-items:center;background:linear-gradient(to top, rgba(0,0,0,.55), rgba(0,0,0,0));z-index:4;user-select:none;opacity:0;pointer-events:none;transition: opacity .2s ease}
        .yt-wrap:hover .controls,.yt-wrap.show-controls .controls{opacity:1;pointer-events:auto}
        .btn,.time,.vol,.fs{color:#fff;font:500 14px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif}
        .btn{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,.12);cursor:pointer}
        .btn:hover{background:rgba(255,255,255,.2)}
        .progress{position:relative;flex:1;height:6px;background:rgba(255,255,255,.25);border-radius:999px;cursor:pointer}
        .progress .bar{position:absolute;left:0;top:0;height:100%;width:0;background:#fff;border-radius:999px}
        .progress .seek{position:absolute;left:0;top:50%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;background:#fff}
        .time{min-width:110px;text-align:center;opacity:.9}
        .vol{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);padding:6px 10px;border-radius:10px}
        .vol input{accent-color:#fff}
        .fs{cursor:pointer;background:rgba(255,255,255,.12);padding:6px 10px;border-radius:10px}
        .live-badge{position:absolute;top:10px;left:10px;display:none;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:rgba(255,0,0,.85);color:#fff;font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.3px;z-index:5;pointer-events:none}
        .live-badge .dot{width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 0 0 rgba(255,255,255,0.9);animation: pulse 1.2s ease-out infinite}
        @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,0.9)}70%{box-shadow:0 0 0 10px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
        .root{ -webkit-touch-callout:none; -webkit-user-select:none; -moz-user-select:none; user-select:none }
      </style>
      <div class="root">
        <div class="yt-wrap" id="wrap">
          <div class="overlay" id="overlay" aria-label="Reproducir/Pausar" role="button" tabindex="0">
            <div class="play" title="Reproducir"></div>
          </div>
          <div id="player"></div>
          <div class="live-badge" id="live"><span class="dot"></span> EN VIVO</div>
          <div class="controls" id="controls">
            <div class="btn" id="playPause" title="Reproducir/Pausar">▶︎</div>
            <div class="progress" id="progress" title="Buscar">
              <div class="bar" id="bar"></div>
              <div class="seek" id="seek"></div>
            </div>
            <div class="time" id="time">00:00 / 00:00</div>
            <div class="vol">🔊 <input type="range" id="volume" min="0" max="100" value="80" /></div>
            <div class="fs btn" id="fs" title="Pantalla completa">⛶</div>
          </div>
        </div>
      </div>
    `;
	}

	connectedCallback() {
		this._video = this.getAttribute('video') || '';
		this._cacheEls();
		this._bindUI();
		this._mountPlayer();
	}

	disconnectedCallback() { this._teardown(); }

	attributeChangedCallback(name, oldV, newV) {
		if (name === 'video' && oldV !== newV) {
			this._video = newV || '';
			if (this._player) { this._player.loadVideoById(this._video); }
			this._isLive = false;
		}
	}

	_cacheEls() {
		const r = this.shadowRoot;
		this.$wrap = r.getElementById('wrap');
		this.$overlay = r.getElementById('overlay');
		this.$player = r.getElementById('player');
		this.$live = r.getElementById('live');
		this.$progress = r.getElementById('progress');
		this.$bar = r.getElementById('bar');
		this.$seek = r.getElementById('seek');
		this.$time = r.getElementById('time');
		this.$vol = r.getElementById('volume');
		this.$fs = r.getElementById('fs');
		this.$playBtn = r.getElementById('playPause');
	}

  _detectLive(){
    try {
      const d = this._player?.getDuration?.() || 0;
      // Si ya fue detectado como live, mantenlo (evita falsos negativos cuando hay DVR)
      return this._isLive || d === 0;
    } catch(_) { return !!this._isLive; }
  }

  _setLiveUI(isLive){
    const next = !!isLive || !!this._isLive; // sticky mientras no cambie el video
    this._isLive = next;
    if(this.$live) this.$live.style.display = this._isLive ? 'inline-flex' : 'none';
    // Mantener barra visible también en live (DVR)
    if(this.$progress) this.$progress.style.display = '';
    if(this.$time) this.$time.textContent = this._isLive ? 'EN VIVO' : this.$time.textContent;
  }

	_bindUI() {
		// Auto-hide de controles
		this._controlsTimer = null;
		const blinkControls = () => {
			this.$wrap.classList.add('show-controls');
			clearTimeout(this._controlsTimer);
			this._controlsTimer = setTimeout(() => this.$wrap.classList.remove('show-controls'), 2000);
		};
		this._blinkControls = blinkControls;
		['mousemove', 'touchstart'].forEach(evt => this.$wrap.addEventListener(evt, blinkControls));

		// Overlay: play/pause
		this.$overlay.addEventListener('click', () => {
			const st = this._player?.getPlayerState?.();
			if (st === YT.PlayerState.PLAYING) this._player.pauseVideo(); else this._player.playVideo();
		});
		this.$overlay.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); this.$overlay.click(); } });

		// Botón pequeño play/pause
		this.$playBtn.addEventListener('click', () => {
			const st = this._player?.getPlayerState?.();
			if (st === YT.PlayerState.PLAYING) this._player.pauseVideo(); else this._player.playVideo();
		});

		// Seek con click
		this.$progress.addEventListener('click', (e) => {
			const rect = this.$progress.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const pct = Math.min(1, Math.max(0, x / rect.width));
      const effDur = (this._duration && this._duration > 0) ? this._duration : (this._player?.getCurrentTime?.() || 0);
      if (effDur > 0) {
        const target = effDur * pct;
        this._player.seekTo(target, true);
        this._immediateUI(target);
      }
		});

		// Doble click/tap: ±10s
		this.$overlay.addEventListener('dblclick', (e) => {
			const rect = this.$overlay.getBoundingClientRect();
			const x = e.clientX - rect.left; const mid = rect.width / 2;
			const cur = this._player.getCurrentTime(); const delta = x < mid ? -10 : 10;
			const target = Math.max(0, cur + delta);
			this._player.seekTo(target, true); this._immediateUI(target); blinkControls();
		});
		this.$overlay.addEventListener('touchend', (e) => {
			const now = Date.now(); const dt = now - this._lastTap; this._lastTap = now;
			if (dt < 300) {
				const touch = e.changedTouches[0]; const rect = this.$overlay.getBoundingClientRect();
				const x = touch.clientX - rect.left; const mid = rect.width / 2;
				const cur = this._player.getCurrentTime(); const delta = x < mid ? -10 : 10;
				const target = Math.max(0, cur + delta);
				this._player.seekTo(target, true); this._immediateUI(target); blinkControls();
			}
		});

		// Volumen y fullscreen
		this.$vol.addEventListener('input', () => { this._player.setVolume(parseInt(this.$vol.value, 10)); });
		this.$fs.addEventListener('click', () => {
			const el = this.$wrap; const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen; if (req) req.call(el);
		});

		// Context menu
		this.$wrap.addEventListener('contextmenu', e => e.preventDefault());
	}

	async _mountPlayer() {
		if (!this._video) return;
		await window.__ytApiReadyPromise;
		this._player = new YT.Player(this.$player, {
			videoId: this._video,
			playerVars: { controls: 0, modestbranding: 1, rel: 0, disablekb: 1, fs: 0, playsinline: 1, iv_load_policy: 3 },
			events: { onReady: () => this._onReady(), onStateChange: (e) => this._onStateChange(e) }
		});
	}

	_onReady() {
		this._player.setVolume(parseInt(this.$vol.value, 10));
		this._duration = this._player.getDuration() || 0;
		this._updateUI();
    this._setLiveUI(this._detectLive());
	}

	_onStateChange(e) {
    // Actualiza modo live por si cambia al cargar
    this._setLiveUI(this._detectLive());
		if (e.data === YT.PlayerState.PLAYING) {
			this.$overlay.classList.add('playing');
			this._startTimer();
			this._blinkControls();
			this.$playBtn.textContent = '❚❚';
		} else if (e.data === YT.PlayerState.PAUSED) {
			this.$overlay.classList.remove('playing');
			this._stopTimer();
			this._blinkControls();
			this.$playBtn.textContent = '▶︎';
		} else if (e.data === YT.PlayerState.ENDED) {
			this.$overlay.classList.remove('playing');
			this._stopTimer();
			this._blinkControls();
			this.$playBtn.textContent = '▶︎';
		}
	}

	_updateUI() {
    if (!this._player || typeof this._player.getCurrentTime !== 'function') return;
    this._setLiveUI(this._detectLive());
    const t = this._player.getCurrentTime() || 0;
    this._duration = this._player.getDuration() || this._duration || 0;
    // En live, mantener barra y permitir seek. Si getDuration() es 0, usamos t como "duración" efectiva.
    if (this._isLive && (!this._duration || this._duration === 0)) {
      this._duration = Math.max(this._duration, t);
    }
		const pct = this._duration ? (t / this._duration) : 0;
		this.$bar.style.width = (pct * 100) + '%';
		this.$seek.style.left = (pct * 100) + '%';
		this.$time.textContent = this._isLive ? `${this._fmt(t)} / EN VIVO` : `${this._fmt(t)} / ${this._fmt(this._duration)}`;
	}

	_immediateUI(target) {
    // En live, también actualizamos la barra; si no hay duración, usamos target o tiempo actual como referencia
    if (this._isLive && (!this._duration || this._duration === 0)) {
      this._duration = Math.max(this._duration, target || 0);
    }
		const pct = this._duration ? (target / this._duration) : 0;
		this.$bar.style.width = (pct * 100) + '%';
		this.$seek.style.left = (pct * 100) + '%';
		this.$time.textContent = `${this._fmt(target)} / ${this._fmt(this._duration)}`;
		setTimeout(() => this._updateUI(), 120);
	}

	_startTimer() { if (!this._timer) this._timer = setInterval(() => this._updateUI(), 250); }
	_stopTimer() { clearInterval(this._timer); this._timer = null; }

	_fmt(s) { s = Math.max(0, Math.floor(s || 0)); const m = String(Math.floor(s / 60)).padStart(2, '0'); const sec = String(s % 60).padStart(2, '0'); return `${m}:${sec}`; }

	_teardown() {
		try { this._stopTimer(); this._player && this._player.destroy && this._player.destroy(); } catch (_) { }
	}
}

customElements.define('lc-youtube', LCYouTube);
