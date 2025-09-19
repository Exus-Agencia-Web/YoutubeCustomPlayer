// Carga única de la IFrame API de YouTube (compartida por todas las instancias)
window.__ytApiReadyPromise = new Promise((resolve) => {
	if (window.YT && window.YT.Player) return resolve();
	const tag = document.createElement('script');
	tag.src = 'https://www.youtube.com/iframe_api';
	document.head.appendChild(tag);
	window.onYouTubeIframeAPIReady = () => resolve();
});

class LCYouTube extends HTMLElement {
	static get observedAttributes() { return ['video','playlist','index','autoplay','dvr-window']; }

	constructor() {
		super();
		this._video = '';
		this._playlist = '';
		this._index = 0;
		this._autoplay = false;
		this._userInteracted = false;
		this._player = null;
		this._duration = 0;
		this._timer = null;
		this._lastTap = 0;
		this._lastDuration = 0;
		this._dvrWindow = 14400; // 4 horas por defecto
		this._liveStable = false;
		this._liveTicks = 0;
		this._dvrStable = false;
		this._dvrTicks = 0;
		this._userMuted = false; // rastrea si el usuario decidió silenciar
		this._handleKeydown = null;
		this.attachShadow({ mode: 'open' });
		this.shadowRoot.innerHTML = `
      <style>
        .vol-toggle{display:inline-flex}
        :host{display:block}
        .yt-wrap{position:relative;max-width:1920px;margin:auto;background:#000;aspect-ratio:16/9;border-radius:5px}
        .overlay,.controls,#player,.live-badge{border-radius:inherit}
        iframe{border-radius:inherit}
        iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
        .overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.95);cursor:pointer;z-index:3}
        .overlay.playing{ background: transparent; }
        .overlay.playing .play{ display: none; }
        .overlay .play{width:84px;height:84px;border-radius:50%;background:#fff;display:grid;place-items:center;box-shadow:0 8px 30px rgba(0,0,0,.4)}
        .overlay .play:after{content:"";display:block;width:0;height:0;border-left:28px solid #000;border-top:18px solid transparent;border-bottom:18px solid transparent;margin-left:6px}
        .controls{position:absolute;left:0;right:0;bottom:0;padding:10px;display:flex;gap:10px;align-items:center;background:linear-gradient(to top, rgba(0,0,0,.55), rgba(0,0,0,0));z-index:4;user-select:none;opacity:0;pointer-events:none;transition: opacity .2s ease}
        .yt-wrap:hover .controls,.yt-wrap.show-controls .controls{opacity:1;pointer-events:auto}
        .btn,.time,.vol,.fs{color:#fff;font:500 14px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif}
        .btn{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,.12);cursor:pointer}
        .btn:hover{background:rgba(255,255,255,.2)}
        .btn-live{background:rgba(255,0,0,.85); font-weight:600}
        .btn-live:hover{background:rgba(255,0,0,.95)}
        .btn-live .dot{width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 0 0 rgba(255,255,255,0.9);animation: pulse 1.2s ease-out infinite}
        #goLive{display:none}
        .progress{position:relative;flex:1;height:6px;background:rgba(255,255,255,.25);border-radius:999px;cursor:pointer}
        .progress.disabled{opacity:.5; cursor:not-allowed}
        .progress.disabled .seek{display:none}
        .progress .bar{position:absolute;left:0;top:0;height:100%;width:0;background:#fff;border-radius:999px}
        .progress .seek{position:absolute;left:0;top:50%;transform:translate(-50%,-50%);width:14px;height:14px;border-radius:50%;background:#fff}
        .time{min-width:110px;text-align:center;opacity:.9}
        .vol{display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);padding:6px 10px;border-radius:10px}
        .vol input{accent-color:#fff}
        .fs{cursor:pointer;background:rgba(255,255,255,.12);padding:6px 10px;border-radius:10px}
        .vol-toggle{position:relative;align-items:center;justify-content:center;color:#fff}
        .vol-toggle svg{width:20px;height:20px;display:block}
        .vol-toggle svg path{fill:currentColor !important} /* fuerza a usar currentColor */
        .vol-toggle.muted{color:#ff3b30}
        .live-badge{position:absolute;top:10px;left:10px;display:none;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:rgba(255,0,0,.85);color:#fff;font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.3px;z-index:5;pointer-events:none}
        .live-badge .dot{width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 0 0 rgba(255,255,255,0.9);animation: pulse 1.2s ease-out infinite}
        .sound-hint{position:absolute;top:15px;right:15px;background:rgba(0,0,0,.65);color:#fff;padding:6px 12px;border-radius:8px;font:500 13px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer;z-index:6;user-select:none}
        .sound-hint.hide{display:none}
        .error-mask{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:#000;color:#fff;font:600 16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;z-index:7;text-align:center;padding:20px;border-radius:inherit}
        .error-mask.show{display:flex}
        @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,0.9)}70%{box-shadow:0 0 0 10px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}
        .root{ -webkit-touch-callout:none; -webkit-user-select:none; -moz-user-select:none; user-select:none }
        .yt-wrap.live .controls{opacity:1;pointer-events:auto}
        /* === Accesibilidad móvil / touch === */
        /* Respeta la zona segura de iOS (home bar) y hace la barra más grande para dedo */
        :root { --lc-safe: env(safe-area-inset-bottom, 0px); }
        /* En dispositivos táctiles, no ocultar controles por hover */
        @media (hover: none) {
          .yt-wrap .controls{opacity:1;pointer-events:auto}
        }
        /* Aumenta el padding inferior considerando la zona segura */
        .controls{padding-bottom: calc(10px + var(--lc-safe));}
        /* Ajustes específicos para pantallas pequeñas */
        @media (max-width: 600px){
          .controls{gap:8px;padding:12px 10px calc(12px + var(--lc-safe));}
          .btn,.time,.vol,.fs{font:500 15px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif}
          .progress{height:12px}
          .progress .seek{width:18px;height:18px}
          .time{min-width:90px}
        }
        /* Controles de volumen y GoLive compactos en móvil */
        @media (max-width:600px){
          .vol{display:none !important;}          /* Oculta slider */
          #goLive{display:none !important;}      /* Oculta botón para liberar espacio */
          .vol-toggle{display:inline-flex;}      /* Muestra botón toggle */
        }
        @media (min-width:601px){
          .vol-toggle{display:inline-flex;}             /* En desktop también mostramos el botón simple */
        }
      </style>
      <div class="root">
        <div class="yt-wrap" id="wrap">
          <div class="overlay" id="overlay" aria-label="Reproducir/Pausar" role="button" tabindex="0">
            <div class="play" title="Reproducir"></div>
          </div>
          <div id="player"></div>
          <div class="error-mask" id="errorMask">Video no disponible</div>
          <div class="live-badge" id="live"><span class="dot"></span> EN VIVO</div>
          <div class="sound-hint hide" id="soundHint">🔊 Toca para activar sonido</div>
          <div class="controls" id="controls">
            <div class="btn" id="prev" title="Anterior">⏮</div>
            <div class="btn" id="playPause" title="Reproducir/Pausar">▶︎</div>
            <div class="btn" id="next" title="Siguiente">⏭</div>
            <div class="progress" id="progress" title="Buscar">
              <div class="bar" id="bar"></div>
              <div class="seek" id="seek"></div>
            </div>
            <div class="time" id="time">00:00 / 00:00</div>
            <div class="btn btn-live" id="goLive" title="Ir al punto en vivo"><span class="dot"></span>&nbsp; IR AL VIVO</div>
            <div class="btn vol-toggle" id="volToggle" title="Silenciar/Activar volumen">
              <svg version="1.0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
                <g><g>
                  <path d="M59.998,28.001h-7.999c-2.211,0-4,1.789-4,4s1.789,4,4,4h7.999c2.211,0,4-1.789,4-4 S62.209,28.001,59.998,28.001z"></path>
                  <path d="M49.71,19.466l6.929-4c1.914-1.105,2.57-3.551,1.461-5.465c-1.102-1.914-3.547-2.57-5.46-1.465l-6.93,4 c-1.914,1.105-2.57,3.551-1.461,5.464C45.351,19.915,47.796,20.571,49.71,19.466z"></path>
                  <path d="M56.639,48.535l-6.929-3.999c-1.914-1.105-4.355-0.449-5.461,1.464c-1.105,1.914-0.453,4.359,1.461,5.465 l6.93,4c1.913,1.105,4.358,0.449,5.464-1.465S58.553,49.641,56.639,48.535z"></path>
                  <path d="M37.53,0.307c-1.492-0.625-3.211-0.277-4.359,0.867L18.343,16.001H4c-2.211,0-4,1.789-4,4v24 C0,46.211,1.789,48,4,48h14.343l14.828,14.828C33.937,63.594,34.96,64,35.999,64c0.516,0,1.035-0.098,1.531-0.305 c1.496-0.617,2.469-2.078,2.469-3.695V4.001C39.999,2.384,39.026,0.924,37.53,0.307z"></path>
                </g></g>
              </svg>
            </div>
            <div class="vol"><input type="range" id="volume" min="0" max="100" value="100" /></div>
            <div class="fs btn" id="fs" title="Pantalla completa">⛶</div>
          </div>
        </div>
      </div>
    `;
	}

	_parseBool(val){ if (val == null) return false; const s = String(val).toLowerCase().trim(); return s === '1' || s === 'true' || s === 'yes' || s === ''; }

	_parseListId(val){
     if (!val) return '';
     try {
       // Si viene una URL de embed o watch con ?list=
       if (/^https?:\/\//i.test(val)) {
         const u = new URL(val, window.location.href);
         const id = u.searchParams.get('list');
         if (id) return id;
       }
     } catch(_) {}
     // Si parece un ID de playlist (PL, UU, OL, RD)
     if (/^(PL|UU|OL|RD)[A-Za-z0-9_-]+$/.test(val)) return val;
     return '';
   }

  _parseVideoId(val){
    if (!val) return '';
    try {
      if (/^https?:\/\//i.test(val)) {
        const u = new URL(val, window.location.href);
        // 1) Standard watch URL: ?v=
        const vParam = u.searchParams.get('v');
        if (vParam) return vParam;
        // 2) youtu.be/<id>
        const host = (u.hostname || '').replace(/^www\./, '');
        const parts = (u.pathname || '').split('/').filter(Boolean);
        if (host === 'youtu.be' && parts[0]) return parts[0];
        // 3) /embed/<id>
        const eIdx = parts.indexOf('embed');
        if (eIdx !== -1 && parts[eIdx + 1]) return parts[eIdx + 1];
        // 4) /shorts/<id>
        const sIdx = parts.indexOf('shorts');
        if (sIdx !== -1 && parts[sIdx + 1]) return parts[sIdx + 1];
        // 5) /live/<id>
        const lIdx = parts.indexOf('live');
        if (lIdx !== -1 && parts[lIdx + 1]) return parts[lIdx + 1];
      }
    } catch(_) {}
    // Fallback: si parece un ID válido de 11 caracteres
    if (/^[A-Za-z0-9_-]{11}$/.test(val)) return val;
    return '';
  }

	connectedCallback() {
		this._video = this._parseVideoId(this.getAttribute('video') || '');
		this._playlist = this._parseListId(this.getAttribute('playlist') || '');
				let idxAttr = parseInt(this.getAttribute('index') || '0', 10);
					if (idxAttr === -1) {
						this._startAtLast = true;
						this._index = 0;
					} else {
						this._startAtLast = false;
						this._index = idxAttr > 0 ? idxAttr - 1 : 0;
					}
		this._autoplay = this._parseBool(this.getAttribute('autoplay')) || this.hasAttribute('autoplay');
		const dvrAttr = parseInt(this.getAttribute('dvr-window') || '', 10);
		if (!Number.isNaN(dvrAttr) && dvrAttr > 60) this._dvrWindow = dvrAttr;
		this._cacheEls();
		this._bindUI();
		this._mountPlayer();
	}

	disconnectedCallback() { this._teardown(); }

	attributeChangedCallback(name, oldV, newV) {
		if (name === 'video' && oldV !== newV) {
		  this._video = this._parseVideoId(newV || '');
		  this._isLive = false;
		  // Si aún no existe el player y ahora tenemos un video válido, móntalo
		  if (!this._player) {
		    if (this._video || this._playlist) {
		      this._mountPlayer();
		    }
		    return;
		  }
		  // Si ya existe, carga el nuevo video
		  if (this._video) {
		    try { this._player.loadVideoById(this._video); } catch(_) {}
		  }
		}
		if (name === 'playlist' && oldV !== newV) {
		  this._playlist = this._parseListId(newV || '');
		  // Si aún no existe el player y ahora tenemos playlist (o video), móntalo
		  if (!this._player) {
		    if (this._playlist || this._video) {
		      this._mountPlayer();
		    }
		    this._updatePlaylistNav();
		    return;
		  }
		  if (this._player && this._playlist) {
		    const payload = { list: this._playlist, listType: 'playlist', index: this._index };
		    try { this._autoplay ? this._player.loadPlaylist(payload) : this._player.cuePlaylist(payload); } catch(_) {}
		  }
		  this._updatePlaylistNav();
		}
					if (name === 'index' && oldV !== newV) {
						let idxAttr = parseInt(newV || '0', 10);
						if (idxAttr === -1) {
							this._startAtLast = true;
							this._index = 0;
						} else {
							this._startAtLast = false;
							this._index = idxAttr > 0 ? idxAttr - 1 : 0;
						}
						if (this._player && this._playlist) {
							if (this._startAtLast && typeof this._player.getPlaylist === 'function') {
								const list = this._player.getPlaylist();
								const lastIdx = Array.isArray(list) ? list.length - 1 : 0;
								try { this._player.playVideoAt(lastIdx); } catch(_) {}
							} else {
								try { this._player.playVideoAt(this._index); } catch(_) {}
							}
						}
						this._updatePlaylistNav();
					}
		if (name === 'autoplay' && oldV !== newV) {
			this._autoplay = this._parseBool(newV) || this.hasAttribute('autoplay');
			if (this._player && this._autoplay) {
				try { this._player.mute(); this._player.playVideo(); } catch(_) {}
			}
			this._updatePlaylistNav();
		}
		if (name === 'dvr-window' && oldV !== newV) {
			const dvrAttr = parseInt(newV || '', 10);
			if (!Number.isNaN(dvrAttr) && dvrAttr > 60) this._dvrWindow = dvrAttr;
		}
	}

	_cacheEls() {
		const r = this.shadowRoot;
		this.$wrap = r.getElementById('wrap');
		this.$overlay = r.getElementById('overlay');
		this.$player = r.getElementById('player');
		this.$live = r.getElementById('live');
		this.$soundHint = r.getElementById('soundHint');
		this.$progress = r.getElementById('progress');
		this.$bar = r.getElementById('bar');
		this.$seek = r.getElementById('seek');
		this.$time = r.getElementById('time');
		this.$goLive = r.getElementById('goLive');
		this.$vol = r.getElementById('volume');
    this.$volToggle = r.getElementById('volToggle');
		this.$fs = r.getElementById('fs');
		this.$playBtn = r.getElementById('playPause');
		this.$error = r.getElementById('errorMask');
		this.$controls = r.getElementById('controls');
		this.$prev = r.getElementById('prev');
		this.$next = r.getElementById('next');
	}
	_showError(){
	  try { this._stopTimer(); } catch(_){}
	  if (this.$overlay) this.$overlay.style.display = 'none';
	  if (this.$controls) this.$controls.style.display = 'none';
	  if (this.$error) this.$error.classList.add('show');
	}
	
	_detectLive() {
	  try {
	    // No aplica para playlists
	    if (this._playlist) return false;

	    // 1) Señal primaria y estable expuesta por la IFrame API
	    const data = this._player?.getVideoData?.() || {};
	    if (typeof data.isLiveContent === 'boolean') {
	      return data.isLiveContent;
	    }

	    // 2) Fallbacks: estado activo + duración característica
	    const st = this._player?.getPlayerState?.();
	    const active = st === YT.PlayerState.PLAYING || st === YT.PlayerState.BUFFERING || st === YT.PlayerState.PAUSED;
	    const dur = Number(this._player?.getDuration?.() || 0);

	    // En transmisiones en vivo SIN DVR la duración suele ser 0 mientras el player está activo
	    if (active && dur === 0) return true;

	    // En vivo con DVR: la duración existe (>0) y puede crecer con el tiempo, pero sin `isLiveContent`
	    // asumimos "en vivo" si vemos duración > 0 mientras está activo y el tiempo actual está muy cerca del borde (escenario común al iniciar).
	    if (active && dur > 0) {
	      const t = Number(this._player?.getCurrentTime?.() || 0);
	      // Si t está dentro de la ventana [0, dur] y dur es razonable, tratamos como live.
	      if (t >= 0 && t <= dur + 1) return true;
	    }

	    return false;
	  } catch (_) {
	    return false;
	  }
	}
	_hasLiveDVR() {
	  try {
	    if (!this._isLive) return false;
	    const d = Number(this._player?.getDuration?.() || 0);
	    // En YouTube, si una transmisión en vivo tiene DVR, la duración reportada es > 0
	    const raw = d > 0;
	    if (raw !== this._dvrStable) {
	      this._dvrTicks++;
	      if (this._dvrTicks >= 2) { this._dvrStable = raw; this._dvrTicks = 0; }
	    } else {
	      this._dvrTicks = 0;
	    }
	    return this._dvrStable;
	  } catch(_) { return this._dvrStable || false; }
	}

	_getDvrRange() {
		// Devuelve el rango [start,end] para la ventana DVR visible/usable
		// end = borde en vivo (duration), start = end - ventana (clamp >= 0)
		const end = Math.max(0, this._player?.getDuration?.() || this._duration || 0);
		const win = Math.max(60, Math.min(this._dvrWindow, end));
		const start = Math.max(0, end - win);
		return { start, end };
	}

  _setLiveUI(isLive){
    const prevLive = !!this._isLive;
    const nextLive = !!isLive;
    this._isLive = nextLive;
    if (this.$wrap) { if (nextLive) this.$wrap.classList.add('live'); else this.$wrap.classList.remove('live'); }
    if (this.$live && prevLive !== nextLive) this.$live.style.display = nextLive ? 'inline-flex' : 'none';
    if (this.$progress) {
      this.$progress.style.display = '';
      const shouldDisable = this._isLive && !this._hasLiveDVR();
      if (shouldDisable) this.$progress.classList.add('disabled'); else this.$progress.classList.remove('disabled');
    }
  }

  _ensureAudioOnUserPlay(){
    try{
      if (!this._player) return;
      const muted = this._player?.isMuted && this._player.isMuted();
      if (muted && !this._userMuted){
        this._player.unMute();
        const v = this.$vol ? parseInt(this.$vol.value,10) || 100 : 100;
        this._player.setVolume(v);
        if (this.$volToggle) this.$volToggle.classList.remove('muted');
      }
    }catch(_){}
  }

	_getFullscreenElement(){
		if (typeof document === 'undefined') return null;
		return document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement || null;
	}

	_requestFullscreen(el){
		if (!el) return;
		const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || el.mozRequestFullScreen;
		if (req) {
			try { req.call(el); } catch(_) {}
		}
	}

	_exitFullscreen(){
		if (typeof document === 'undefined') return;
		const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen || document.mozCancelFullScreen;
		if (exit) {
			try { exit.call(document); } catch(_) {}
		}
	}

	_toggleFullscreen(force){
		const isFs = !!this._getFullscreenElement();
		if (force === true) {
			if (!isFs) this._requestFullscreen(this.$wrap);
			return;
		}
		if (force === false) {
			if (isFs) this._exitFullscreen();
			return;
		}
		if (isFs) this._exitFullscreen(); else this._requestFullscreen(this.$wrap);
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

		// Inicializar visibilidad del hint de sonido
		if (this.$soundHint) {
			if (this._autoplay) this.$soundHint.classList.remove('hide'); else this.$soundHint.classList.add('hide');
		}

		// Handler del hint
		if (this._autoplay && this.$soundHint) {
			this.$soundHint.addEventListener('click', (e) => {
				e.stopPropagation();
				try {
					if (this._player?.isMuted && this._player.isMuted()) this._player.unMute();
					this._player?.setVolume?.(parseInt(this.$vol.value, 10));
					this._player?.playVideo?.();
				} catch(_) {}
				this.$soundHint.classList.add('hide');
				this._userMuted = false;
				this._userInteracted = true;
			});
		}

		// Overlay: play/pause
		this.$overlay.addEventListener('click', () => {
			if (!this._userInteracted) { this._userInteracted = true; this._ensureAudioOnUserPlay(); }
			else { this._ensureAudioOnUserPlay(); }
			if (this.$soundHint) this.$soundHint.classList.add('hide');
			const st = this._player?.getPlayerState?.();
			if (st === YT.PlayerState.PLAYING) this._player.pauseVideo(); else this._player.playVideo();
		});
		this.$overlay.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); this.$overlay.click(); } });

		// Botón pequeño play/pause
		this.$playBtn.addEventListener('click', () => {
			if (!this._userInteracted) { this._userInteracted = true; this._ensureAudioOnUserPlay(); }
			else { this._ensureAudioOnUserPlay(); }
			if (this.$soundHint) this.$soundHint.classList.add('hide');
			const st = this._player?.getPlayerState?.();
			if (st === YT.PlayerState.PLAYING) this._player.pauseVideo(); else this._player.playVideo();
		});

		// Botón IR AL VIVO: salta al borde en vivo (fin de la ventana DVR)
		if (this.$goLive) {
		  this.$goLive.addEventListener('click', (e) => {
			e.stopPropagation();
			this._ensureAudioOnUserPlay();
			try {
			  if (this._isLive && this._hasLiveDVR()) {
				const { end } = this._getDvrRange();
				const target = Math.max(0, end - 0.5); // pequeño offset para asegurar reproducción
				this._player.seekTo(target, true);
				this._player.playVideo();
				this._immediateUI(target);
			  }
			} catch(_) {}
		  });
		}

		// Seek con click
		this.$progress.addEventListener('click', (e) => {
      if ((this._isLive && !this._hasLiveDVR()) || this.$progress.classList.contains('disabled')) return;
      const rect = this.$progress.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.min(1, Math.max(0, x / rect.width));
      if (this._isLive && this._hasLiveDVR()) {
        const { start, end } = this._getDvrRange();
        const target = start + pct * (end - start);
        // Marcar interacción para que se considere "retrasado" si corresponde
        try { this._userInteracted = true; } catch(_) {}
        this._player.seekTo(target, true);
        this._ensureAudioOnUserPlay();
        try { this._player.playVideo(); } catch(_) {}
        this._immediateUI(target);
      } else {
        const effDur = (this._duration && this._duration > 0) ? this._duration : (this._player?.getCurrentTime?.() || 0);
        if (effDur > 0) {
          const target = effDur * pct;
          this._player.seekTo(target, true);
          this._ensureAudioOnUserPlay();
          try { this._player.playVideo(); } catch(_) {}
          this._immediateUI(target);
        }
      }
		});

		// Doble click: alternar fullscreen
		this.$overlay.addEventListener('dblclick', (e) => {
			e.preventDefault();
			this._toggleFullscreen();
			blinkControls();
		});
		this.$overlay.addEventListener('touchend', (e) => {
			const now = Date.now(); const dt = now - this._lastTap; this._lastTap = now;
      if (this._isLive && !this._hasLiveDVR()) return;
			if (dt < 300) {
				const touch = e.changedTouches[0]; const rect = this.$overlay.getBoundingClientRect();
				const x = touch.clientX - rect.left; const mid = rect.width / 2;
				let cur = this._player.getCurrentTime();
				if (this._isLive && this._hasLiveDVR()) {
				  const { start, end } = this._getDvrRange();
				  cur = Math.min(Math.max(cur, start), end);
				}
				const delta = x < mid ? -10 : 10;
				let target = Math.max(0, cur + delta);
				if (this._isLive && this._hasLiveDVR()) {
				  const { start, end } = this._getDvrRange();
				  target = Math.min(Math.max(target, start), end);
				  // Marcar interacción para que se considere "retrasado" si corresponde
				  try { this._userInteracted = true; } catch(_) {}
				}
				this._player.seekTo(target, true);
				this._ensureAudioOnUserPlay();
				try { this._player.playVideo(); } catch(_) {}
				this._immediateUI(target);
				blinkControls();
			}
		});

		// Volumen y fullscreen
		this.$vol.addEventListener('input', () => {
		  const v = parseInt(this.$vol.value, 10);
		  this._player.setVolume(v);
		  this._userMuted = (v === 0);
      if (this.$volToggle) this.$volToggle.classList.toggle('muted', this._userMuted);
		  if (v === 0) { try{ this._player.mute && this._player.mute(); }catch(_){} } else { try{ this._player.unMute && this._player.unMute(); }catch(_){} }
		});
    if (this.$volToggle) {
      this.$volToggle.addEventListener('click', () => {
        try {
          const cur = typeof this._player?.getVolume === 'function' ? this._player.getVolume() : 100;
          const isMuted = (this._player?.isMuted && this._player.isMuted()) || cur === 0 || (this.$vol && parseInt(this.$vol.value,10) === 0);
          if (isMuted) {
            this._player?.unMute?.();
            this._player?.setVolume?.(100);
            if (this.$vol) this.$vol.value = 100;
            this._userMuted = false;
          } else {
            this._player?.setVolume?.(0);
            this._player?.mute?.();
            if (this.$vol) this.$vol.value = 0;
            this._userMuted = true;
          }
          if (this.$volToggle) this.$volToggle.classList.toggle('muted', this._userMuted);
          this._userInteracted = true;
        } catch(_) {}
      });
    }
		this.$fs.addEventListener('click', () => {
			this._toggleFullscreen();
		});

		if (typeof document !== 'undefined') {
			this._handleKeydown = (e) => {
				if (e.key === 'Escape' || e.code === 'Escape') {
					if (this._getFullscreenElement()) this._exitFullscreen();
				}
			};
			document.addEventListener('keydown', this._handleKeydown);
		}

		// Context menu
		this.$wrap.addEventListener('contextmenu', e => e.preventDefault());

		// Controles de playlist: anterior/siguiente
		if (this.$prev && this.$next) {
  const s = this._playlist ? 'inline-flex' : 'none';
  this.$prev.style.display = s;
  this.$next.style.display = s;
}

		if (this.$prev) this.$prev.addEventListener('click', () => {
  if (!this.$prev.disabled) {
    try { this._player.previousVideo(); } catch(_) {}
  }
});
		if (this.$next) this.$next.addEventListener('click', () => {
  if (!this.$next.disabled) {
    try { this._player.nextVideo(); } catch(_) {}
  }
});
	}

	async _mountPlayer() {
		if (!this._video && !this._playlist) return;
		await window.__ytApiReadyPromise;
		const baseVars = { controls: 0, modestbranding: 1, rel: 0, disablekb: 1, fs: 0, playsinline: 1, iv_load_policy: 3, autoplay: this._autoplay ? 1 : 0 };
		const opts = { playerVars: baseVars };
		if (!this._playlist) {
			opts.videoId = this._video; // solo cuando NO es playlist
		}
		this._player = new YT.Player(this.$player, {
			...opts,
			events: {
				onReady: (e) => this._onReady(e),
				onStateChange: (e) => this._onStateChange(e),
				onError: (e) => this._onError(e)
			}
		});
	}

	_onReady(e) {
		if (e && e.target) this._player = e.target;
		if (this._player && typeof this._player.setVolume === 'function') {
			this._player.setVolume(parseInt(this.$vol.value, 10));
		}
		this._userMuted = this._autoplay || (parseInt(this.$vol.value,10) === 0);
    if (this.$volToggle) this.$volToggle.classList.toggle('muted', this._userMuted);
		if (this._autoplay) {
			try { if (this._player && typeof this._player.mute === 'function') this._player.mute(); } catch(_) {}
		}
		this._duration = (this._player && typeof this._player.getDuration === 'function') ? (this._player.getDuration() || 0) : 0;
		// Si es playlist, carga o deja en espera según autoplay
		if (this._playlist) {
			try {
				const payload = { listType: 'playlist', list: this._playlist, index: this._index };
				if (this._autoplay) {
					this._player.loadPlaylist(payload); // inicia solo
				} else {
					this._player.cuePlaylist(payload);  // queda listo sin reproducir
				}
			} catch(_) {}
		} else if (this._autoplay) {
			// Solo videos sueltos necesitan el play explícito
			try { if (this._player && typeof this._player.playVideo === 'function') this._player.playVideo(); } catch(_) {}
		}
			this._updateUI();
			this._setLiveUI(this._detectLive());
				if (this._startAtLast && this._playlist && typeof this._player.getPlaylist === 'function') {
					const tryJumpToLast = () => {
						const list = this._player.getPlaylist();
						if (Array.isArray(list) && list.length > 0) {
							const lastIdx = list.length - 1;
							try { this._player.playVideoAt(lastIdx); } catch(_) {}
							this._startAtLast = false;
						} else {
							// Reintentar hasta que la lista esté disponible
							setTimeout(tryJumpToLast, 100);
						}
					};
					tryJumpToLast();
				}
			this._updatePlaylistNav();
	}

	_onStateChange(e) {
		// Actualiza modo live por si cambia al cargar
		this._setLiveUI(this._detectLive());
		this._updateUI();
		if (e.data === YT.PlayerState.CUED && this._autoplay) {
			try { if (this._player && typeof this._player.playVideo === 'function') this._player.playVideo(); } catch(_) {}
		}
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
		this._updatePlaylistNav();
	}

	_updateUI() {
		if (!this._player || typeof this._player.getCurrentTime !== 'function') return;
		// Forzar la detección de LIVE en cada ciclo
		const isLiveNow = this._detectLive();
    const compactTime = (typeof window !== 'undefined' && window.matchMedia) ?
      (window.matchMedia('(max-width: 600px)').matches || window.matchMedia('(hover: none)').matches) : false;
		this._setLiveUI(isLiveNow);
		const t = this._player.getCurrentTime() || 0;
		// Actualizar duración previa SIEMPRE, incluso si es 0
		this._lastDuration = this._duration;
		this._duration = this._player.getDuration() || this._duration || 0;
		// Si es LIVE con DVR, extender duración dinámicamente
		if (isLiveNow && this._duration < t) this._duration = t;
		// Indicadores de LIVE y botón IR AL VIVO
		if (isLiveNow && !this._hasLiveDVR()) {
			if (this.$bar) this.$bar.style.width = '100%';
			if (this.$seek) this.$seek.style.left = '100%';
			if (this.$time) this.$time.textContent = compactTime ? this._fmt(t) : 'EN VIVO';
			if (this.$goLive) this.$goLive.style.display = 'none';
			if (!compactTime) return; // en desktop mantenemos comportamiento previo
		}
		// Cálculo de barra y seek
		let pct = 0;
		if (isLiveNow) {
			if (this._hasLiveDVR()) {
				const { start, end } = this._getDvrRange();
				const span = Math.max(1, end - start);
				const clamped = Math.min(Math.max(t, start), end);
				pct = (clamped - start) / span;
			} else {
				pct = 1;
			}
		} else {
			if (!this._duration || this._duration === 0) {
				this._duration = Math.max(this._duration, t);
			}
			pct = this._duration ? (t / this._duration) : 0;
		}
		// Mostrar/ocultar botón IR AL VIVO si estamos retrasados respecto al borde en vivo
		if (this.$goLive) {
			if (isLiveNow && this._hasLiveDVR()) {
				const { end } = this._getDvrRange();
				const lag = Math.max(0, end - t);
				// Mantener el botón visible si el usuario está retrasado más de 1 segundo
				// y ocultarlo solo si está realmente en el borde en vivo (menos de 0.5s)
				if (lag > 1) {
					this.$goLive.style.display = 'inline-flex';
				} else if (lag <= 0.5) {
					this.$goLive.style.display = 'none';
				}
				// Si está entre 0.5 y 1 segundo, mantener el estado anterior para evitar parpadeos
			} else {
				this.$goLive.style.display = 'none';
			}
		}
		this.$bar.style.width = (pct * 100) + '%';
		this.$seek.style.left = (pct * 100) + '%';
    if (compactTime) {
      this.$time.textContent = this._fmt(t);
    } else if (isLiveNow) {
      this.$time.textContent = `${this._fmt(t)} / EN VIVO`;
    } else {
      this.$time.textContent = `${this._fmt(t)} / ${this._fmt(this._duration)}`;
    }
	}

	_immediateUI(target) {
    if (this._isLive && !this._hasLiveDVR()) return;
    const compactTime = (typeof window !== 'undefined' && window.matchMedia) ?
      (window.matchMedia('(max-width: 600px)').matches || window.matchMedia('(hover: none)').matches) : false;
    let pct = 0;
    if (this._isLive && this._hasLiveDVR()) {
      const { start, end } = this._getDvrRange();
      const span = Math.max(1, end - start);
      const clamped = Math.min(Math.max(target, start), end);
      pct = (clamped - start) / span;
    } else {	
      if (this._isLive && (!this._duration || this._duration === 0)) {
        this._duration = Math.max(this._duration, target || 0);
      }
      pct = this._duration ? (target / this._duration) : 0;
    }
    this.$bar.style.width = (pct * 100) + '%';
    this.$seek.style.left = (pct * 100) + '%';
    if (compactTime) {
      this.$time.textContent = this._fmt(this._player?.getCurrentTime?.() || target || 0);
    } else if (this._isLive) {
      this.$time.textContent = `${this._fmt(this._player?.getCurrentTime?.() || target)} / EN VIVO`;
    } else {
      this.$time.textContent = `${this._fmt(target)} / ${this._fmt(this._duration)}`;
    }
    setTimeout(() => this._updateUI(), 120);
  }

	_startTimer() { if (!this._timer) this._timer = setInterval(() => this._updateUI(), 250); }
	_stopTimer() { clearInterval(this._timer); this._timer = null; }

	_fmt(s) {
		s = Math.max(0, Math.floor(s || 0));
		const sec = s % 60;
		const totalMin = Math.floor(s / 60);
		const min = totalMin % 60;
		const totalH = Math.floor(totalMin / 60);
		if (totalH === 0) {
			return `${String(totalMin).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; // MM:SS
		}
		const days = Math.floor(totalH / 24);
		const hours = totalH % 24;
		if (days === 0) {
			return `${totalH}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; // H:MM:SS
		}
		return `${days}d ${String(hours).padStart(2,'0')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; // Dd HH:MM:SS
	}

	_teardown() {
		try {
			if (typeof document !== 'undefined' && this._handleKeydown) {
				document.removeEventListener('keydown', this._handleKeydown);
				this._handleKeydown = null;
			}
			this._stopTimer();
			this._player && this._player.destroy && this._player.destroy();
		} catch (_) { }
	}

	_updatePlaylistNav() {
  if (!this._player || !this._playlist) {
    if (this.$prev) this.$prev.disabled = true;
    if (this.$next) this.$next.disabled = true;
    return;
  }
  let idx = 0;
  let len = 0;
  try {
    if (typeof this._player.getPlaylistIndex === 'function') {
      idx = this._player.getPlaylistIndex();
    }
    if (typeof this._player.getPlaylist === 'function') {
      const list = this._player.getPlaylist();
      if (Array.isArray(list)) len = list.length;
    }
  } catch(_) {}
  if (this.$prev) this.$prev.disabled = (idx <= 0);
  if (this.$next) this.$next.disabled = (len === 0 || idx >= len - 1);
}
}

customElements.define('lc-youtube', LCYouTube);
