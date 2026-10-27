"use client";
// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { processFormatUrl } from '@/utils/decipher';
import { getAllDecryptedFormats } from '@/utils/innertubeDecipher';
import { getClientDirectStream, reportStreamSource } from '@/utils/clientStream';
import { fireEvent } from '@/utils/analytics';
import './VideoPlayer.css';

const VideoPlayer = ({ video, isTheaterMode, onTheaterModeToggle, isLoading }) => {
  const router = useRouter();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showIndicator, setShowIndicator] = useState(false);
  const [indicatorAction, setIndicatorAction] = useState('play'); // 'play' | 'pause'

  // Ambient Mode State & Canvas Ref
  const [ambientModeActive, setAmbientModeActive] = useState(() => {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('yt_ambient_mode');
    return saved !== null ? saved === 'true' : true;
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Timeline Hover tooltip
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);

  // Shortcuts Overlay State
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Dynamic UI Action Feedback overlay state
  const [feedbackOverlay, setFeedbackOverlay] = useState<{ text: string; icon: string } | null>(null);
  const feedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerFeedback = (text: string, icon: string) => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    setFeedbackOverlay({ text, icon });
    feedbackTimeoutRef.current = setTimeout(() => {
      setFeedbackOverlay(null);
    }, 800);
  };

  const handleAmbientModeToggle = () => {
    const next = !ambientModeActive;
    setAmbientModeActive(next);
    localStorage.setItem('yt_ambient_mode', String(next));
    triggerFeedback(next ? 'Ambient Glow On' : 'Ambient Glow Off', next ? 'volume_up' : 'volume_off');
  };

  // Picture-in-Picture check
  const [isPiPSupported, setIsPiPSupported] = useState(false);
  useEffect(() => {
    setIsPiPSupported(
      typeof document !== 'undefined' && 
      document.pictureInPictureEnabled
    );
  }, []);

  // Sync ambient glow frame canvas
  useEffect(() => {
    let animationFrameId: number;
    let lastDrawTime = 0;
    const interval = 100; // 10fps

    const updateAmbientGlow = (now: number) => {
      if (!ambientModeActive || !isPlaying || !videoRef.current || !canvasRef.current) {
        animationFrameId = requestAnimationFrame(updateAmbientGlow);
        return;
      }

      if (now - lastDrawTime >= interval) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx && video.readyState >= 2) {
          try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            lastDrawTime = now;
          } catch (err) {
            // Ignore temporary draw errors
          }
        }
      }
      animationFrameId = requestAnimationFrame(updateAmbientGlow);
    };

    if (ambientModeActive && isPlaying) {
      animationFrameId = requestAnimationFrame(updateAmbientGlow);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [ambientModeActive, isPlaying]);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (showIndicator) {
      const timer = setTimeout(() => setShowIndicator(false), 700);
      return () => clearTimeout(timer);
    }
  }, [showIndicator]);
  const [prevVolume, setPrevVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [bufferedProgress, setBufferedProgress] = useState(0);
  const [selectedQuality, setSelectedQuality] = useState('auto');
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  
  // Controls visibility & settings menu states
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSubMenu, setSettingsSubMenu] = useState(null); // 'speed' | 'quality' | null
  const [isCCActive, setIsCCActive] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Signature Offloading States
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [loadingStream, setLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [isEnded, setIsEnded] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const errorRetryCountRef = useRef(0); // one fresh extraction, then iframe

  // Real-time PO Token and Visitor Data states synced with the iframe
  const [poToken, setPoToken] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.youtubePoToken || localStorage.getItem('youtube_po_token') || '';
  });
  const [visitorData, setVisitorData] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.youtubeVisitorData || localStorage.getItem('youtube_visitor_data') || '';
  });

  // Direct CDN stream qualities
  const [directQualities, setDirectQualities] = useState({});
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState('');

  useEffect(() => {
    const handleMessage = (e) => {
      if (e.data && e.data.type === 'YOUTUBE_PO_TOKEN') {
        const { poToken: newToken, visitorData: newVisitor } = e.data;
        console.log('[VideoPlayer] Received new tokens from iframe:', {
          poToken: newToken.substring(0, 15) + '...',
          visitorData: newVisitor
        });
        setPoToken(newToken);
        setVisitorData(newVisitor);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const playerConfigCacheRef = useRef(null); // { videoId: '', config: null }
  const decryptedUrlsCacheRef = useRef({}); // { quality: 'decryptedUrl' }

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const isFirstRender = useRef(true);

  // ── Personalization signal tracking ─────────────────────────────
  const watchMilestonesRef = useRef(new Set()); // 25/50/75/90 — ek baar hi fire
  const lastWatchPctRef = useRef(0);            // unmount pe skip detect karne ko
  const watchEndedRef = useRef(false);
  const stallTimerRef = useRef<NodeJS.Timeout | null>(null);       // stall auto-downgrade timer
  const stallDowngradedRef = useRef(false);                        // downgrade only ONCE per video

  const currentVideoId = video ? String(video.id || video.youtube_id || video.videoUrl || '') : '';

  // Pick a safe starting quality based on the browser's network hint.
  // On flaky connections YouTube starts lower and upgrades — starting
  // at 720p on a 1-2Mbps hotspot guarantees rebuffer churn. (2026-08)
  // ⚠️ Component-scope (NOT inside resolveStream): the stall auto-downgrade
  // onWaiting handler calls this too — inside the effect it threw
  // `getNetworkSuggestedQuality is not defined` and silently broke the
  // 1s play / 1s loader downgrade. (2026-08)
  const getNetworkSuggestedQuality = (): string => {
    try {
      const conn = (navigator as any).connection as { effectiveType?: string } | undefined;
      if (!conn || !conn.effectiveType) return '720p';
      switch (conn.effectiveType) {
        case 'slow-2g':
        case '2g':
          return '240p';
        case '3g':
          return '360p';
        default:
          return '720p';
      }
} catch {
        return '720p';
      }
  };

  // 2026-08-13 FIX: Tier 0 extraction (PO-token mint ~5s + player call)
  // takes longer on slow links than the old hardcoded 4s race allowed,
  // so Tier 0 always timed out and burned server bandwidth via the
  // proxy. Give extraction one deadline per network speed (component
  // scope, same reason as getNetworkSuggestedQuality).
  // 2026-08-13 v2: measured in-browser — ANDROID_VR+pot extraction
  // completes ~8s on a warm cache, ~12-15s cold. The old 6s (4g)
  // deadline timed out EVERY extraction, then the finished config
  // was thrown away and the proxy played. The race is only a guard
  // against a hung network call now, not the primary timer.
  // 2026-08-14 v3: player-bootstrap can 502 on the first cold hit and
  // retry after ~5s, pushing extraction past 15s even on 4g. Deadline
  // raised; and the resolveStream fallback now KEEPS the pending
  // extraction and upgrades the src to the direct CDN URL the moment
  // it finishes (proxy still plays while we wait — no blank screen).
  const getStreamDeadline = (): number => {
    try {
      const conn = (navigator as any).connection as { effectiveType?: string } | undefined;
      const eff = conn?.effectiveType || '4g';
      // 2026-08-15: prewarm ab home pe hi URLs cache kar deta hai, aur
      // resolveStream fallback pending extraction ko late-upgrade karta
      // hai — isliye cold deadline short rakhna safe hai (proxy pehle
      // chalta hai, CDN turant upgrade hota hai jab ready ho).
      if (eff === 'slow-2g' || eff === '2g') return 18000;
      if (eff === '3g') return 14000;
      return 10000;
    } catch {
      return 10000;
    }
  };

  // Naya video aaya → signal state reset
  useEffect(() => {
    watchMilestonesRef.current = new Set();
    lastWatchPctRef.current = 0;
    watchEndedRef.current = false;
  }, [currentVideoId]);

  // Video chhoda (page close / next video) — <20% pehle chhoda = skip signal
  useEffect(() => {
    return () => {
      if (!currentVideoId) return;
      const pct = lastWatchPctRef.current;
      if (!watchEndedRef.current && pct > 0 && pct < 20) {
        fireEvent('skip', currentVideoId, { percent: pct });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVideoId]);

  // Helper to extract YouTube ID
  const getYoutubeId = (vid) => {
    if (!vid) return null;
    if (vid.storageLocation === 'Local') return null; // Force local streaming
    if (vid.youtube_id) return vid.youtube_id;
    if (vid.videoUrl) {
      try {
        const url = new URL(vid.videoUrl);
        if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
          return url.searchParams.get('v') || url.pathname.split('/').pop();
        }
      } catch (e) {
        // Fallback for relative/partial URLs
        const match = vid.videoUrl.match(/(?:embed\/|v\/|v=)([a-zA-Z0-9_-]{11})/);
        if (match) return match[1];
        
        const parts = vid.videoUrl.split('/');
        const lastPart = parts[parts.length - 1];
        if (lastPart && lastPart.length === 11) return lastPart;
      }
    }
    return null;
  };

  // Render-time YouTube ID (used by the iframe fallback).
  const ytId = getYoutubeId(video);

  // Sync state if video changes
  useEffect(() => {
    setIsPlaying(false);
    setIsEnded(false);
    setCurrentTime(0);
    setProgress(0);
    setBufferedProgress(0);
    setHasError(false);
    setSelectedQuality('auto');
    setPlaybackSpeed(1);
    setSettingsOpen(false);
    setSettingsSubMenu(null);
    isFirstRender.current = true;
    playerConfigCacheRef.current = null;
    decryptedUrlsCacheRef.current = {};
    errorRetryCountRef.current = 0; // reset error retry on video change
    setRetryTick(0);
    stallDowngradedRef.current = false;
    if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
    setDirectQualities({});
    setResolvedAudioUrl('');
  }, [video]);

  // Resolve stream URL for YouTube videos or other media.
  // ALL YouTube work happens on the device. The Render backend is never
  // asked to fetch a player response, base.js, or video bytes.
  useEffect(() => {
    let active = true;

    const withTimeout = (promise, ms, label) =>
      Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), ms))
      ]);

    const resolveStream = async () => {
      if (!video) {
        setResolvedUrl('');
        setResolvedAudioUrl('');
        setLoadingStream(false);
        return;
      }

      const ytId = getYoutubeId(video);

      // Non-YouTube (local upload / Drive) keeps the normal source.
      if (!ytId) {
        setResolvedUrl(getVideoSrc());
        setResolvedAudioUrl('');
        setStreamError(null);
        setHasError(false);
        setLoadingStream(false);
        return;
      }

      setLoadingStream(true);
      setStreamError(null);
      setHasError(false);
      setResolvedUrl('');
      setResolvedAudioUrl('');

      const effectiveQuality = selectedQuality === 'auto'
        ? getNetworkSuggestedQuality()
        : selectedQuality;
      const skipCache = errorRetryCountRef.current > 0;

      // One content-bound poToken + visitorData for every tier.
      let activePoToken = poToken;
      let activeVisitorData = visitorData;

      try {
        const [{ getMintedPoToken }, { getEmbedBootstrap }] = await Promise.all([
          import('@/utils/poTokenMint'),
          import('@/utils/youtubeDirect')
        ]);

        try {
          const minted = await withTimeout(getMintedPoToken(ytId), 20000, 'poToken');
          if (minted) activePoToken = minted;
        } catch (tokenErr: any) {
          console.warn('[VideoPlayer] poToken unavailable:', tokenErr.message);
        }

        try {
          const boot = await getEmbedBootstrap(ytId);
          if (boot?.visitorData) activeVisitorData = boot.visitorData;
        } catch {
          // visitorData is optional
        }
      } catch (prepErr: any) {
        console.warn('[VideoPlayer] direct prep failed:', prepErr.message);
      }

      const commitConfig = (config: any, source: string) => {
        if (!active || !config?.bestUrl) return false;

        playerConfigCacheRef.current = config;
        setDirectQualities(config.qualityMap || {});

        const targetKey = selectedQuality === 'auto'
          ? getNetworkSuggestedQuality()
          : selectedQuality;
        const entry = config.qualityMap?.[targetKey];
        const fallbackEntry = Object.values(config.qualityMap || {}).find(
          (e: any) => e && e.url === config.bestUrl
        );
        const chosen: any = entry || fallbackEntry;

        const url = chosen?.url || config.bestUrl;
        const bestIsCombined = Object.values(config.qualityMap || {}).some(
          (e: any) => e && e.url === config.bestUrl && e.type === 'combined'
        );
        const audioUrl = (chosen?.type === 'video_only' || (!chosen && !bestIsCombined))
          ? (config.audioOnlyFormats?.[0]?.url || '')
          : '';

        console.log(`[VideoPlayer] ${source} stream resolved (${config.bestQuality || 'auto'}):`, String(url).substring(0, 90));
        reportStreamSource(ytId, source);
        setResolvedUrl(url);
        setResolvedAudioUrl(audioUrl);
        return true;
      };

      try {
        // ── Cached config (only from this session, same video) ──
        const cached = playerConfigCacheRef.current;
        if (cached?.bestUrl && !skipCache) {
          commitConfig(cached, 'client-cache');
          return;
        }

        // ── TIER 0: player JSON direct from the device ──
        try {
          console.log('[VideoPlayer] Tier 0: direct player API from device IP...');
          const direct = await getClientDirectStream(ytId, effectiveQuality, {
            poToken: activePoToken,
            visitorData: activeVisitorData,
            skipCache,
            deadlineMs: 30000
          });
          if (direct?.bestUrl) {
            if (direct.poToken) activePoToken = direct.poToken;
            if (direct.visitorData) activeVisitorData = direct.visitorData;
            if (commitConfig(direct, direct.source === 'client-cache' ? 'client-cache' : 'client')) {
              return;
            }
          }
        } catch (tier0Err: any) {
          console.warn('[VideoPlayer] Tier 0 failed:', tier0Err.message);
        }

        // ── TIER 1: youtubei.js, dynamic import, direct www.youtube.com ──
        try {
          console.log('[VideoPlayer] Tier 1: youtubei.js direct...');
          const res = await withTimeout(
            getAllDecryptedFormats(ytId, activePoToken, activeVisitorData),
            25000,
            'youtubei.js'
          );
          if (res?.bestUrl) {
            const config = {
              bestUrl: res.bestUrl,
              bestQuality: res.bestQuality,
              qualityMap: res.fullQualityMap || {},
              audioOnlyFormats: res.audioUrl ? [{ url: res.audioUrl }] : []
            };
            if (commitConfig(config, 'ytjs')) return;
          }
        } catch (tier1Err: any) {
          console.warn('[VideoPlayer] Tier 1 failed:', tier1Err.message);
        }

        // ── TIER 2: embed page + base.js, both fetched direct ──
        try {
          console.log('[VideoPlayer] Tier 2: manual base.js decipher (direct fetch)...');
          const { getEmbedBootstrap, getBaseJs, youtubePlayerRequest } = await import('@/utils/youtubeDirect');
          const boot = await getEmbedBootstrap(ytId);
          if (!boot?.jsUrl) throw new Error('No base.js URL from embed page');

          const jsContent = await getBaseJs(boot.jsUrl);
          const sts = boot.sts || 19999;

          const makeBody = (clientName: string, clientVersion: string, extra: any = {}) => {
            const body: any = {
              context: {
                client: {
                  hl: 'en',
                  gl: 'IN',
                  clientName,
                  clientVersion,
                  ...extra
                }
              },
              videoId: ytId,
              playbackContext: {
                contentPlaybackContext: {
                  signatureTimestamp: sts,
                  html5Preference: 'HTML5_PREF_WANTS'
                }
              },
              racyCheckOk: true,
              contentCheckOk: true
            };
            if (activeVisitorData) body.context.client.visitorData = activeVisitorData;
            if (activePoToken) body.serviceIntegrityDimensions = { poToken: activePoToken };
            return body;
          };

          let playerConfig: any = null;
          for (const attempt of [
            { name: 'WEB_EMBEDDED_PLAYER', version: '2.20240101.01.00', extra: { clientScreen: 'EMBED' } },
            { name: 'WEB', version: '2.20260629.10.00', extra: { originalUrl: `https://www.youtube.com/watch?v=${ytId}` } }
          ]) {
            try {
              const data = await youtubePlayerRequest({
                body: makeBody(attempt.name, attempt.version, attempt.extra),
                clientName: attempt.name,
                clientVersion: attempt.version,
                videoId: ytId
              });
              if (data?.playabilityStatus?.status === 'OK' && data.streamingData) {
                playerConfig = data;
                break;
              }
              console.warn(`[VideoPlayer] Tier 2 ${attempt.name} status: ${data?.playabilityStatus?.status || 'UNKNOWN'}`);
            } catch (attemptErr: any) {
              console.warn(`[VideoPlayer] Tier 2 ${attempt.name} failed:`, attemptErr.message);
            }
          }

          if (!playerConfig?.streamingData) throw new Error('No streamingData from WEB clients');

          const streamingData = playerConfig.streamingData;
          const rawFormats = [
            ...(streamingData.formats || []).map((f: any) => ({ ...f, _type: 'combined' })),
            ...(streamingData.adaptiveFormats || []).map((f: any) => {
              const isVideo = String(f.mimeType || '').startsWith('video/');
              const isAudio = String(f.mimeType || '').startsWith('audio/');
              return { ...f, _type: isVideo ? 'video_only' : isAudio ? 'audio_only' : 'other' };
            })
          ];

          const hasH264 = rawFormats.some((f: any) => f._type === 'video_only' && String(f.mimeType || '').includes('avc1'));
          const hasAac = rawFormats.some((f: any) => f._type === 'audio_only' && String(f.mimeType || '').includes('mp4a'));
          const allFormats = rawFormats.filter((f: any) => {
            if (f._type === 'video_only') return !hasH264 || String(f.mimeType || '').includes('avc1');
            if (f._type === 'audio_only') return !hasAac || String(f.mimeType || '').includes('mp4a');
            return true;
          });

          const fullQualityMap: Record<string, { url: string; type: string }> = {};
          let bestUrl: string | null = null;
          let bestQuality: string | null = null;
          let audioUrl = '';

          for (const f of allFormats) {
            if (f._type === 'other') continue;
            const url = await processFormatUrl(f, jsContent);
            if (!url) continue;
            const height = f.height || 0;
            const label = height ? `${height}p` : 'auto';

            if (f._type === 'combined') {
              if (!bestUrl) {
                bestUrl = url;
                bestQuality = label;
              }
              if (!fullQualityMap[label]) fullQualityMap[label] = { url, type: 'combined' };
            } else if (f._type === 'video_only') {
              if (!fullQualityMap[label] || fullQualityMap[label].type !== 'combined') {
                fullQualityMap[label] = { url, type: 'video_only' };
              }
              if (!bestUrl) {
                bestUrl = url;
                bestQuality = label;
              }
            } else if (f._type === 'audio_only' && !audioUrl) {
              audioUrl = url;
            }
          }

          if (!bestUrl && Object.keys(fullQualityMap).length) {
            const first = Object.values(fullQualityMap)[0];
            bestUrl = first.url;
          }
          if (!bestUrl) throw new Error('Manual decipher produced no URLs');

          const config = {
            bestUrl,
            bestQuality,
            qualityMap: fullQualityMap,
            audioOnlyFormats: audioUrl ? [{ url: audioUrl }] : []
          };
          if (commitConfig(config, 'decipher')) return;
        } catch (tier2Err: any) {
          console.warn('[VideoPlayer] Tier 2 failed:', tier2Err.message);
        }

        // All direct tiers failed → official YouTube iframe (no proxy).
        if (active) {
          setStreamError('Direct playback unavailable');
          setHasError(true);
        }
      } finally {
        if (active) setLoadingStream(false);
      }
    };

    resolveStream();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, selectedQuality, poToken, visitorData, retryTick]);

  // Handle source changes (either new video or new resolution/quality)
  useEffect(() => {
    if (videoRef.current && resolvedUrl) {
      setIsEnded(false);
      const time = currentTime;

      videoRef.current.load();
      
      const playVideo = () => {
        if (time > 0) {
          videoRef.current.currentTime = time;
          if (audioRef.current) {
            audioRef.current.currentTime = time;
          }
        }
        videoRef.current.playbackRate = playbackSpeed;
        if (audioRef.current) {
          audioRef.current.playbackRate = playbackSpeed;
        }
        
        videoRef.current.play()
          .then(() => {
            setIsPlaying(true);
            if (audioRef.current && audioRef.current.paused) {
              audioRef.current.play().catch(e => console.log(e.message));
            }
          })
          .catch((err) => {
            console.log('Autoplay prevented on mobile, falling back to muted autoplay:', err.message);
            if (videoRef.current) {
              videoRef.current.muted = true;
              setIsMuted(true);
              videoRef.current.play().then(() => {
                setIsPlaying(true);
              }).catch(() => {});
            }
          });
      };
      playVideo();
    }
  }, [resolvedUrl]);

  // Log final stream source once per URL change (not on every render)
  useEffect(() => {
    if (resolvedUrl) {
      console.log('[VideoPlayer] FINAL VIDEO SRC:', resolvedUrl.substring(0, 80) + '...');
    }
  }, [resolvedUrl]);

  // Handle speed changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackSpeed;
    }
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Sync audio settings when volume, mute, or audio stream changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [volume, isMuted, playbackSpeed, resolvedAudioUrl]);

  // Sync audio currentTime and state when resolvedAudioUrl changes
  useEffect(() => {
    if (audioRef.current && videoRef.current) {
      audioRef.current.currentTime = videoRef.current.currentTime;
      if (!videoRef.current.paused) {
        audioRef.current.play().catch(e => console.log('[VideoPlayer] Audio autoplay on src change failed:', e.message));
      } else {
        audioRef.current.pause();
      }
    }
  }, [resolvedAudioUrl]);

  // Keyboard shortcut listener to sync controls overlay states
  useEffect(() => {
    if (videoRef.current) {
      const handlePlayEvent = () => setIsPlaying(true);
      const handlePauseEvent = () => setIsPlaying(false);
      const handleVolumeChange = () => {
        if (videoRef.current) {
          setIsMuted(videoRef.current.muted);
          setVolume(videoRef.current.muted ? 0 : videoRef.current.volume);
        }
      };

      const el = videoRef.current;
      el.addEventListener('play', handlePlayEvent);
      el.addEventListener('pause', handlePauseEvent);
      el.addEventListener('volumechange', handleVolumeChange);

      return () => {
        el.removeEventListener('play', handlePlayEvent);
        el.removeEventListener('pause', handlePauseEvent);
        el.removeEventListener('volumechange', handleVolumeChange);
      };
    }
  }, [video]);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events in input, textarea, or contentEditable elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();

      if (key === 'k' || e.key === ' ') {
        e.preventDefault();
        handlePlayPause();
      } else if (key === 'm') {
        e.preventDefault();
        if (videoRef.current) {
          const nextMuted = !videoRef.current.muted;
          videoRef.current.muted = nextMuted;
          setIsMuted(nextMuted);
          if (nextMuted) {
            setPrevVolume(volume);
            setVolume(0);
            triggerFeedback('Muted', 'volume_off');
          } else {
            const nextVol = prevVolume || 0.8;
            setVolume(nextVol);
            videoRef.current.volume = nextVol;
            triggerFeedback(`${Math.round(nextVol * 100)}%`, 'volume_up');
          }
          resetControlsTimeout();
        }
      } else if (key === 'f') {
        e.preventDefault();
        if (containerRef.current) {
          if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
          resetControlsTimeout();
        }
      } else if (key === 't') {
        e.preventDefault();
        onTheaterModeToggle();
        triggerFeedback(isTheaterMode ? 'Default View' : 'Theater Mode', 'fullscreen');
      } else if (key === 'p') {
        e.preventDefault();
        if (videoRef.current) {
          if (document.pictureInPictureElement) {
            document.exitPictureInPicture()
              .then(() => triggerFeedback('PiP Closed', 'picture_in_picture'))
              .catch(() => {});
          } else {
            videoRef.current.requestPictureInPicture()
              .then(() => triggerFeedback('PiP Active', 'picture_in_picture'))
              .catch(() => {});
          }
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (videoRef.current && duration > 0) {
          videoRef.current.currentTime = Math.min(videoRef.current.currentTime + 5, duration);
          if (audioRef.current) audioRef.current.currentTime = videoRef.current.currentTime;
          triggerFeedback('+5s', 'forward');
          resetControlsTimeout();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (videoRef.current && duration > 0) {
          videoRef.current.currentTime = Math.max(videoRef.current.currentTime - 5, 0);
          if (audioRef.current) audioRef.current.currentTime = videoRef.current.currentTime;
          triggerFeedback('-5s', 'backward');
          resetControlsTimeout();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (videoRef.current) {
          const newVol = Math.min(videoRef.current.volume + 0.05, 1);
          videoRef.current.volume = newVol;
          setVolume(newVol);
          setIsMuted(newVol === 0);
          videoRef.current.muted = newVol === 0;
          triggerFeedback(`${Math.round(newVol * 100)}%`, 'volume_up');
          resetControlsTimeout();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (videoRef.current) {
          const newVol = Math.max(videoRef.current.volume - 0.05, 0);
          videoRef.current.volume = newVol;
          setVolume(newVol);
          setIsMuted(newVol === 0);
          videoRef.current.muted = newVol === 0;
          triggerFeedback(`${Math.round(newVol * 100)}%`, newVol === 0 ? 'volume_off' : 'volume_down');
          resetControlsTimeout();
        }
      } else if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, isMuted, volume, prevVolume, duration, onTheaterModeToggle, isTheaterMode]);

  // Hide controls after 3 seconds of mouse inactivity
  const resetControlsTimeout = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying && !settingsOpen) {
      controlsTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  };

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying, settingsOpen]);

  const handleMouseMove = () => {
    resetControlsTimeout();
  };

  const handleMouseLeave = () => {
    if (isPlaying && !settingsOpen) {
      setControlsVisible(false);
    }
  };

  const handlePlayPause = () => {
    if (hasError) return;
    if (!videoRef.current) return;
    if (isEnded) {
      handleReplay();
      return;
    }

    const nextPlaying = !isPlaying;
    setIndicatorAction(nextPlaying ? 'play' : 'pause');
    setShowIndicator(false);
    setTimeout(() => {
      setShowIndicator(true);
    }, 10);

    if (isPlaying) {
      videoRef.current.pause();
      triggerFeedback('Pause', 'pause');
    } else {
      videoRef.current.play()
        .then(() => {
          setIsPlaying(true);
          setIsEnded(false);
          triggerFeedback('Play', 'play');
        })
        .catch(err => console.error("Video play error:", err));
    }
    resetControlsTimeout();
  };

  

  const handleReplay = (e) => {
    if (e) e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
      setIsEnded(false);
      videoRef.current.play()
        .then(() => {
          setIsPlaying(true);
          if (audioRef.current && audioRef.current.paused) {
            audioRef.current.play().catch(err => console.error("Audio play error on replay:", err));
          }
        })
        .catch(err => console.error("Error replaying video:", err));
    }
  };

  const handleMuteToggle = (e) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    if (nextMuted) {
      setPrevVolume(volume);
      setVolume(0);
    } else {
      setVolume(prevVolume || 0.8);
      videoRef.current.volume = prevVolume || 0.8;
    }
    resetControlsTimeout();
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
    setIsMuted(val === 0);
    resetControlsTimeout();
  };

  const handleFullscreen = (e) => {
    e.stopPropagation();
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
    resetControlsTimeout();
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const current = videoRef.current.currentTime;
    const dur = videoRef.current.duration || 0;
    setCurrentTime(current);
    setDuration(dur);

    // Sync audio track playback time
    if (audioRef.current) {
      const diff = Math.abs(audioRef.current.currentTime - current);
      if (diff > 0.15) {
        audioRef.current.currentTime = current;
      }
    }

    if (dur > 0) {
      const pct = (current / dur) * 100;
      setProgress(pct);
      lastWatchPctRef.current = pct;

      // Watch milestones fire once each → feeding the recommendation engine
      const milestones = watchMilestonesRef.current;
      const fireMilestone = (m) => {
        if (pct >= m && !milestones.has(m)) {
          milestones.add(m);
          fireEvent('watch', currentVideoId, { percent: m });
        }
      };
      fireMilestone(25);
      fireMilestone(50);
      fireMilestone(75);
      fireMilestone(90);
      
      // Calculate buffered timeline progress
      if (videoRef.current.buffered.length > 0) {
        try {
          const bufferedEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
          setBufferedProgress((bufferedEnd / dur) * 100);
        } catch (err) {
          // ignore index errors
        }
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration || 0);
    setHasError(false);
  };

const handleError = () => {
    if (!video) return;
    const ytId = getYoutubeId(video);
    if (!ytId) {
      setHasError(true);
      return;
    }

    // One fresh device-side extraction, then the official iframe.
    if (errorRetryCountRef.current === 0) {
      errorRetryCountRef.current = 1;
      console.warn('[VideoPlayer] Direct CDN playback failed - re-extracting once from device...');
      playerConfigCacheRef.current = null;
      setResolvedUrl('');
      setResolvedAudioUrl('');
      setHasError(false);
      setRetryTick((t) => t + 1);
      return;
    }

    console.warn('[VideoPlayer] Direct playback failed twice - showing official YouTube iframe.');
    setHasError(true);
  };

  const handleProgressClick = (e) => {
    e.stopPropagation();
    if (!videoRef.current || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const clickedPercentage = clickX / width;
    
    videoRef.current.currentTime = clickedPercentage * duration;
    if (audioRef.current) {
      audioRef.current.currentTime = clickedPercentage * duration;
    }
    setProgress(clickedPercentage * 100);
    resetControlsTimeout();
  };

  const playNextVideo = (e) => {
    e.stopPropagation();
    const relatedLinks = document.querySelectorAll('.related-video-card');
    if (relatedLinks && relatedLinks.length > 0) {
      relatedLinks[0].click();
    } else {
      router.push('/');
    }
  };

  const formatTime = (timeInSeconds) => {
    if (isNaN(timeInSeconds)) return '0:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Close settings menu if clicked outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (settingsOpen && !e.target.closest('.yt-player-settings-wrapper')) {
        setSettingsOpen(false);
        setSettingsSubMenu(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [settingsOpen]);

  // Determine video quality URL
  const getVideoSrc = () => {
    if (!video) return '';
    let src = '';
    if (selectedQuality === 'auto') {
      src = video.videoUrl;
    } else if (video.qualities && video.qualities[selectedQuality]) {
      src = video.qualities[selectedQuality];
    } else if (video.videoUrl && video.videoUrl.includes('/api/videos/stream/')) {
      src = `${video.videoUrl}?quality=${selectedQuality}`;
    } else {
      src = video.videoUrl;
    }

    if (src && src.includes('/api/videos/stream/')) {
      const poToken = window.youtubePoToken || localStorage.getItem('youtube_po_token') || '';
      const visitorData = window.youtubeVisitorData || localStorage.getItem('youtube_visitor_data') || '';
      if (poToken && visitorData) {
        src += `${src.includes('?') ? '&' : '?'}poToken=${encodeURIComponent(poToken)}&visitorData=${encodeURIComponent(visitorData)}`;
      }
    }
    return src;
  };


  // List quality options: check if directQualities has keys, then if video.qualities exists, else show standard mock options
  const qualityOptions = Object.keys(directQualities).length > 0
    ? ['auto', ...Object.keys(directQualities)]
    : (video && video.qualities && Object.keys(video.qualities).length > 0
       ? ['auto', ...Object.keys(video.qualities)]
       : ['auto', '1080p', '720p', '480p', '360p']);

  const handlePiPToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        triggerFeedback('PiP Off', 'picture_in_picture');
      } else {
        await videoRef.current.requestPictureInPicture();
        triggerFeedback('PiP On', 'picture_in_picture');
      }
    } catch (err) {
      console.error("Picture-in-Picture error:", err);
    }
    resetControlsTimeout();
  };

  const getFeedbackIcon = (iconName: string) => {
    switch (iconName) {
      case 'play':
        return (
          <svg viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        );
      case 'pause':
        return (
          <svg viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        );
      case 'volume_up':
        return (
          <svg viewBox="0 0 24 24">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        );
      case 'volume_down':
        return (
          <svg viewBox="0 0 24 24">
            <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
          </svg>
        );
      case 'volume_off':
        return (
          <svg viewBox="0 0 24 24">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
        );
      case 'forward':
        return (
          <svg viewBox="0 0 24 24">
            <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
          </svg>
        );
      case 'backward':
        return (
          <svg viewBox="0 0 24 24">
            <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
          </svg>
        );
      case 'picture_in_picture':
        return (
          <svg viewBox="0 0 24 24">
            <path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/>
          </svg>
        );
      case 'fullscreen':
        return (
          <svg viewBox="0 0 24 24">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
          </svg>
        );
      default:
        return null;
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleFullscreen(e);
  };

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const moveX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, moveX / rect.width));
    const targetTime = percentage * duration;
    setHoverTime(targetTime);
    setHoverX(moveX);
  };

  const handleProgressMouseLeave = () => {
    setHoverTime(null);
  };

  return (
    <div className={`video-player-outer-wrapper ${isTheaterMode ? 'theater' : ''}`} style={{ position: 'relative', width: '100%' }}>
      {ambientModeActive && !isTheaterMode && !hasError && !isLoading && (
        <canvas 
          ref={canvasRef} 
          width={16} 
          height={9} 
          className="ambient-glow-canvas"
        />
      )}
      <div 
        className={`video-player-container ${isTheaterMode ? 'theater' : ''}`}
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div className="video-player-wrapper" onClick={handlePlayPause} onDoubleClick={handleDoubleClick}>
          <video
            ref={videoRef}
            src={resolvedUrl || undefined}
            referrerPolicy="no-referrer"
            className="video-player-element"
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleError}
            onPlay={() => {
              setIsPlaying(true);
              setIsEnded(false);
              if (audioRef.current && audioRef.current.paused) {
                audioRef.current.play().catch(e => console.log('[VideoPlayer] Audio play failed:', e.message));
              }
            }}
            onPause={() => {
              setIsPlaying(false);
              if (audioRef.current && !audioRef.current.paused) {
                audioRef.current.pause();
              }
            }}
            onEnded={() => {
              setIsEnded(true);
              setIsPlaying(false);
              watchEndedRef.current = true;
              fireEvent('watch', currentVideoId, { percent: 100 });
              if (audioRef.current && !audioRef.current.paused) {
                audioRef.current.pause();
              }
            }}
            onWaiting={() => {
              setLoadingStream(true);
              if (audioRef.current && !audioRef.current.paused) {
                audioRef.current.pause();
              }
              // Auto-downgrade: if playback stalls ~2.5s on a flaky
              // connection and we're above 360p, drop to 360p ONCE. This
              // kills the 1s play / 1s loader rebuffer loop — the new
              // quality URL is cache-warmed so the switch is instant.
              // Guard uses the EFFECTIVE quality (auto resolves to the
              // network-suggested one) — never upgrade, never touch 360p
              // and below. (2026-08)
              if (!stallDowngradedRef.current && videoRef.current) {
                const effNow = selectedQuality === 'auto' ? getNetworkSuggestedQuality() : selectedQuality;
                const above360 = ['480p', '720p', '1080p', '2160p'].includes(effNow);
                if (above360) {
                  if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
                  stallTimerRef.current = setTimeout(() => {
                    const v = videoRef.current;
                    const stillStalled = v && v.readyState < 3 && (v.buffered.length === 0 || v.buffered.end(v.buffered.length - 1) < v.currentTime + 4);
                    if (stillStalled) {
                      stallDowngradedRef.current = true;
                      console.log('[VideoPlayer] ⬇️ Playback stalling — auto-downgrading to 360p');
                      setSelectedQuality('360p');
                    }
                    stallTimerRef.current = null;
                  }, 2500);
                }
              }
            }}
            onSeeking={() => {
              setLoadingStream(true);
              if (audioRef.current && !audioRef.current.paused) {
                audioRef.current.pause();
              }
            }}
            onSeeked={() => {
              setLoadingStream(false);
              if (audioRef.current && videoRef.current && !videoRef.current.paused && audioRef.current.paused) {
                audioRef.current.currentTime = videoRef.current.currentTime;
                audioRef.current.play().catch(e => console.log(e.message));
              }
            }}
            onCanPlay={() => setLoadingStream(false)}
            onPlaying={() => {
              setLoadingStream(false);
              if (stallTimerRef.current) { clearTimeout(stallTimerRef.current); stallTimerRef.current = null; }
              if (audioRef.current && videoRef.current && !videoRef.current.paused && audioRef.current.paused) {
                audioRef.current.currentTime = videoRef.current.currentTime;
                audioRef.current.play().catch(e => console.log(e.message));
              }
            }}
            muted={resolvedAudioUrl ? true : isMuted}
            playsInline
            autoPlay={true}
            style={{ display: (video && video.status === 'Pending') || hasError ? 'none' : 'block' }}
          />

          {resolvedAudioUrl && (
            <audio
              ref={audioRef}
              src={resolvedAudioUrl || undefined}
              style={{ display: 'none' }}
            />
          )}

          {video && video.status === 'Pending' && (
            <div className="dots-loader-container">
              <div className="circular-dots-loader">
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
              </div>
              <p className="loader-status">{video.uploadStatus || 'Preparing YouTube Upload...'}</p>
              <span className="loader-percentage">{video.uploadProgress || 0}%</span>
              {video.uploadProgress > 0 && video.uploadProgress < 100 && (
                <p className="loader-countdown">
                  Est. time remaining: {Math.round((100 - video.uploadProgress) * 1.5)}s
                </p>
              )}
              <p style={{ fontSize: '12px', color: '#666', maxWidth: '400px', marginTop: '10px', textAlign: 'center', lineHeight: '1.4' }}>
                YouTube's security requires a dynamic BotGuard workflow. Your agent is running in the background. Keep this page open to watch immediately.
              </p>
            </div>
          )}

          {hasError && ytId ? (
            <div style={{ position: 'absolute', inset: 0, zIndex: 60, background: '#000' }}>
              <iframe
                src={`https://www.youtube.com/embed/${ytId}?autoplay=1&playsinline=1&enablejsapi=1&rel=0`}
                title={video?.title || "Video Player"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 'none' }}
              />
              <a
                href={`https://www.youtube.com/watch?v=${ytId}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  position: 'absolute',
                  right: 12,
                  bottom: 12,
                  zIndex: 61,
                  background: 'rgba(0,0,0,0.78)',
                  color: '#fff',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 12,
                  textDecoration: 'none'
                }}
              >
                Open in YouTube ↗
              </a>
            </div>
          ) : hasError ? (
            <div className="video-error-message" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#fff', background: '#000', position: 'absolute', top: 0, left: 0, width: '100%', zIndex: 60 }}>
              <svg viewBox="0 0 24 24" width="48" height="48" style={{ marginBottom: '16px', color: '#aaa' }}>
                <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              <p style={{ fontSize: '16px', fontWeight: '500' }}>This video is unavailable.</p>
            </div>
          ) : null}
          
          {(isLoading || loadingStream) && !hasError && (
            <div className="video-loading-overlay">
              <div className="video-spinner"></div>
              <p style={{ margin: '12px 0 0 0', fontWeight: 500, fontSize: '14px' }}>Securing Stream...</p>
            </div>
          )}

          {isEnded && !isLoading && (
            <div className="replay-overlay" onClick={handleReplay}>
              <div className="replay-button">
                <svg viewBox="0 0 24 24" width="48" height="48" fill="#fff">
                  <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                </svg>
                <span>Replay</span>
              </div>
            </div>
          )}
          
          {/* Center Play/Pause Micro-indicator (Apple style) */}
          {showIndicator && (
            <div className={`center-play-pause-indicator ${showIndicator ? 'animate' : ''}`}>
              {indicatorAction === 'play' ? (
                <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                </svg>
              )}
            </div>
          )}

          {/* Overlay Centered Play Button when Paused */}
          {!isPlaying && !hasError && !loadingStream && !isEnded && !isLoading && (
            <div className="play-button-overlay">
              <svg viewBox="0 0 24 24" width="50" height="50" fill="#fff">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </div>
          )}

          {/* Center Feedback Overlay pill */}
          {feedbackOverlay && (
            <div className="player-feedback-overlay">
              <div className="feedback-content">
                <span className="feedback-icon">{getFeedbackIcon(feedbackOverlay.icon)}</span>
                <span className="feedback-text">{feedbackOverlay.text}</span>
              </div>
            </div>
          )}

          {/* Video Player Controls Panel */}
          <div className={`player-controls-overlay ${controlsVisible || !isPlaying ? 'visible' : 'hidden'}`} onClick={(e) => e.stopPropagation()}>
            
            {/* Custom Timeline Progress Scrubber */}
            <div 
              className="progress-timeline-container" 
              onClick={handleProgressClick}
              onMouseMove={handleProgressMouseMove}
              onMouseLeave={handleProgressMouseLeave}
            >
              <div className="progress-timeline-background">
                {/* Buffered progress (grey line) */}
                <div className="buffered-timeline-bar" style={{ width: `${bufferedProgress}%` }}></div>
                {/* Play progress (red line) */}
                <div className="played-timeline-bar" style={{ width: `${progress}%` }}>
                  <span className="played-timeline-handle"></span>
                </div>

                {/* Hover time tooltip */}
                {hoverTime !== null && (
                  <div 
                    className="progress-hover-tooltip" 
                    style={{ left: `${hoverX}px` }}
                  >
                    {formatTime(hoverTime)}
                  </div>
                )}
              </div>
            </div>

            <div className="controls-row">
              {/* Left Controls */}
              <div className="controls-left">
                {/* Play / Pause Toggle */}
                <button className="player-control-btn" onClick={handlePlayPause} title={isPlaying ? "Pause (k)" : "Play (k)"}>
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                </button>

                {/* Next Track button */}
                <button className="player-control-btn" onClick={playNextVideo} title="Next (Shift+N)">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                  </svg>
                </button>

                {/* Mute/Volume button with slide-out slider */}
                <div 
                  className="volume-control-wrapper"
                  onMouseEnter={() => setShowVolumeSlider(true)}
                  onMouseLeave={() => setShowVolumeSlider(false)}
                >
                  <button className="player-control-btn" onClick={handleMuteToggle} title={isMuted ? "Unmute (m)" : "Mute (m)"}>
                    {isMuted || volume === 0 ? (
                      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                      </svg>
                    ) : volume < 0.5 ? (
                      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                      </svg>
                    )}
                  </button>
                  <div className={`volume-slider-container ${showVolumeSlider ? 'slider-expanded' : ''}`}>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="yt-volume-slider"
                    />
                  </div>
                </div>

                {/* Time display */}
                <span className="time-elapsed-display">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>

              {/* Right Controls */}
              <div className="controls-right">
                {/* Subtitles [CC] button */}
                <button 
                  className={`player-control-btn cc-btn ${isCCActive ? 'active' : ''}`} 
                  onClick={(e) => { e.stopPropagation(); setIsCCActive(!isCCActive); }}
                  title="Subtitles/closed captions (c)"
                >
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                    <path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/>
                  </svg>
                </button>

                {/* YouTube Settings Cog/Gear Button */}
                <div className="yt-player-settings-wrapper" style={{ position: 'relative' }}>
                  <button 
                    className={`player-control-btn gear-btn ${settingsOpen ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setSettingsOpen(!settingsOpen); setSettingsSubMenu(null); }}
                    title="Settings"
                  >
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                      <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
                    </svg>
                  </button>

                  {/* Popover Settings Panel */}
                  {settingsOpen && (
                    <div className="yt-player-settings-popover">
                      {settingsSubMenu === null && (
                        <div className="yt-settings-menu-main">
                          <button className="yt-settings-menu-item" onClick={(e) => { e.stopPropagation(); setSettingsSubMenu('speed'); }}>
                            <span className="yt-settings-menu-label">Playback speed</span>
                            <span className="yt-settings-menu-value">{playbackSpeed === 1 ? 'Normal' : `${playbackSpeed}x`}</span>
                            <span className="yt-settings-menu-arrow">&rsaquo;</span>
                          </button>
                          <button className="yt-settings-menu-item" onClick={(e) => { e.stopPropagation(); setSettingsSubMenu('quality'); }}>
                            <span className="yt-settings-menu-label">Quality</span>
                            <span className="yt-settings-menu-value">{selectedQuality.toUpperCase()}</span>
                            <span className="yt-settings-menu-arrow">&rsaquo;</span>
                          </button>
                          <button className="yt-settings-menu-item" onClick={(e) => { e.stopPropagation(); handleAmbientModeToggle(); }}>
                            <span className="yt-settings-menu-label">Ambient mode</span>
                            <span className="yt-settings-menu-value">{ambientModeActive ? 'On' : 'Off'}</span>
                            <span className={`yt-settings-menu-toggle-switch ${ambientModeActive ? 'active' : ''}`}></span>
                          </button>
                        </div>
                      )}

                      {/* Speed selection sub-menu */}
                      {settingsSubMenu === 'speed' && (
                        <div className="yt-settings-menu-sub">
                          <button className="yt-settings-sub-header" onClick={(e) => { e.stopPropagation(); setSettingsSubMenu(null); }}>
                            <span className="yt-settings-sub-back">&larr;</span>
                            <span>Playback speed</span>
                          </button>
                          <hr className="yt-settings-divider" />
                          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                            <button 
                              key={speed} 
                              className={`yt-settings-sub-item ${playbackSpeed === speed ? 'active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); setPlaybackSpeed(speed); setSettingsOpen(false); }}
                            >
                              {playbackSpeed === speed && <span className="yt-settings-check">&#10003;</span>}
                              <span>{speed === 1 ? 'Normal' : `${speed}x`}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Quality selection sub-menu */}
                      {settingsSubMenu === 'quality' && (
                        <div className="yt-settings-menu-sub">
                          <button className="yt-settings-sub-header" onClick={(e) => { e.stopPropagation(); setSettingsSubMenu(null); }}>
                            <span className="yt-settings-sub-back">&larr;</span>
                            <span>Quality</span>
                          </button>
                          <hr className="yt-settings-divider" />
                          {qualityOptions.map(option => (
                            <button 
                              key={option} 
                              className={`yt-settings-sub-item ${selectedQuality === option ? 'active' : ''}`}
                              onClick={(e) => { e.stopPropagation(); setSelectedQuality(option); setSettingsOpen(false); }}
                            >
                              {selectedQuality === option && <span className="yt-settings-check">&#10003;</span>}
                              <span style={{ textTransform: 'uppercase' }}>{option}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Picture-in-Picture Button */}
                {isPiPSupported && (
                  <button 
                    className="player-control-btn pip-btn" 
                    onClick={handlePiPToggle}
                    title="Picture-in-picture (p)"
                  >
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                      <path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/>
                    </svg>
                  </button>
                )}

                {/* Keyboard Shortcuts Info Button */}
                <button 
                  className={`player-control-btn help-btn ${shortcutsOpen ? 'active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setShortcutsOpen(!shortcutsOpen); }}
                  title="Keyboard shortcuts (?)"
                >
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                    <path d="M22 10v-3c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v3c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2zm-2-3v3H4V7h16zM4 12h16c1.1 0 2 .9 2 2v3c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-3c0-1.1.9-2 2-2zm0 5h16v-3H4v3z"/>
                  </svg>
                </button>

                {/* Theater Mode Button */}
                <button 
                  className="player-control-btn theater-btn" 
                  onClick={onTheaterModeToggle}
                  title={isTheaterMode ? "Default view (t)" : "Theater mode (t)"}
                >
                  {isTheaterMode ? (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                      <path d="M19 6H5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H5V8h14v8z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                      <path d="M19 7H5c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm0 8H5V9h14v6z"/>
                    </svg>
                  )}
                </button>

                {/* Fullscreen Toggle Button */}
                <button className="player-control-btn" onClick={handleFullscreen} title="Fullscreen (f)">
                  {typeof document !== 'undefined' && document.fullscreenElement ? (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                      <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Overlay Card */}
      {shortcutsOpen && (
        <div className="yt-shortcuts-overlay" onClick={() => setShortcutsOpen(false)}>
          <div className="yt-shortcuts-card" onClick={(e) => e.stopPropagation()}>
            <div className="yt-shortcuts-header">
              <h3>Keyboard Shortcuts</h3>
              <button className="close-shortcuts-btn" onClick={() => setShortcutsOpen(false)}>&times;</button>
            </div>
            <div className="yt-shortcuts-grid">
              <div className="shortcut-item"><kbd>Space</kbd> / <kbd>K</kbd> <span>Play / Pause</span></div>
              <div className="shortcut-item"><kbd>M</kbd> <span>Mute / Unmute</span></div>
              <div className="shortcut-item"><kbd>&larr;</kbd> / <kbd>&rarr;</kbd> <span>Seek backward/forward 5s</span></div>
              <div className="shortcut-item"><kbd>&uarr;</kbd> / <kbd>&darr;</kbd> <span>Volume up/down 5%</span></div>
              <div className="shortcut-item"><kbd>F</kbd> <span>Toggle Fullscreen</span></div>
              <div className="shortcut-item"><kbd>T</kbd> <span>Toggle Theater Mode</span></div>
              <div className="shortcut-item"><kbd>P</kbd> <span>Picture-in-Picture</span></div>
              <div className="shortcut-item"><kbd>?</kbd> <span>Toggle Keyboard Shortcuts</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
