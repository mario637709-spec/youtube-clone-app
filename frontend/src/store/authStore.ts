// @ts-nocheck
import { create } from 'zustand';
import { apiClient } from '@/utils/api';

const useAuthStore = create((set, get) => ({
  user: null,
  loading: true,

  loadUser: async () => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const userData = await apiClient.get('/auth/me');
        set({
          user: {
            id: userData.id || userData._id,
            username: userData.username,
            email: userData.email,
            channelName: userData.channelName,
            avatar: userData.avatar,
            settings: userData.settings || {},
            likedVideos: userData.likedVideos || [],
            dislikedVideos: userData.dislikedVideos || [],
            subscriptions: userData.subscriptions || [],
          },
          loading: false,
        });
      } catch (error) {
        console.error('Failed to load user profile:', error);
        localStorage.removeItem('token');
        set({ user: null, loading: false });
      }
    } else {
      set({ loading: false });
    }
  },

  login: async (email, password) => {
    try {
      const data = await apiClient.post('/auth/login', { email, password });
      if (data.token) {
        localStorage.setItem('token', data.token);
        const userData = {
          id: data._id || data.id,
          username: data.username,
          email: data.email,
          channelName: data.channelName,
          avatar: data.avatar,
          settings: data.settings || {},
          likedVideos: data.likedVideos || [],
          dislikedVideos: data.dislikedVideos || [],
          subscriptions: data.subscriptions || [],
        };
        set({ user: userData });
        return userData;
      }
      throw new Error('Login failed: Token not returned');
    } catch (error) {
      throw error;
    }
  },

  register: async (username, email, password, channelName) => {
    try {
      const data = await apiClient.post('/auth/register', { username, email, password, channelName });
      if (data.token) {
        localStorage.setItem('token', data.token);
        const userData = {
          id: data._id || data.id,
          username: data.username,
          email: data.email,
          channelName: data.channelName,
          avatar: data.avatar,
          settings: data.settings || {},
          likedVideos: data.likedVideos || [],
          dislikedVideos: data.dislikedVideos || [],
          subscriptions: data.subscriptions || [],
        };
        set({ user: userData });
        return userData;
      }
      throw new Error('Registration failed: Token not returned');
    } catch (error) {
      throw error;
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ user: null });
  },

  setUser: (userData) => set({ user: userData }),
}));

export default useAuthStore;
