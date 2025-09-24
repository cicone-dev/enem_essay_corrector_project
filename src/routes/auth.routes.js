import { Router } from 'express';
import { register, login, updateProfilePic } from '../controllers/auth.controller.js';
import { protectRoute } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.put("/profile/update-pic", protectRoute, upload.single("profilePic"), updateProfilePic);

export default router;