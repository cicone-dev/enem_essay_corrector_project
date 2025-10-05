import * as EssayService from '../services/essay.service.js';

export const submitEssay = async (req, res, next) => {
  try {
    // Puxa os dados (texto e tópico) do corpo JSON da requisição
    const { essayText, essayTopic } = req.body;
    
    // 🌟 Validação crucial: Verifica se o texto da redação está presente
    if (!essayText || essayText.trim().length === 0) {
      return res.status(400).json({ message: 'O texto da redação e o tópico são obrigatórios.' });
    }

    // O ID do usuário é pego do middleware de autenticação (protectRoute)
    const userId = req.user.id; 
    
    // Chama a função de serviço correta: submitEssay(userId, essayTopic, essayText)
    const correctionResult = await EssayService.submitEssay(userId, essayTopic, essayText);
    
    // Retorna o resultado da correção
    res.status(201).json(correctionResult);

  } catch (err) {
    console.error("Erro no controller submitEssay:", err.message);
    // Para erros de usuário (ex: Redação não encontrada), retorna 404/400.
    // Para erros de servidor (Gemini/DB), lança o erro (500) via middleware.
    next(err);
  }
};


// =========================================================================
// ROTA: GET /history (Histórico de Redações)
// =========================================================================
export const getHistory = async (req, res, next) => {
  try {
    // O ID do usuário é pego do middleware de autenticação
    const history = await EssayService.getEssayHistory(req.user.id);
    res.json(history);
  } catch (err) {
    console.error("Erro no controller getHistory:", err.message);
    next(err);
  }
};

// =========================================================================
// ROTA: GET /analytics (Dashboard de Métricas)
// =========================================================================
export const getAnalytics = async (req, res, next) => {
    try {
        // O ID do usuário é pego do middleware de autenticação
        const analytics = await EssayService.getEssayAnalytics(req.user.id);
        res.json(analytics);
    } catch (err) {
        console.error("Erro no controller getAnalytics:", err.message);
        next(err);
    }
};

// =========================================================================
// ROTA: GET /:essayId (Detalhes de uma Redação Específica)
// =========================================================================
export const getEssayDetails = async (req, res, next) => {  
    try {
        // CORREÇÃO: Usa o parâmetro 'essayId' definido na rota (req.params.essayId)
        const essayId = req.params.essayId; 
        
        // O ID do usuário é pego do middleware de autenticação
        // CORREÇÃO: Chama o serviço com o nome correto 'getEssayById'
        const essayDetails = await EssayService.getEssayById(req.user.id, essayId); 
        res.json(essayDetails);
    } catch (err) {
        // OBS: Se você estivesse usando este controller, a lógica de 404/500 estaria em um middleware de erro ou na rota.
        console.error("Erro no controller getEssayDetails:", err.message);
        next(err);
    }
};
export const getAchievements = async (req, res, next) => {
  try {
      // O ID do usuário é pego do middleware de autenticação
      const achievements = await EssayService.getUserAchievements(req.user.id);
      res.json(achievements);
  } catch (err) {
      console.error("Erro no controller getAchievements:", err.message);
      next(err);
  }
};