"use client";
// @ts-nocheck
import React, {
  useState, useRef, useEffect, useCallback, useMemo
} from 'react';
import { useRouter } from 'next/navigation';
import { getAllDecryptedFormats } from '@/utils/innertubeDecipher';
import { getClientDirectStream, reportStreamSource } from '@/utils/clientStream';
import { fireEvent } from '@/utils/analytics';
import './VideoPlayer.css';

const VideoPlayer = ({ video, isTheaterMode, onTheaterModeToggle, isLoading }) => {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // ── Core State ──
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<{start: number; end: number}[]>([]);
  const [showControls, setShowControls] = useState(true);
  const [showIndicator, setShowIndicator] = useState(false);
  const [indicatorAction, setIndicatorAction] = useState<'play' | 'pause'>('play');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSubMenu, setSettingsSubMenu] = useState<null | 'quality' | 'speed' | 'captions'>('quality');
  const [selectedQuality, setSelectedQuality] = useState('auto');
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [captionsTrack, setCaptionsTrack] = useState<'off' | 'auto' | string>('off');
  const [showCaptions, setShowCaptions] = useState(false);
  const [showTheaterHint, setShowTheaterHint] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [isHoveringProgress, setIsHoveringProgress] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingStream, setLoadingStream] = useState(false);
  const [directQualities, setDirectQualities] = useState<Record<string, {url: string; type: string}>>({});
  const [playerConfig, setPlayerConfig] = useState<any>(null);

  // ── Refs ──
  const controlsTimeoutRef = useRef<NodeJS.Timeout>();
  const errorRetryCountRef = useRef(0);
  const poTokenRef = useRef<string>('');
  const visitorDataRef = useRef<string>('');
  const ytIdRef = useRef<string>('');
  const lastQualityRef = useRef<string>('auto');

  // ── YouTube ID ──
  const getYtId = useCallback(() => {
    return video?.youtube_id || video?.id || video?._id || '';
  }, [video]);

  // ── Ambient Mode ──
  const [ambientModeActive, setAmbientModeActive] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('aura_ambient_mode');
    return saved === 'true';
  });

  useEffect(() => {
    localStorage.setItem('aura_ambient_mode', String(ambientModeActive));
  }, [ambientModeActive]);

  // ── Network Quality Suggestion ──
  const getNetworkSuggestedQuality = useCallback(() => {
    if (typeof navigator === 'undefined' || !('connection' in navigator)) return '720p';
    const conn = (navigator as any).connection;
    if (!conn) return '720p';
    const downlink = conn.downlink || 10;
    if (downlink >= 10) return '1080p';
    if (downlink >= 5) return '720p';
    if (downlink >= 2) return '480p';
    return '360p';
  }, []);

  // ── Quality Validation ──
  const hasRealQualities = Object.keys(directQualities).length > 0;
  const isExtracting = loadingStream || !hasRealQualities;

  const qualityOptions = useMemo(() =>
    hasRealQualities
      ? ['auto', ...Object.keys(directQualities).sort((a, b) => {
          const ha = parseInt(a.replace('p', '')) || 0;
          const hb = parseInt(b.replace('p', '')) || 0;
          return hb - ha;
        })]
      : ['auto'],
  [hasRealQualities, directQualities]);

  const validatedQuality = hasRealQualities && directQualities[selectedQuality]
    ? selectedQuality
    : (hasRealQualities ? 'auto' : selectedQuality);

  const effectiveQuality = validatedQuality === 'auto'
    ? getNetworkSuggestedQuality()
    : validatedQuality;

  // ── Controls Visibility ──
  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    setShowControls(true);
    if (isPlaying && !videoRef.current?.paused) {
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      resetControlsTimeout();
      const handleMove = () => resetControlsTimeout();
      const handleLeave = () => { if (isPlaying) setShowControls(false); };
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseleave', handleLeave);
      return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseleave', handleLeave); };
    } else {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    }
  }, [isPlaying, resetControlsTimeout]);

  // ── Stream Resolution ──
  const resolveStream = useCallback(async (skipCache = false) => {
    const ytId = getYtId();
    if (!ytId) return;
    ytIdRef.current = ytId;

    try {
      setLoadingStream(true);
      setError(null);

      const [{ getMintedPoToken }, { getEmbedBootstrap }] = await Promise.all([
        import('@/utils/poTokenMint'),
        import('@/utils/youtubeDirect')
      ]);

      // Get poToken
      try {
        const minted = await getMintedPoToken(ytId);
        if (minted) poTokenRef.current = minted;
      } catch { /* ignore */ }

      // Get visitorData
      try {
        const boot = await getEmbedBootstrap(ytId);
        if (boot?.visitorData) visitorDataRef.current = boot.visitorData;
      } catch { /* ignore */ }

      // Direct stream extraction (Tier 0)
      const config = await getClientDirectStream(ytId, {
        quality: effectiveQuality,
        poToken: poTokenRef.current,
        visitorData: visitorDataRef.current,
        skipCache,
        client: 'ANDROID'
      });

      if (!config?.bestUrl) throw new Error('No playable URL');

      setPlayerConfig(config);
      setDirectQualities(config.qualityMap || {});
      reportStreamSource(ytId, config.source || 'direct', config.latencyMs || 0, true);

      // Select best quality
      const targetKey = validatedQuality === 'auto' ? getNetworkSuggestedQuality() : validatedQuality;
      const entry = config.qualityMap?.[targetKey] ||
                    config.qualityMap?.[Object.keys(config.qualityMap).pop() || ''];
      const urlToPlay = entry?.url || config.bestUrl;

      if (videoRef.current) {
        videoRef.current.src = urlToPlay;
        videoRef.current.load();
        await videoRef.current.play().catch(() => {});
        fireEvent('video_play', { videoId: ytId, quality: targetKey, source: config.source });
      }
    } catch (err: any) {
      console.error('[AuraPlayer] Stream error:', err);
      setError(err.message || 'Playback failed');
      reportStreamSource(ytId, 'error', 0, false);

      // Fallback to Tier 1 (Innertube Decipher)
      if (errorRetryCountRef.current < 2) {
        errorRetryCountRef.current++;
        try {
          const formats = await getAllDecryptedFormats(ytId, { quality: effectiveQuality });
          if (formats?.length) {
            const url = formats[0].url;
            if (videoRef.current) {
              videoRef.current.src = url;
              videoRef.current.load();
              await videoRef.current.play().catch(() => {});
            }
            return;
          }
        } catch { /* ignore */ }
      }

      // Final fallback: YouTube Embed
      if (videoRef.current) {
        videoRef.current.src = `https://www.youtube.com/embed/${ytId}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
      }
    } finally {
      setLoadingStream(false);
    }
  }, [getYtId, validatedQuality, effectiveQuality, getNetworkSuggestedQuality]);

  // ── Video Lifecycle ──
  useEffect(() => {
    if (!video) return;
    errorRetryCountRef.current = 0;
    resolveStream();
    return () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
    };
  }, [video, resolveStream]);

  // ── Video Event Handlers ──
  const handleLoadedMetadata = () => {
    if (videoRef.current) setDuration(videoRef.current.duration);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  };

  const handleProgress = () => {
    if (!videoRef.current) return;
    const ranges: {start: number; end: number}[] = [];
    for (let i = 0; i < videoRef.current.buffered.length; i++) {
      ranges.push({
        start: videoRef.current.buffered.start(i),
        end: videoRef.current.buffered.end(i)
      });
    }
    setBuffered(ranges);
  };

  const handleWaiting = () => { /* loading indicator handled by state */ };
  const handleCanPlay = () => { /* ready */ };
  const handleEnded = () => {
    setIsPlaying(false);
    fireEvent('video_complete', { videoId: getYtId() });
  };

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const mediaError = videoRef.current?.error;
    const msg = mediaError ? `Error code: ${mediaError.code}` : 'Playback error';
    setError(msg);
    console.error('[AuraPlayer] Video error:', mediaError);
  };

  // ── Control Handlers ──
  const handlePlayPause = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIndicatorAction('play');
      setShowIndicator(true);
      setTimeout(() => setShowIndicator(false), 600);
      fireEvent('video_pause', { videoId: getYtId(), time: currentTime });
    } else {
      videoRef.current.play().catch(() => {});
      setIndicatorAction('pause');
      setShowIndicator(true);
      setTimeout(() => setShowIndicator(false), 600);
      fireEvent('video_play', { videoId: getYtId(), time: currentTime, resumed: true });
    }
    setIsPlaying(!isPlaying);
    resetControlsTimeout();
  };

  const handleVolumeToggle = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
      fireEvent(isMuted ? 'volume_up' : 'volume_down', { videoId: getYtId() });
    }
    resetControlsTimeout();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = vol;
      videoRef.current.muted = vol === 0;
      setIsMuted(vol === 0);
    }
    setVolume(vol);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newTime = percent * duration;
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    fireEvent('video_seek', { videoId: getYtId(), time: newTime });
  };

  const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(percent * duration);
    setIsHoveringProgress(true);
  };

  const handleProgressLeave = () => {
    setIsHoveringProgress(false);
  };

  const handleFullscreen = () => {
    if (!videoRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoRef.current.parentElement?.requestFullscreen();
    }
    resetControlsTimeout();
  };

  const handleTheater = () => {
    onTheaterModeToggle?.();
    setShowTheaterHint(true);
    setTimeout(() => setShowTheaterHint(false), 1500);
    resetControlsTimeout();
  };

  const handlePiP = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setPipActive(false);
      } else {
        await videoRef.current.requestPictureInPicture();
        setPipActive(true);
      }
    } catch (err) {
      console.error('PiP error:', err);
    }
    resetControlsTimeout();
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    setShowSettings(false);
    fireEvent('speed_change', { videoId: getYtId(), speed });
    resetControlsTimeout();
  };

  const handleQualityChange = (quality: string) => {
    if (quality === selectedQuality) return;
    setSelectedQuality(quality);
    lastQualityRef.current = quality;
    resolveStream(true); // force refresh
    fireEvent('quality_change', { videoId: getYtId(), quality });
    resetControlsTimeout();
  };

  const handleCaptionsChange = (track: string) => {
    setCaptionsTrack(track);
    setShowCaptions(track !== 'off');
    setShowSettings(false);
    resetControlsTimeout();
  };

  const handleAmbientToggle = () => {
    setAmbientModeActive(prev => !prev);
    resetControlsTimeout();
  };

  const handleKeyboard = (e: KeyboardEvent) => {
    if (!videoRef.current) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault(); handlePlayPause(); break;
      case 'ArrowLeft':
        e.preventDefault(); videoRef.current.currentTime = Math.max(0, currentTime - 5); break;
      case 'ArrowRight':
        e.preventDefault(); videoRef.current.currentTime = Math.min(duration, currentTime + 5); break;
      case 'ArrowUp':
        e.preventDefault(); videoRef.current.volume = Math.min(1, volume + 0.1); setVolume(videoRef.current.volume); break;
      case 'ArrowDown':
        e.preventDefault(); videoRef.current.volume = Math.max(0, volume - 0.1); setVolume(videoRef.current.volume); break;
      case 'm':
        e.preventDefault(); handleVolumeToggle(); break;
      case 'f':
        e.preventDefault(); handleFullscreen(); break;
      case 't':
        e.preventDefault(); handleTheater(); break;
      case 'i':
        e.preventDefault(); handlePiP(); break;
      case 'c':
        e.preventDefault(); setShowCaptions(prev => !prev); break;
      case '>':
      case '.':
        e.preventDefault(); setPlaybackSpeed(prev => Math.min(2, prev + 0.25)); videoRef.current.playbackRate = Math.min(2, playbackSpeed + 0.25); break;
      case '<':
      case ',':
        e.preventDefault(); setPlaybackSpeed(prev => Math.max(0.25, prev - 0.25)); videoRef.current.playbackRate = Math.max(0.25, playbackSpeed - 0.25); break;
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [currentTime, duration, volume, playbackSpeed]);

  // ── Format Time ──
  const formatTime = (time: number) => {
    if (!isFinite(time)) return '--:--';
    const h = Math.floor(time / 3600);
    const m = Math.floor((time % 3600) / 60);
    const s = Math.floor(time % 60);
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Render ──
  if (!video) return <div className="aura-player-loading"><div className="aura-spinner-lg" /></div>;

  const ytId = getYtId();
  const isReady = videoRef.current?.readyState ?? 0 >= 1;

  return (
    <div className={`aura-video-player ${isTheaterMode ? 'theater' : ''} ${showControls ? 'show-controls' : ''} ${isPlaying ? 'playing' : 'paused'} ${ambientModeActive ? 'ambient' : ''} ${error ? 'has-error' : ''}`}>
      {/* ── Ambient Mode Background ── */}
      {ambientModeActive && videoRef.current && (
        <div className="aura-ambient-bg" aria-hidden="true">
          <canvas ref={useRef<HTMLCanvasElement>(null)} className="aura-ambient-canvas" />
        </div>
      )}

      {/* ── Main Video ── */}
      <div className="aura-video-container">
        <video
          ref={videoRef}
          className="aura-video-element"
          playsInline
          crossOrigin="anonymous"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onProgress={handleProgress}
          onWaiting={handleWaiting}
          onCanPlay={handleCanPlay}
          onEnded={handleEnded}
          onError={handleError}
          onClick={handlePlayPause}
          onDoubleClick={handleFullscreen}
          style={{ opacity: isReady ? 1 : 0 }}
        />

        {/* ── Loading Overlay ── */}
        {loadingStream && (
          <div className="aura-loading-overlay" aria-live="polite">
            <div className="aura-spinner" />
            <span className="aura-loading-text">
              {isExtracting ? 'Loading available qualities...' : 'Preparing stream...'}
            </span>
          </div>
        )}

        {/* ── Error Overlay ── */}
        {error && (
          <div className="aura-error-overlay" role="alert">
            <span className="material-symbols-outlined aura-error-icon">error_outline</span>
            <p className="aura-error-title">Playback failed</p>
            <p className="aura-error-message">{error}</p>
            <button className="aura-btn aura-btn-primary" onClick={() => resolveStream(true)}>
              <span className="material-symbols-outlined">refresh</span>
              Retry
            </button>
          </div>
        )}

        {/* ── Big Play Button ── */}
        {!isPlaying && !loadingStream && !error && (
          <button className="aura-big-play" onClick={handlePlayPause} aria-label="Play">
            <span className="material-symbols-outlined">play_arrow</span>
          </button>
        )}

        {/* ── Play/Pause Indicator ── */}
        {showIndicator && (
          <div className={`aura-indicator ${indicatorAction}`} aria-hidden="true">
            <span className="material-symbols-outlined">
              {indicatorAction === 'play' ? 'play_arrow' : 'pause'}
            </span>
          </div>
        )}
      </div>

      {/* ── Controls ── */}
      <div
        ref={controlsRef}
        className="aura-controls"
        onMouseEnter={() => resetControlsTimeout()}
        onMouseLeave={() => { if (isPlaying) setShowControls(false); }}
      >
        {/* Progress Bar */}
        <div className="aura-progress-wrapper" ref={progressRef} onClick={handleSeek} onMouseMove={handleProgressHover} onMouseLeave={handleProgressLeave}>
          <div className="aura-progress-track" role="slider" aria-label="Playback progress" aria-valuemin={0} aria-valuemax={Math.floor(duration)} aria-valuenow={Math.floor(currentTime)} tabIndex={0}>
            {/* Buffered */}
            {buffered.map((range, i) => (
              <div
                key={i}
                className="aura-progress-buffered"
                style={{ left: `${(range.start / duration) * 100}%`, width: `${((range.end - range.start) / duration) * 100}%` }}
              />
            ))}
            {/* Played */}
            <div
              className="aura-progress-played"
              style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
            >
              <div className="aura-progress-handle" aria-hidden="true" />
            </div>
            {/* Hover Preview */}
            {isHoveringProgress && duration && (
              <div className="aura-hover-preview" style={{ left: `${(hoverTime / duration) * 100}%` }}>
                <span className="aura-hover-time">{formatTime(hoverTime)}</span>
                <div className="aura-hover-thumb" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="aura-time-display">
            <span className="aura-current-time">{formatTime(currentTime)}</span>
            <span className="aura-duration"> / {formatTime(duration)}</span>
          </div>
        </div>

        {/* Main Controls Row */}
        <div className="aura-controls-main">
          {/* Left: Playback */}
          <div className="aura-controls-left">
            <button className="aura-control-btn" onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.max(0, currentTime - 10); fireEvent('seek_backward', { videoId: ytId }); }} aria-label="Rewind 10s">
              <span className="material-symbols-outlined">replay_10</span>
            </button>

            <button className={`aura-control-btn aura-play-btn ${isPlaying ? 'playing' : ''}`} onClick={handlePlayPause} aria-label={isPlaying ? 'Pause' : 'Play'}>
              <span className="material-symbols-outlined">{isPlaying ? 'pause' : 'play_arrow'}</span>
            </button>

            <button className="aura-control-btn" onClick={() => { const v = videoRef.current; if (v) v.currentTime = Math.min(duration, currentTime + 10); fireEvent('seek_forward', { videoId: ytId }); }} aria-label="Forward 10s">
              <span className="material-symbols-outlined">forward_10</span>
            </button>

            <div className="aura-control-divider" aria-hidden="true" />

            <button className={`aura-control-btn ${isMuted ? 'muted' : ''}`} onClick={handleVolumeToggle} aria-label={isMuted ? 'Unmute' : 'Mute'}>
              <span className="material-symbols-outlined">
                {isMuted || volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
              </span>
              <input
                type="range"
                className="aura-volume-slider"
                min="0" max="1" step="0.1"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
              />
            </button>
          </div>

          {/* Center: Time (redundant but accessible) */}
          <div className="aura-controls-center" aria-hidden="true">
            <span className="aura-time-display">
              <span className="aura-current-time">{formatTime(currentTime)}</span>
              <span className="aura-duration"> / {formatTime(duration)}</span>
            </span>
          </div>

          {/* Right: Settings, Theater, Fullscreen, PiP */}
          <div className="aura-controls-right">
            <div className="aura-control-divider" aria-hidden="true" />

            {/* Settings */}
            <div className="aura-settings">
              <button
                className={`aura-control-btn aura-settings-btn ${showSettings ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); setSettingsSubMenu(null); }}
                aria-label="Settings"
                aria-expanded={showSettings}
                aria-haspopup="true"
              >
                <span className="material-symbols-outlined">settings</span>
              </button>

              {/* Settings Panel */}
              {showSettings && (
                <div className="aura-settings-panel" role="menu">
                  {settingsSubMenu ? (
                    <>
                      {/* Submenu Header */}
                      <div className="aura-submenu-header">
                        <button className="aura-submenu-back" onClick={(e) => { e.stopPropagation(); setSettingsSubMenu(null); }} aria-label="Back to settings">
                          <span className="material-symbols-outlined">arrow_back</span>
                        </button>
                        <span className="aura-submenu-title">
                          {settingsSubMenu === 'quality' ? 'Quality' :
                           settingsSubMenu === 'speed' ? 'Playback speed' :
                           'Captions'}
                        </span>
                      </div>
                      <hr className="aura-settings-divider" />

                      {/* Quality Submenu */}
                      {settingsSubMenu === 'quality' && (
                        <div className="aura-submenu-content" role="menu">
                          {isExtracting ? (
                            <div className="aura-settings-loading">
                              <div className="aura-spinner" style={{width: 18, height: 18}} />
                              <span>Loading available qualities...</span>
                            </div>
                          ) : (
                            qualityOptions.map(opt => (
                              <button
                                key={opt}
                                className={`aura-submenu-item ${validatedQuality === opt ? 'active' : ''}`}
                                onClick={(e) => { e.stopPropagation(); handleQualityChange(opt); }}
                                disabled={opt !== 'auto' && !directQualities[opt]}
                                role="menuitemradio"
                                aria-checked={validatedQuality === opt}
                                aria-disabled={opt !== 'auto' && !directQualities[opt]}
                              >
                                <span className="aura-submenu-label">{opt.toUpperCase()}</span>
                                {validatedQuality === opt && <span className="material-symbols-outlined aura-check">check</span>}
                              </button>
                            ))
                          )}
                        </div>
                      )}

                      {/* Speed Submenu */}
                      {settingsSubMenu === 'speed' && (
                        <div className="aura-submenu-content" role="menu">
                          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(speed => (
                            <button
                              key={speed}
                              className={`aura-submenu-item ${playbackSpeed === speed ? 'active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); handleSpeedChange(speed); }}
                              role="menuitemradio"
                              aria-checked={playbackSpeed === speed}
                            >
                              <span className="aura-submenu-label">{speed}x</span>
                              {playbackSpeed === speed && <span className="material-symbols-outlined aura-check">check</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Captions Submenu */}
                      {settingsSubMenu === 'captions' && (
                        <div className="aura-submenu-content" role="menu">
                          {[
                            {value: 'off', label: 'Off'},
                            {value: 'auto', label: 'Auto-generated'},
                          ].map(opt => (
                            <button
                              key={opt.value}
                              className={`aura-submenu-item ${captionsTrack === opt.value ? 'active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); handleCaptionsChange(opt.value); }}
                              role="menuitemradio"
                              aria-checked={captionsTrack === opt.value}
                            >
                              <span className="aura-submenu-label">{opt.label}</span>
                              {captionsTrack === opt.value && <span className="material-symbols-outlined aura-check">check</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    /* Main Settings Menu */
                    <>
                      <button className="aura-settings-item" onClick={(e) => { e.stopPropagation(); setSettingsSubMenu('quality'); }} role="menuitem">
                        <span className="aura-settings-label">Quality</span>
                        <span className="aura-settings-value">{validatedQuality.toUpperCase()}</span>
                        <span className="material-symbols-outlined aura-settings-chevron">chevron_right</span>
                      </button>
                      <button className="aura-settings-item" onClick={(e) => { e.stopPropagation(); setSettingsSubMenu('speed'); }} role="menuitem">
                        <span className="aura-settings-label">Playback speed</span>
                        <span className="aura-settings-value">{playbackSpeed}x</span>
                        <span className="material-symbols-outlined aura-settings-chevron">chevron_right</span>
                      </button>
                      <button className="aura-settings-item" onClick={(e) => { e.stopPropagation(); setSettingsSubMenu('captions'); }} role="menuitem">
                        <span className="aura-settings-label">Captions</span>
                        <span className="aura-settings-value">{captionsTrack === 'off' ? 'Off' : captionsTrack === 'auto' ? 'Auto' : captionsTrack}</span>
                        <span className="material-symbols-outlined aura-settings-chevron">chevron_right</span>
                      </button>
                      <hr className="aura-settings-divider" />
                      <button className="aura-settings-item" onClick={(e) => { e.stopPropagation(); handleAmbientToggle(); setShowSettings(false); }} role="menuitem">
                        <span className="aura-settings-label">Ambient mode</span>
                        <span className={`aura-toggle ${ambientModeActive ? 'on' : ''}`} aria-hidden="true">
                          <span className="aura-toggle-thumb" />
                        </span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="aura-control-divider" aria-hidden="true" />

            {/* Theater */}
            <button className="aura-control-btn" onClick={handleTheater} aria-label={isTheaterMode ? 'Exit theater mode' : 'Theater mode'}>
              <span className="material-symbols-outlined">{isTheaterMode ? 'fullscreen_exit' : 'theater_comedy'}</span>
            </button>

            {/* PiP */}
            <button className="aura-control-btn" onClick={handlePiP} aria-label={pipActive ? 'Exit picture-in-picture' : 'Picture-in-picture'}>
              <span className="material-symbols-outlined">{pipActive ? 'picture_in_picture_alt' : 'picture_in_picture'}</span>
            </button>

            {/* Fullscreen */}
            <button className="aura-control-btn" onClick={handleFullscreen} aria-label={document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'}>
              <span className="material-symbols-outlined">{document.fullscreenElement ? 'fullscreen_exit' : 'fullscreen'}</span>
            </button>

            {/* Open in YouTube */}
            {ytId && (
              <a
                href={`https://www.youtube.com/watch?v=${ytId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="aura-youtube-link"
                aria-label="Open in YouTube"
              >
                <span className="material-symbols-outlined">open_in_new</span>
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Theater Hint Toast */}
      {showTheaterHint && (
        <div className="aura-toast" aria-live="polite">
          <span className="material-symbols-outlined">{isTheaterMode ? 'theater_comedy' : 'fullscreen_exit'}</span>
          <span>{isTheaterMode ? 'Theater mode on' : 'Theater mode off'}</span>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;