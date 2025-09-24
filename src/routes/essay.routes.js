import { Router } from 'express';
// A importação foi corrigida aqui
import { correctEssay, getEssayHistory } from "../services/essay.service.js"; 
import { protectRoute } from "../middlewares/auth.middleware.js";

const router = Router();

// Rota de correção de redação
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

// Rota para o histórico de redações
router.get("/history", protectRoute, async (req, res) => {
    try {
        const userId = req.user.id;
        const history = await getEssayHistory(userId);
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;