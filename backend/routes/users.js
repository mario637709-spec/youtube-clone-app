const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getUserAnalytics, updateUser, toggleSubscribe } = require('../controllers/userController');

// User analytics dashboard route (we place it before parameterized routes to avoid match collision)
router.get('/analytics', protect, getUserAnalytics);

router.post('/subscribe/:id', protect, toggleSubscribe);

router.get('/:id', (req, res) => {
  res.json({ message: 'Get user by ID' });
});

router.put('/:id', protect, updateUser);
router.put('/', protect, updateUser);

module.exports = router;
