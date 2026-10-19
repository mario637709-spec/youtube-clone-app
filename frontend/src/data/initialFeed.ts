// @ts-nocheck
export interface FeedVideo {
  id: string;
  youtube_id: string;
  title: string;
  description: string;
  category: string;
  uploader: {
    id: string;
    channelName: string;
    avatar: string;
  };
  channel: {
    name: string;
    avatar: string;
  };
  views: number;
  likes: number;
  duration: string;
  thumbnail: string;
  storageLocation: string;
  status: string;
  createdAt: string;
}

export const initialFeed: FeedVideo[] = [
  {
    id: "f8rvVxDENIs",
    youtube_id: "f8rvVxDENIs",
    title: "Haunted Place Pe Aagye 😲",
    description: "Exploring mysterious abandoned places! Hit like and subscribe to the channel.",
    category: "Entertainment",
    uploader: {
      id: "UCjvgGbPPn",
      channelName: "Sourav Joshi Vlogs",
      avatar: "https://ui-avatars.com/api/?name=Sourav+Joshi&background=FF0000&color=fff"
    },
    channel: {
      name: "Sourav Joshi Vlogs",
      avatar: "https://ui-avatars.com/api/?name=Sourav+Joshi&background=FF0000&color=fff"
    },
    views: 4820000,
    likes: 312000,
    duration: "12:41",
    thumbnail: "https://i.ytimg.com/vi/f8rvVxDENIs/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-06-20T10:00:00.000Z"
  },
  {
    id: "L_LUpnjgPso",
    youtube_id: "L_LUpnjgPso",
    title: "YALGAAR - CARRYMINATI X Wily Frenzy",
    description: "Official Music Video by CarryMinati. Music produced by Wily Frenzy.",
    category: "Music",
    uploader: {
      id: "UCj22tfcQrWG7EMEKS0qLeEg",
      channelName: "CarryMinati",
      avatar: "https://ui-avatars.com/api/?name=CarryMinati&background=0A84FF&color=fff"
    },
    channel: {
      name: "CarryMinati",
      avatar: "https://ui-avatars.com/api/?name=CarryMinati&background=0A84FF&color=fff"
    },
    views: 385000000,
    likes: 18200000,
    duration: "3:14",
    thumbnail: "https://i.ytimg.com/vi/L_LUpnjgPso/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-05-15T12:00:00.000Z"
  },
  {
    id: "t433PEQGErc",
    youtube_id: "t433PEQGErc",
    title: "$456,000 Squid Game In Real Life!",
    description: "Recreated every single set from Squid Game in real life! 456 contestants competing.",
    category: "Entertainment",
    uploader: {
      id: "UCX6OQ3DkcsbYNE6H8uQQuVA",
      channelName: "MrBeast",
      avatar: "https://ui-avatars.com/api/?name=MrBeast&background=00BAFF&color=fff"
    },
    channel: {
      name: "MrBeast",
      avatar: "https://ui-avatars.com/api/?name=MrBeast&background=00BAFF&color=fff"
    },
    views: 650000000,
    likes: 17500000,
    duration: "25:41",
    thumbnail: "https://i.ytimg.com/vi/t433PEQGErc/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-04-10T14:30:00.000Z"
  },
  {
    id: "FzG4uDgje3M",
    youtube_id: "FzG4uDgje3M",
    title: "GTA 5 : THE SECRET UNDERWATER LAB MISSION!",
    description: "Techno Gamerz exploring the most dangerous secret lab hidden underwater in GTA 5.",
    category: "Gaming",
    uploader: {
      id: "UCX8pnu3DYUnx8qy8V_c6oHg",
      channelName: "Techno Gamerz",
      avatar: "https://ui-avatars.com/api/?name=Techno+Gamerz&background=30D158&color=fff"
    },
    channel: {
      name: "Techno Gamerz",
      avatar: "https://ui-avatars.com/api/?name=Techno+Gamerz&background=30D158&color=fff"
    },
    views: 12500000,
    likes: 740000,
    duration: "32:15",
    thumbnail: "https://i.ytimg.com/vi/FzG4uDgje3M/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-06-12T18:00:00.000Z"
  },
  {
    id: "ZXsQAXx_ao0",
    youtube_id: "ZXsQAXx_ao0",
    title: "iPhone 16 Pro Review: The Honest Truth!",
    description: "Full in-depth review of Apple's flagship smartphone after one month of real-world use.",
    category: "Tech",
    uploader: {
      id: "UCBJycsmduvYEL83R_U4JriQ",
      channelName: "Marques Brownlee",
      avatar: "https://ui-avatars.com/api/?name=MKBHD&background=FF3B30&color=fff"
    },
    channel: {
      name: "Marques Brownlee",
      avatar: "https://ui-avatars.com/api/?name=MKBHD&background=FF3B30&color=fff"
    },
    views: 8900000,
    likes: 420000,
    duration: "18:22",
    thumbnail: "https://i.ytimg.com/vi/ZXsQAXx_ao0/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-06-01T15:00:00.000Z"
  },
  {
    id: "kJQP7kiw5Fk",
    youtube_id: "kJQP7kiw5Fk",
    title: "Luis Fonsi - Despacito ft. Daddy Yankee",
    description: "Official music video for Despacito by Luis Fonsi featuring Daddy Yankee.",
    category: "Music",
    uploader: {
      id: "UCxoq-PAQeAdk_yg864kq5CA",
      channelName: "Luis Fonsi",
      avatar: "https://ui-avatars.com/api/?name=Luis+Fonsi&background=AF52DE&color=fff"
    },
    channel: {
      name: "Luis Fonsi",
      avatar: "https://ui-avatars.com/api/?name=Luis+Fonsi&background=AF52DE&color=fff"
    },
    views: 8400000000,
    likes: 52000000,
    duration: "4:41",
    thumbnail: "https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-01-10T12:00:00.000Z"
  },
  {
    id: "JGwWNGJdvx8",
    youtube_id: "JGwWNGJdvx8",
    title: "Ed Sheeran - Shape of You (Official Music Video)",
    description: "The official music video for Ed Sheeran - Shape of You.",
    category: "Music",
    uploader: {
      id: "UC0C-w0YjGpqDXGB8IHb662A",
      channelName: "Ed Sheeran",
      avatar: "https://ui-avatars.com/api/?name=Ed+Sheeran&background=FF9500&color=fff"
    },
    channel: {
      name: "Ed Sheeran",
      avatar: "https://ui-avatars.com/api/?name=Ed+Sheeran&background=FF9500&color=fff"
    },
    views: 6200000000,
    likes: 33000000,
    duration: "4:23",
    thumbnail: "https://i.ytimg.com/vi/JGwWNGJdvx8/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-01-15T10:00:00.000Z"
  },
  {
    id: "aircAruvnKk",
    youtube_id: "aircAruvnKk",
    title: "But what is a neural network? | Chapter 1, Deep learning",
    description: "What are the neurons, why are there layers, and what is the math underlying it?",
    category: "Education",
    uploader: {
      id: "UCYO_jab_esuFRV4b17AJtAw",
      channelName: "3Blue1Brown",
      avatar: "https://ui-avatars.com/api/?name=3Blue1Brown&background=5856D6&color=fff"
    },
    channel: {
      name: "3Blue1Brown",
      avatar: "https://ui-avatars.com/api/?name=3Blue1Brown&background=5856D6&color=fff"
    },
    views: 18400000,
    likes: 720000,
    duration: "19:12",
    thumbnail: "https://i.ytimg.com/vi/aircAruvnKk/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-02-20T08:00:00.000Z"
  },
  {
    id: "SlPhMPnQ58k",
    youtube_id: "SlPhMPnQ58k",
    title: "Alan Walker - Faded",
    description: "Listen to Faded on Spotify, Apple Music and more.",
    category: "Music",
    uploader: {
      id: "UCJrOtniJ0-NWz37R30urifQ",
      channelName: "Alan Walker",
      avatar: "https://ui-avatars.com/api/?name=Alan+Walker&background=007AFF&color=fff"
    },
    channel: {
      name: "Alan Walker",
      avatar: "https://ui-avatars.com/api/?name=Alan+Walker&background=007AFF&color=fff"
    },
    views: 3500000000,
    likes: 27000000,
    duration: "3:32",
    thumbnail: "https://i.ytimg.com/vi/SlPhMPnQ58k/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-03-01T12:00:00.000Z"
  },
  {
    id: "pB-5XG-DbAA",
    youtube_id: "pB-5XG-DbAA",
    title: "BB Ki Vines- | Titu Mama |",
    description: "Banter with Titu Mama. Like, share and subscribe!",
    category: "Entertainment",
    uploader: {
      id: "UCqwUrj10mAEvwEZDeq6KUcw",
      channelName: "BB Ki Vines",
      avatar: "https://ui-avatars.com/api/?name=BB+Ki+Vines&background=FF2D55&color=fff"
    },
    channel: {
      name: "BB Ki Vines",
      avatar: "https://ui-avatars.com/api/?name=BB+Ki+Vines&background=FF2D55&color=fff"
    },
    views: 45000000,
    likes: 2400000,
    duration: "9:54",
    thumbnail: "https://i.ytimg.com/vi/pB-5XG-DbAA/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-04-18T16:00:00.000Z"
  },
  {
    id: "yPYZpwSpKmA",
    youtube_id: "yPYZpwSpKmA",
    title: "What If We Detonated All Nuclear Bombs at Once?",
    description: "A scientific exploration by Kurzgesagt – In a Nutshell.",
    category: "Education",
    uploader: {
      id: "UCsXVk37bltHxD1rDPwtNM8Q",
      channelName: "Kurzgesagt",
      avatar: "https://ui-avatars.com/api/?name=Kurzgesagt&background=34C759&color=fff"
    },
    channel: {
      name: "Kurzgesagt",
      avatar: "https://ui-avatars.com/api/?name=Kurzgesagt&background=34C759&color=fff"
    },
    views: 29000000,
    likes: 1300000,
    duration: "11:06",
    thumbnail: "https://i.ytimg.com/vi/yPYZpwSpKmA/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-03-25T11:00:00.000Z"
  },
  {
    id: "b005iU7iT10",
    youtube_id: "b005iU7iT10",
    title: "NASA Live Stream - Earth from Space (HD)",
    description: "Live views of Earth from the International Space Station cameras.",
    category: "Live",
    uploader: {
      id: "UCLA_DiR1FfKNvjuUpBHmylQ",
      channelName: "NASA",
      avatar: "https://ui-avatars.com/api/?name=NASA&background=0B3D91&color=fff"
    },
    channel: {
      name: "NASA",
      avatar: "https://ui-avatars.com/api/?name=NASA&background=0B3D91&color=fff"
    },
    views: 84000000,
    likes: 1900000,
    duration: "Live",
    thumbnail: "https://i.ytimg.com/vi/b005iU7iT10/hqdefault.jpg",
    storageLocation: "YouTube",
    status: "Live",
    createdAt: "2026-06-01T00:00:00.000Z"
  }
];
