const express = require('express');
const {
  login,
  logout,
  getMe,
  changePassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { loginRules, changePasswordRules } = require('../middleware/validators/authValidators');

const router = express.Router();

// Public routes
router.post('/login', loginRules, login);

// Protected routes
router.use(protect); // All routes below require authentication

router.post('/logout', logout);
router.get('/me', getMe);
router.post('/change-password', changePasswordRules, changePassword);

module.exports = router;
