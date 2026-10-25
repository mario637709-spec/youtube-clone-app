const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dbFirestore = require('../utils/dbFirestore');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

exports.register = async (req, res) => {
  try {
    const { username, email, password, channelName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const emailExists = await dbFirestore.getUserByEmail(email);
    if (emailExists) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    if (username) {
      const usernameExists = await dbFirestore.getUserByUsername(username);
      if (usernameExists) {
        return res.status(400).json({ message: 'User already exists with this username' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const userId = crypto.randomBytes(8).toString('hex');
    const uName = username || email.split('@')[0];
    const chanName = channelName || `${uName}'s Channel`;

    const newUser = await dbFirestore.createUser(userId, {
      username: uName,
      email: email.toLowerCase(),
      password: hashedPassword,
      channelName: chanName,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(chanName)}&background=ff0000&color=fff`,
      subscribers: [],
      subscriptions: []
    });

    res.status(201).json({
      _id: newUser.id,
      username: newUser.username,
      email: newUser.email,
      channelName: newUser.channelName,
      avatar: newUser.avatar,
      settings: newUser.settings || {},
      likedVideos: newUser.likedVideos || [],
      dislikedVideos: newUser.dislikedVideos || [],
      subscriptions: newUser.subscriptions || [],
      token: generateToken(newUser.id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await dbFirestore.getUserByEmail(email);

    if (user && (await bcrypt.compare(password, user.password))) {
      res.json({
        _id: user.id,
        username: user.username,
        email: user.email,
        channelName: user.channelName,
        avatar: user.avatar,
        settings: user.settings || {},
        likedVideos: user.likedVideos || [],
        dislikedVideos: user.dislikedVideos || [],
        subscriptions: user.subscriptions || [],
        token: generateToken(user.id),
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    res.json(req.user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

