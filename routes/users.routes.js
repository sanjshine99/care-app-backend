const express = require('express');
const { protect } = require('../middleware/auth');
const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  resetPassword,
} = require('../controllers/usersController');

const router = express.Router();

router.use(protect);

router.route('/')
  .get(getAllUsers)
  .post(createUser);

router.post('/:id/reset-password', resetPassword);

router.route('/:id')
  .get(getUserById)
  .put(updateUser);

module.exports = router;
