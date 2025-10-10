import { Router } from 'express';
import { 
    submitEssay, 
    getEssayHistory, 
    getEssayAnalytics, 
    getUserAchievements,
    getEssayById
} from "../services/essay.service.js"; 
import { protectRoute } from "../middlewares/auth.middleware.js";


const router = Router();

// Rota de correção de redação
router.post("/", protectRoute, async (req, res) => {
    try {
        const userId = req.user.id;
        const essayData = req.body;
        const correction = await submitEssay(userId, essayData);
        res.status(200).json(correction);
    } catch (error) {
        // 🚨 CORREÇÃO: Captura o erro de validação e retorna 400
        if (error.message.includes("está faltando na submissão")) {
            return res.status(400).json({ message: error.message });
        }
        // Se não for um erro 400 conhecido, mantém o 500
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
        return res.status(500).json({ message: error.message }); 
    }
});

// Rota para a análise de dados do dashboard
router.get("/analytics", protectRoute, async (req, res) => {
    try {
        const userId = req.user.id;
        const analytics = await getEssayAnalytics(userId);
        res.status(200).json(analytics);
    } catch (error) {
        return res.status(500).json({ message: error.message }); 
    }
});

// Rota para as conquistas do usuário
router.get("/achievements", protectRoute, async (req, res) => {
    try {
        const userId = req.user.id;
        const achievements = await getUserAchievements(userId);
        res.status(200).json(achievements);
    } catch (error) {
        return res.status(500).json({ message: error.message }); 
    }
});

// Rota para buscar uma única redação pelo ID
router.get("/:essayId", protectRoute, async (req, res) => {
    try {
        const { essayId } = req.params;
        const userId = req.user.id; // Pega o ID do usuário do token

        // Passa os dois IDs para a consulta do serviço
        const essay = await getEssayById(essayId, userId); 
        
        // Se a busca falhar (não existir OU não pertencer ao usuário), a função service lança um erro que é tratado abaixo.
        
        res.status(200).json(essay);
     } catch (error) {
        // Verifica se a mensagem de erro é a que lançamos no serviço para 404
        if (error.message.includes("Redação não encontrada")) {
            return res.status(404).json({ message: "Redação não encontrada ou acesso negado." });
        }
        
        // Se for um erro do Prisma (ex: formato de ID inválido) ou outro erro, retorna 500
        console.error("Erro no controle de busca por ID:", error);
        res.status(500).json({ message: "Não foi possível buscar a redação." });
    }
});


export default router;