const express = require('express');
const router = express.Router();
const { recordEvent } = require('../controllers/eventController');
const { optionalProtect } = require('../middleware/auth');

router.route('/').post(optionalProtect, recordEvent);

module.exports = router;