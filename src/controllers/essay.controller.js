import * as EssayService from '../services/essay.service.js';

export const submitEssay = async (req, res, next) => {
  try {
    // Verifique se o arquivo foi enviado
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }

    // O ID do usuário é pego do middleware de autenticação
    const userId = req.user.id; 
    
    // Passe o buffer do arquivo para o serviço
    const essay = await EssayService.analyzeEssay(req.file.buffer, userId);
    res.status(201).json(essay);
  } catch (err) {
    next(err);
  }
};

export const getHistory = async (req, res, next) => {
  try {
    // Adicione os parâmetros de paginação `page` e `limit`
    const page = parseInt(req.query.page) || 1; 
    const limit = parseInt(req.query.limit) || 10; 

    // O ID do usuário é pego do middleware de autenticação
    const history = await EssayService.getUserEssays(req.user.id, page, limit);
    res.json(history);
  } catch (err) {
    next(err);
  }
};