// @ts-nocheck
import { create } from 'zustand';

const useVideoStore = create((set) => ({
  videos: [],
  currentVideo: null,
  homeCategory: 'All',

  setVideos: (videos) => set((state) => ({
    videos: typeof videos === 'function' ? videos(state.videos) : videos,
  })),
  setCurrentVideo: (currentVideo) => set({ currentVideo }),
  setHomeCategory: (homeCategory) => set({ homeCategory }),
}));

export default useVideoStore;
