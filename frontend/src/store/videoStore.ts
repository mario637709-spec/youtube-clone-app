// @ts-nocheck
import { create } from 'zustand';

const useVideoStore = create((set) => ({
  videos: [],
  currentVideo: null,
  homeCategory: 'All',
  feedScrollPos: 0,

  setVideos: (videos) => set((state) => ({
    videos: typeof videos === 'function' ? videos(state.videos) : videos,
  })),
  setCurrentVideo: (currentVideo) => set({ currentVideo }),
  setHomeCategory: (homeCategory) => set({ homeCategory }),
  setFeedScrollPos: (feedScrollPos) => set({ feedScrollPos }),
}));

export default useVideoStore;
