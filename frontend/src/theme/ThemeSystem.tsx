import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

// ─── 4 Premium Theme Variants ───
export const THEME_VARIANTS = {
  VIVID_LIGHT: {
    id: 'VIVID_LIGHT',
    name: 'Vivid Light',
    description: 'Bright, energetic, bold colors — YouTube meets modern creativity',
    preview: '🌈',
    mode: 'light',
    colorVariant: 'VIBRANT',
    seedColor: '#FF0033',
    roundness: 'ROUND_EIGHT',
    spacingScale: 2,
    headlineFont: 'PLUS_JAKARTA_SANS',
    bodyFont: 'INTER',
    labelFont: 'INTER',
    // CSS Custom Properties
    colors: {
      // Backgrounds
      '--bg-main': '#FAFAFA',
      '--bg-elevated': '#FFFFFF',
      '--bg-secondary': '#F5F5F5',
      '--bg-hover': 'rgba(255, 0, 51, 0.08)',
      '--bg-card': '#FFFFFF',
      '--bg-pill': 'rgba(255, 0, 51, 0.1)',
      '--bg-pill-hover': 'rgba(255, 0, 51, 0.16)',
      '--bg-glass': 'rgba(255, 255, 255, 0.85)',
      '--bg-glass-border': 'rgba(0, 0, 0, 0.06)',
      '--bg-skeleton': '#E8E8E8',
      '--bg-skeleton-active': '#D8D8D8',
      // Text
      '--text-primary': '#0A0A0A',
      '--text-secondary': '#5A5A5A',
      '--text-tertiary': '#8A8A8A',
      '--text-inverse': '#FFFFFF',
      // Brand
      '--brand-red': '#FF0033',
      '--accent': '#FF0033',
      '--accent-soft': '#FF4D6D',
      '--accent-deep': '#CC0028',
      '--accent-gradient': 'linear-gradient(135deg, #FF0033 0%, #FF4D6D 50%, #FF6B8A 100%)',
      '--accent-glow': 'rgba(255, 0, 51, 0.35)',
      '--accent-glow-strong': 'rgba(255, 0, 51, 0.5)',
      // Borders
      '--border-color': 'rgba(0, 0, 0, 0.08)',
      '--border-strong': 'rgba(0, 0, 0, 0.12)',
      // Shadows
      '--shadow-glow': '0 8px 32px rgba(255, 0, 51, 0.15)',
      '--shadow-card': '0 2px 8px rgba(0, 0, 0, 0.06)',
      '--shadow-hover': '0 8px 24px rgba(255, 0, 51, 0.18)',
      '--shadow-elevated': '0 12px 40px rgba(0, 0, 0, 0.08)',
      '--shadow-glass': '0 4px 24px rgba(0, 0, 0, 0.05)',
      // Radius
      '--radius-sm': '8px',
      '--radius-md': '12px',
      '--radius-lg': '16px',
      '--radius-xl': '20px',
      '--radius-full': '999px',
      // Motion
      '--motion-fast': '0.15s',
      '--motion-med': '0.3s',
      '--motion-slow': '0.5s',
      '--easing-apple': 'cubic-bezier(0.16, 1, 0.3, 1)',
      '--easing-bounce': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      '--easing-spring': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      // Typography
      '--font-headline': '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-body': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-label': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-mono': 'Menlo, Monaco, Consolas, monospace',
      // Glass
      '--glass-bg': 'rgba(255, 255, 255, 0.72)',
      '--glass-border': 'rgba(0, 0, 0, 0.06)',
      '--glass-blur': 'blur(24px)',
    }
  },

  ETHEREAL_GLOW: {
    id: 'ETHEREAL_GLOW',
    name: 'Ethereal Glow',
    description: 'Soft, dreamy, with luminous accents — premium elegance',
    preview: '✨',
    mode: 'light',
    colorVariant: 'EXPRESSIVE',
    seedColor: '#E60023',
    roundness: 'ROUND_TWELVE',
    spacingScale: 2,
    headlineFont: 'MANROPE',
    bodyFont: 'INTER',
    labelFont: 'INTER',
    colors: {
      '--bg-main': '#FDFBFF',
      '--bg-elevated': '#FFFFFF',
      '--bg-secondary': '#F5F0FA',
      '--bg-hover': 'rgba(230, 0, 35, 0.06)',
      '--bg-card': '#FFFFFF',
      '--bg-pill': 'rgba(230, 0, 35, 0.08)',
      '--bg-pill-hover': 'rgba(230, 0, 35, 0.14)',
      '--bg-glass': 'rgba(255, 255, 255, 0.88)',
      '--bg-glass-border': 'rgba(230, 0, 35, 0.08)',
      '--bg-skeleton': '#F0E8F5',
      '--bg-skeleton-active': '#E4D8EC',
      '--text-primary': '#1A1423',
      '--text-secondary': '#6B5B7A',
      '--text-tertiary': '#9A8AA0',
      '--text-inverse': '#FFFFFF',
      '--brand-red': '#E60023',
      '--accent': '#E60023',
      '--accent-soft': '#FF3B5A',
      '--accent-deep': '#B8001C',
      '--accent-gradient': 'linear-gradient(135deg, #E60023 0%, #FF3B5A 40%, #FF6B9D 80%, #FF9FD8 100%)',
      '--accent-glow': 'rgba(230, 0, 35, 0.28)',
      '--accent-glow-strong': 'rgba(230, 0, 35, 0.45)',
      '--border-color': 'rgba(230, 0, 35, 0.08)',
      '--border-strong': 'rgba(230, 0, 35, 0.14)',
      '--shadow-glow': '0 8px 40px rgba(230, 0, 35, 0.12)',
      '--shadow-card': '0 2px 12px rgba(0, 0, 0, 0.04)',
      '--shadow-hover': '0 12px 32px rgba(230, 0, 35, 0.15)',
      '--shadow-elevated': '0 16px 48px rgba(230, 0, 35, 0.08)',
      '--shadow-glass': '0 8px 32px rgba(230, 0, 35, 0.06)',
      '--radius-sm': '10px',
      '--radius-md': '14px',
      '--radius-lg': '18px',
      '--radius-xl': '24px',
      '--radius-full': '999px',
      '--motion-fast': '0.18s',
      '--motion-med': '0.35s',
      '--motion-slow': '0.6s',
      '--easing-apple': 'cubic-bezier(0.16, 1, 0.3, 1)',
      '--easing-bounce': 'cubic-bezier(0.25, 1.6, 0.5, 1)',
      '--easing-spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
      '--font-headline': '"Manrope", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-body': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-label': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-mono': 'Menlo, Monaco, Consolas, monospace',
      '--glass-bg': 'rgba(255, 255, 255, 0.8)',
      '--glass-border': 'rgba(230, 0, 35, 0.08)',
      '--glass-blur': 'blur(32px)',
    }
  },

  CRYSTALLINE_CLEAN: {
    id: 'CRYSTALLINE_CLEAN',
    name: 'Crystalline Clean',
    description: 'Ultra-minimal, razor-sharp, clinical precision — pure focus',
    preview: '💎',
    mode: 'light',
    colorVariant: 'FIDELITY',
    seedColor: '#CC0022',
    roundness: 'ROUND_FOUR',
    spacingScale: 1,
    headlineFont: 'SPACE_GROTESK',
    bodyFont: 'PUBLIC_SANS',
    labelFont: 'PUBLIC_SANS',
    colors: {
      '--bg-main': '#FFFFFF',
      '--bg-elevated': '#FFFFFF',
      '--bg-secondary': '#F8F8F8',
      '--bg-hover': 'rgba(204, 0, 34, 0.05)',
      '--bg-card': '#FFFFFF',
      '--bg-pill': 'rgba(204, 0, 34, 0.06)',
      '--bg-pill-hover': 'rgba(204, 0, 34, 0.12)',
      '--bg-glass': 'rgba(255, 255, 255, 0.95)',
      '--bg-glass-border': 'rgba(0, 0, 0, 0.04)',
      '--bg-skeleton': '#F0F0F0',
      '--bg-skeleton-active': '#E0E0E0',
      '--text-primary': '#0D0D0D',
      '--text-secondary': '#4A4A4A',
      '--text-tertiary': '#888888',
      '--text-inverse': '#FFFFFF',
      '--brand-red': '#CC0022',
      '--accent': '#CC0022',
      '--accent-soft': '#E01A3A',
      '--accent-deep': '#A0001A',
      '--accent-gradient': 'linear-gradient(135deg, #CC0022 0%, #E01A3A 100%)',
      '--accent-glow': 'rgba(204, 0, 34, 0.25)',
      '--accent-glow-strong': 'rgba(204, 0, 34, 0.4)',
      '--border-color': 'rgba(0, 0, 0, 0.06)',
      '--border-strong': 'rgba(0, 0, 0, 0.1)',
      '--shadow-glow': '0 4px 20px rgba(204, 0, 34, 0.1)',
      '--shadow-card': '0 1px 4px rgba(0, 0, 0, 0.04)',
      '--shadow-hover': '0 6px 20px rgba(204, 0, 34, 0.12)',
      '--shadow-elevated': '0 8px 24px rgba(0, 0, 0, 0.05)',
      '--shadow-glass': '0 2px 12px rgba(0, 0, 0, 0.03)',
      '--radius-sm': '6px',
      '--radius-md': '10px',
      '--radius-lg': '14px',
      '--radius-xl': '18px',
      '--radius-full': '999px',
      '--motion-fast': '0.12s',
      '--motion-med': '0.25s',
      '--motion-slow': '0.4s',
      '--easing-apple': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      '--easing-bounce': 'cubic-bezier(0.34, 1.4, 0.64, 1)',
      '--easing-spring': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      '--font-headline': '"Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-body': '"Public Sans", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-label': '"Public Sans", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-mono': 'JetBrains Mono, Menlo, Monaco, monospace',
      '--glass-bg': 'rgba(255, 255, 255, 0.9)',
      '--glass-border': 'rgba(0, 0, 0, 0.04)',
      '--glass-blur': 'blur(16px)',
    }
  },

  AURORA_VIBRANCE: {
    id: 'AURORA_VIBRANCE',
    name: 'Aurora Vibrance',
    description: 'Dynamic, expressive, alive with color — next-gen creator energy',
    preview: '🌅',
    mode: 'light',
    colorVariant: 'TONAL_SPOT',
    seedColor: '#D6001C',
    roundness: 'ROUND_EIGHT',
    spacingScale: 2,
    headlineFont: 'PLUS_JAKARTA_SANS',
    bodyFont: 'INTER',
    labelFont: 'INTER',
    colors: {
      '--bg-main': '#FFF8F9',
      '--bg-elevated': '#FFFFFF',
      '--bg-secondary': '#FFF0F2',
      '--bg-hover': 'rgba(214, 0, 28, 0.07)',
      '--bg-card': '#FFFFFF',
      '--bg-pill': 'rgba(214, 0, 28, 0.09)',
      '--bg-pill-hover': 'rgba(214, 0, 28, 0.15)',
      '--bg-glass': 'rgba(255, 255, 255, 0.82)',
      '--bg-glass-border': 'rgba(214, 0, 28, 0.1)',
      '--bg-skeleton': '#FDE8EA',
      '--bg-skeleton-active': '#F8D0D4',
      '--text-primary': '#1D0A0D',
      '--text-secondary': '#7A3A40',
      '--text-tertiary': '#A86B70',
      '--text-inverse': '#FFFFFF',
      '--brand-red': '#D6001C',
      '--accent': '#D6001C',
      '--accent-soft': '#FF2D3A',
      '--accent-deep': '#A80016',
      '--accent-gradient': 'linear-gradient(135deg, #D6001C 0%, #FF2D3A 30%, #FF6B4A 60%, #FFB03B 100%)',
      '--accent-glow': 'rgba(214, 0, 28, 0.32)',
      '--accent-glow-strong': 'rgba(214, 0, 28, 0.5)',
      '--border-color': 'rgba(214, 0, 28, 0.1)',
      '--border-strong': 'rgba(214, 0, 28, 0.16)',
      '--shadow-glow': '0 10px 40px rgba(214, 0, 28, 0.18)',
      '--shadow-card': '0 3px 10px rgba(0, 0, 0, 0.05)',
      '--shadow-hover': '0 12px 36px rgba(214, 0, 28, 0.2)',
      '--shadow-elevated': '0 20px 56px rgba(214, 0, 28, 0.12)',
      '--shadow-glass': '0 8px 28px rgba(214, 0, 28, 0.08)',
      '--radius-sm': '8px',
      '--radius-md': '12px',
      '--radius-lg': '16px',
      '--radius-xl': '20px',
      '--radius-full': '999px',
      '--motion-fast': '0.16s',
      '--motion-med': '0.32s',
      '--motion-slow': '0.55s',
      '--easing-apple': 'cubic-bezier(0.16, 1, 0.3, 1)',
      '--easing-bounce': 'cubic-bezier(0.3, 1.6, 0.5, 1)',
      '--easing-spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
      '--font-headline': '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-body': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-label': '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      '--font-mono': 'Menlo, Monaco, Consolas, monospace',
      '--glass-bg': 'rgba(255, 255, 255, 0.75)',
      '--glass-border': 'rgba(214, 0, 28, 0.1)',
      '--glass-blur': 'blur(28px)',
    }
  },
} as const;

export type ThemeVariantId = keyof typeof THEME_VARIANTS;
export type ThemeVariant = typeof THEME_VARIANTS[ThemeVariantId];

// ─── Theme Context ───
interface ThemeContextType {
  currentTheme: ThemeVariantId;
  setTheme: (id: ThemeVariantId) => void;
  theme: ThemeVariant;
  allThemes: Record<ThemeVariantId, ThemeVariant>;
  isLight: boolean;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [currentTheme, setCurrentTheme] = useState<ThemeVariantId>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('yt_theme_variant') as ThemeVariantId) || 'VIVID_LIGHT';
    }
    return 'VIVID_LIGHT';
  });

  useEffect(() => {
    localStorage.setItem('yt_theme_variant', currentTheme);
    applyTheme(THEME_VARIANTS[currentTheme]);
  }, [currentTheme]);

  const theme = THEME_VARIANTS[currentTheme];

  return (
    <ThemeContext.Provider value={{
      currentTheme,
      setTheme: setCurrentTheme,
      theme,
      allThemes: THEME_VARIANTS,
      isLight: true, // All variants are light mode
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};

// ─── Apply Theme to CSS Custom Properties ───
function applyTheme(theme: ThemeVariant) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
  // Apply font faces
  root.style.setProperty('--font-headline', theme.colors['--font-headline']);
  root.style.setProperty('--font-body', theme.colors['--font-body']);
  root.style.setProperty('--font-label', theme.colors['--font-label']);
  // Apply glass properties
  root.style.setProperty('--glass-blur', theme.colors['--glass-blur']);
  // Set theme attribute for CSS selectors
  root.setAttribute('data-theme-variant', theme.id);
  root.setAttribute('data-color-mode', theme.mode);
}

// ─── Theme Selector Component ───
export const ThemeSelector = () => {
  const { currentTheme, setTheme, allThemes, theme } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (open && !(e.target as HTMLElement).closest('.theme-selector')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="theme-selector">
      <button
        className="theme-selector-trigger"
        onClick={() => setOpen(!open)}
        aria-label={`Current theme: ${theme.name}`}
      >
        <span className="theme-preview">{theme.preview}</span>
        <span className="theme-name">{theme.name}</span>
        <svg className="theme-chevron" viewBox="0 0 24 24" width="16" height="16">
          <path fill="currentColor" d="M7 10l5 5 5-5z"/>
        </svg>
      </button>

      {open && (
        <div className="theme-selector-dropdown" role="menu">
          {Object.entries(allThemes).map(([id, t]) => (
            <button
              key={id}
              className={`theme-option ${currentTheme === id ? 'active' : ''}`}
              onClick={() => { setTheme(id as ThemeVariantId); setOpen(false); }}
              role="menuitem"
              aria-selected={currentTheme === id}
            >
              <span className="theme-option-preview">{t.preview}</span>
              <div className="theme-option-info">
                <span className="theme-option-name">{t.name}</span>
                <span className="theme-option-desc">{t.description}</span>
              </div>
              {currentTheme === id && (
                <svg className="theme-option-check" viewBox="0 0 24 24" width="20" height="20">
                  <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};