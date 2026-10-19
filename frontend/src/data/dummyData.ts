// @ts-nocheck
import { thumbnails, getThumbnailPath, getRandomThumbnail } from './thumbnails';

// Dummy video titles (50+)
const videoTitles = [
  'Exploring the Abandoned Cyberpunk City',
  'Secret Arctic Fortress Discovery',
  'Bank Vault with Unlimited Gold',
  'Crystal Forest Research Station Tour',
  'Cyberpunk Greenhouse on Top of Skyscraper',
  'Hidden Laboratory Underground',
  'Giant Diamond Cave Discovery',
  'Floating Island Mansion Tour',
  'Sky City Among the Clouds',
  'Futuristic City Built in Canyon',
  'Storm Chaser Vehicle in Tornado',
  'Glass Pod on Mountain Peak',
  'Deep Ocean Research Base',
  'Golden Temple Behind Waterfall',
  'Hidden Desert Vault Exploration',
  'Lava Race Track in Underground Cavern',
  'Luxury Suite in Space Station',
  'Mega Bridge Spanning Ocean',
  'Mega Prize Vault with Cars',
  'Sunken Shipwreck Gold Discovery',
  'Survival Pod on Volcanic Crater',
  'Treehouse Mansion in Ancient Forest',
  'Underground Bunker Tour',
  'Underwater Tunnel with Sharks',
  'Building the Ultimate Gaming Setup',
  'I Survived 100 Days in This Place',
  '24 Hour Challenge in Abandoned City',
  'Exploring Mysterious Island Base',
  'Ultimate Treasure Hunt',
  'Secret Base Tour',
];

// Generate random views
const getRandomViews = () => {
  const ranges = [
    { min: 100, max: 999 },
    { min: 1000, max: 9999 },
    { min: 10000, max: 99999 },
    { min: 100000, max: 999999 },
    { min: 1000000, max: 9999999 },
  ];
  const range = ranges[Math.floor(Math.random() * ranges.length)];
  return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
};

// Generate random upload time
const getRandomUploadTime = () => {
  const times = [
    '30 minutes ago',
    '1 hour ago',
    '3 hours ago',
    '6 hours ago',
    '12 hours ago',
    '1 day ago',
    '2 days ago',
    '5 days ago',
    '1 week ago',
    '2 weeks ago',
    '1 month ago',
    '2 months ago',
    '6 months ago',
    '1 year ago',
  ];
  return times[Math.floor(Math.random() * times.length)];
};

// Generate random duration
const getRandomDuration = () => {
  const durations = ['5:23', '8:45', '10:12', '12:34', '15:47', '18:20', '20:15', '25:30', '30:45', '42:18'];
  return durations[Math.floor(Math.random() * durations.length)];
};

// Dummy channels (10+)
export const dummyChannels = [
  { id: 1, name: 'Tech Explorer', avatar: 'https://ui-avatars.com/api/?name=Tech+Explorer&background=random', subscribers: '2.5M' },
  { id: 2, name: 'Gaming World', avatar: 'https://ui-avatars.com/api/?name=Gaming+World&background=random', subscribers: '1.8M' },
  { id: 3, name: 'Adventure Seekers', avatar: 'https://ui-avatars.com/api/?name=Adventure+Seekers&background=random', subscribers: '3.2M' },
  { id: 4, name: 'Mystery Hunter', avatar: 'https://ui-avatars.com/api/?name=Mystery+Hunter&background=random', subscribers: '950K' },
  { id: 5, name: 'Urban Legends', avatar: 'https://ui-avatars.com/api/?name=Urban+Legends&background=random', subscribers: '750K' },
  { id: 6, name: 'Epic Builds', avatar: 'https://ui-avatars.com/api/?name=Epic+Builds&background=random', subscribers: '1.2M' },
  { id: 7, name: 'Thrill Zone', avatar: 'https://ui-avatars.com/api/?name=Thrill+Zone&background=random', subscribers: '890K' },
  { id: 8, name: 'Discovery Plus', avatar: 'https://ui-avatars.com/api/?name=Discovery+Plus&background=random', subscribers: '2.1M' },
  { id: 9, name: 'Challenge Master', avatar: 'https://ui-avatars.com/api/?name=Challenge+Master&background=random', subscribers: '3.5M' },
  { id: 10, name: 'Vault Hunter', avatar: 'https://ui-avatars.com/api/?name=Vault+Hunter&background=random', subscribers: '1.5M' },
];

// Categories
export const categories = [
  { id: 1, name: 'All', icon: '🏠' },
  { id: 2, name: 'Gaming', icon: '🎮' },
  { id: 3, name: 'Music', icon: '🎵' },
  { id: 4, name: 'Live', icon: '🔴' },
  { id: 5, name: 'Sports', icon: '⚽' },
  { id: 6, name: 'News', icon: '📰' },
  { id: 7, name: 'Education', icon: '📚' },
  { id: 8, name: 'Tech', icon: '💻' },
];

// Generate 50+ dummy videos
export const generateDummyVideos = (count = 50) => {
  const videos = [];
  
  for (let i = 0; i < count; i++) {
    const channel = dummyChannels[Math.floor(Math.random() * dummyChannels.length)];
    const category = categories[Math.floor(Math.random() * (categories.length - 1)) + 1];
    
    videos.push({
      id: i + 1,
      title: videoTitles[i % videoTitles.length] + (i >= 30 ? ` Part ${Math.floor(i / 30)}` : ''),
      thumbnail: getRandomThumbnail(),
      channel: {
        id: channel.id,
        name: channel.name,
        avatar: channel.avatar,
      },
      views: getRandomViews(),
      uploadTime: getRandomUploadTime(),
      duration: getRandomDuration(),
      category: category.name,
    });
  }
  
  return videos;
};

// Dummy comments
export const dummyComments = [
  { id: 1, userId: 1, userName: 'John Doe', avatar: 'https://ui-avatars.com/api/?name=John+Doe', text: 'This is absolutely incredible! 🔥', likes: 1234, time: '2 hours ago', replies: 5 },
  { id: 2, userId: 2, userName: 'Sarah Smith', avatar: 'https://ui-avatars.com/api/?name=Sarah+Smith', text: 'Best video I have seen all week!', likes: 890, time: '5 hours ago', replies: 2 },
  { id: 3, userId: 3, userName: 'Mike Johnson', avatar: 'https://ui-avatars.com/api/?name=Mike+Johnson', text: 'How did you even find this place?', likes: 567, time: '1 day ago', replies: 12 },
  { id: 4, userId: 4, userName: 'Emma Wilson', avatar: 'https://ui-avatars.com/api/?name=Emma+Wilson', text: 'The production quality is insane 💯', likes: 2341, time: '3 days ago', replies: 8 },
  { id: 5, userId: 5, userName: 'Chris Brown', avatar: 'https://ui-avatars.com/api/?name=Chris+Brown', text: 'Please make more videos like this!', likes: 456, time: '1 week ago', replies: 3 },
];

export default {
  dummyChannels,
  categories,
  generateDummyVideos,
  dummyComments,
};
