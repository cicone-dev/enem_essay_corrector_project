import { Router } from 'express';
import { correctEssay } from "../services/essay.service.js";
import { protectRoute } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/", protectRoute, async (req, res) => {
    try {
        const userId = req.user.id;
        const essayData = req.body;
        const correction = await correctEssay(userId, essayData);
        res.status(200).json(correction);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;