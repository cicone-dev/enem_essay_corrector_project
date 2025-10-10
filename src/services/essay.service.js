// src/services/essay.service.js

import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Usamos gemini-2.5-flash como o modelo mais rápido e econômico
const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

// --- Funções Auxiliares ---

/**
 * Tenta extrair o conteúdo de texto da resposta da API Gemini, verificando 
 * múltiplos caminhos para garantir robustez.
 */
const extractRawTextFromResponse = (response) => {
    // Tenta extrair se a resposta estiver aninhada sob uma chave 'response' (comum em logs de erro)
    if (response && response.response) {
        const nestedText = extractRawTextFromResponse(response.response);
        if (nestedText) return nestedText;
    }
    
    // Caminho mais comum para conteúdo estruturado
    let text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return text;

    // Caminho simples de 'response.text'
    text = response.text;
    if (text) return text;
    
    // Último recurso: itera sobre todas as partes
    const candidate = response.candidates?.[0];
    if (candidate && candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
            if (part.text) {
                return part.text;
            }
        }
    }

    return null;
};


/**
 * Gera o prompt detalhado para o modelo Gemini.
 */
const generatePrompt = (essayText, essayTopic) => {
    return `
    Você é um corretor HUMANO de redações de alta performance, especializado na correção de redações do ENEM por anos.
    Sua tarefa é avaliar a redação de acordo com as cinco competências do ENEM (C1 a C5) e fornecer uma análise textual completa.
    
    A nota de cada competência deve ser um múltiplo de 40 (0, 40, 80, 120, 160, 200). A nota TOTAL deve ser a soma das 5 notas.

    O TEMA da redação é: "${essayTopic}".
    A REDAÇÃO submetida é:
    ---
    ${essayText}
    ---
    
    Sua resposta DEVE ser estruturada EXCLUSIVAMENTE em JSON e seguir este formato:
    {
      "competencias": {
        "c1": {
          "nota": 0,
          "analise": "String com a análise da C1."
        },
        "c2": {
          "nota": 0,
          "analise": "String com a análise da C2."
        },
        "c3": {
          "nota": 0,
          "analise": "String com a análise da C3."
        },
        "c4": {
          "nota": 0,
          "analise": "String com a análise da C4."
        },
        "c5": {
          "nota": 0,
          "analise": "String com a análise da C5."
        }
      },
      "total": 0,
      "feedbackGeral": "Análise completa da redação, como um corretor humano, destacando pontos fortes e fracos gerais."
    }
    `;
};

/**
 * 🌟 CRÍTICO: Tenta fazer o parse de uma string JSON, limpando a resposta do modelo, 
 * mas também aceitando e retornando objetos que já foram parseados pelo Prisma (tipo Json).
 */
const parseJsonSafely = (data) => {
    // Se for nulo ou indefinido, retorna nulo.
    if (!data) return null;

    // Se já for um objeto (e não um Array), retorna-o diretamente. O Prisma pode 
    // retornar o tipo 'Json' já como objeto em alguns ambientes/drivers.
    if (typeof data === 'object' && !Array.isArray(data)) return data;

    // Se for uma string (caso mais comum vindo da API ou de string JSON do banco)
    if (typeof data === 'string') {
        try {
            let cleanedString = data.trim();
            // Remove o bloco de código markdown (```json ... ```) se existir
            if (cleanedString.startsWith('```json')) {
                cleanedString = cleanedString.substring(7);
            }
            if (cleanedString.endsWith('```')) {
                cleanedString = cleanedString.substring(0, cleanedString.length - 3);
            }
            return JSON.parse(cleanedString.trim());
        } catch (e) {
             console.error("Erro ao fazer o parse do JSON da correção (T2):", e.message);
             return null;
        }
    }
    
    // Se for outro tipo não esperado (como Array), retorna nulo
    return null;
};

/**
 * Loga o status da chave de API.
 */
const logApiKeyStatus = () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error("DIAGNÓSTICO: GEMINI_API_KEY está AUSENTE no ambiente.");
    } else {
        console.log(`DIAGNÓSTICO: GEMINI_API_KEY está PRESENTE. (Início: ${key.substring(0, 4)}...)`);
    }
};

// --- Funções Principais do Serviço ---

/**
 * Submete a redação para correção pelo Gemini e salva no banco de dados.
 */
export const submitEssay = async (userId, essayData) => {
    const { essayText, essayTopic } = essayData;

    if (!essayText || !essayTopic) {
        throw new Error("O texto e o tema da redação são obrigatórios.");
    }
    
    logApiKeyStatus(); 

    try {
        const prompt = generatePrompt(essayText, essayTopic);

        const model = genAI.getGenerativeModel({
            model: modelName,
        });

        // Chamada da API Gemini
        const response = await model.generateContent({
            contents: [{ parts: [{ text: prompt }] }],
        });
        
        // Extrai o JSON bruto
        const rawJsonCorrection = extractRawTextFromResponse(response);
        
        console.log(`DIAGNÓSTICO: rawJsonCorrection está ${rawJsonCorrection ? 'PREENCHIDA' : 'VAZIA'}.`);
        
        if (!rawJsonCorrection) {
            const promptFeedback = response.promptFeedback;
            if (promptFeedback?.blockReason) {
                const safetyError = `O modelo bloqueou a resposta. Motivo: ${promptFeedback.blockReason}.`;
                console.error("ERRO GRAVE: Bloqueio de Segurança Gemini:", safetyError);
                throw new Error(`Falha na correção: A API bloqueou o conteúdo. Por favor, revise o texto da sua redação.`);
            }

            console.error("ERRO GRAVE: Resposta completa da API Gemini (JSON não extraído):", JSON.stringify(response, null, 2));
            throw new Error(`O modelo Gemini não retornou o texto de correção. Verifique o log do servidor para mais detalhes.`);
        }
        
        // Faz o parse seguro da string JSON retornada
        const parsedCorrection = parseJsonSafely(rawJsonCorrection);

        if (!parsedCorrection || parsedCorrection.total === undefined || parsedCorrection.total === null) {
            console.error("JSON não parseado ou incompleto. RAW JSON:", rawJsonCorrection);
            throw new Error(`O modelo retornou uma correção inválida ou incompleta. Detalhes no log do servidor.`);
        }

        // 1. Encontra/Cria a redação (Essay)
        let essay = await prisma.essay.findFirst({
            where: {
                userId: userId,
                topic: essayTopic,
                text: essayText,
            },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } } 
        });

        if (!essay) {
            essay = await prisma.essay.create({
                data: {
                    userId,
                    topic: essayTopic,
                    text: essayText,
                },
            });
        }
        
        // 2. Salva a correção associada à redação (Correction)
        const correctionRecord = await prisma.correction.create({
            data: {
                essayId: essay.id,
                total: parsedCorrection.total, 
                notes: parsedCorrection, // O objeto JSON completo é salvo no campo 'notes' (tipo Json)
            },
        });

        // Retorna o objeto completo da correção para o frontend
        // Adiciona a nota completa, competências, etc., ao objeto retornado para 
        // a tela de sucesso ter todos os dados
        return {
            ...correctionRecord,
            // 🚨 CRÍTICO: Garante que 'notes' no retorno seja o OBJETO já parseado
            notes: parsedCorrection, 
            essay,
        };

    } catch (error) {
        if (error.message.includes("GoogleGenerativeAI Error")) {
            console.error("Erro na chamada da API Gemini:", error.message);
            throw new Error(`Falha na API de Correção. Por favor, verifique a chave de API e a conexão de rede.`);
        }
        
        // Em caso de erro de Prisma, lançamos o erro original
        throw error;
    }
};

/**
 * Busca o histórico de redações de um usuário.
 */
export const getEssayHistory = async (userId) => {
    const history = await prisma.essay.findMany({
        where: { userId },
        include: { 
            corrections: { 
                orderBy: { createdAt: 'desc' }, 
                take: 1 
            } 
        },
        orderBy: { createdAt: 'desc' },
    });

    return history.filter(essay => essay.corrections.length > 0)
                  .map(essay => {
                      const latestCorrection = essay.corrections[0];
                      // 🚨 CORREÇÃO: Lê os dados estruturados do campo 'notes'
                      const parsedNotes = parseJsonSafely(latestCorrection.notes);

                      return {
                          ...essay,
                          // Garante que o frontend receba o total corretamente, mesmo que 
                          // já esteja no campo 'total' da correção.
                          correction: {
                              ...latestCorrection,
                              notes: parsedNotes, 
                          }
                      };
                  })
                  .map(({ corrections, ...rest }) => rest);
};

/**
 * Busca uma redação específica pelo ID.
 */
export const getEssayById = async (essayId, userId) => {
    const essay = await prisma.essay.findUnique({
        where: { 
            id: essayId, 
            userId: userId
        },
        include: {
            corrections: {
                orderBy: { createdAt: 'desc' }
            }
        }
    });

    if (!essay) {
        throw new Error("Redação não encontrada ou acesso negado.");
    }
    
    const correctionsParsed = essay.corrections.map(correction => ({
        ...correction,
        // 🚨 CORREÇÃO: Garante que 'notes' seja o objeto JSON parseado
        notes: parseJsonSafely(correction.notes)
    }));


    return {
        ...essay,
        corrections: correctionsParsed
    };
};


/**
 * Calcula dados de análise para o dashboard.
 */
export const getEssayAnalytics = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } } 
        });

        const gradedEssays = essays.filter(e => e.corrections.length > 0);
        // 🚨 CORREÇÃO: Busca o total da nota do campo 'notes'
        const essayGrades = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].notes)?.total)
            .filter(score => score != null);

        const totalEssays = gradedEssays.length;
        const averageGrade = totalEssays > 0 
            ? Math.round(essayGrades.reduce((sum, score) => sum + score, 0) / totalEssays) 
            : 0;
        const highestGrade = totalEssays > 0 
            ? Math.max(...essayGrades) 
            : 0;

        const recentGrades = essayGrades.slice(0, 5).reverse();
        
        // 🚨 CORREÇÃO: Busca as notas de competências em 'notes'
        const competenceScores = gradedEssays.map(e => 
            parseJsonSafely(e.corrections[0].notes)?.competencias
        ).filter(c => c != null);
        
        const competenceAverages = {};
        if (competenceScores.length > 0) {
            const sumScores = competenceScores.reduce((acc, current) => {
                Object.keys(current).forEach(key => {
                    // Garantimos que a chave exista e tenha o campo 'nota'
                    const score = current[key]?.nota; 
                    if (score != null) {
                        acc[key] = (acc[key] || 0) + score;
                    }
                });
                return acc;
            }, {});

            Object.keys(sumScores).forEach(key => {
                competenceAverages[key] = Math.round(sumScores[key] / competenceScores.length);
            });
        }


        return {
            totalEssays,
            averageGrade,
            highestGrade,
            recentGrades,
            competenceAverages,
        };

    } catch (error) {
        console.error("Erro ao calcular analytics:", error);
        throw new Error("Não foi possível calcular a análise de dados.");
    }
};


/**
 * Retorna as conquistas do usuário.
 */
export const getUserAchievements = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } } 
        });

        const gradedEssays = essays.filter(e => e.corrections.length > 0);

        // 🚨 CORREÇÃO: Busca a nota total em 'notes'
        const essayGrades = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].notes)?.total)
            .filter(score => score != null);

        const achievements = [
            { id: 'first_essay', title: 'Primeiro Passo', description: 'Submeta sua primeira redação.', unlocked: essayGrades.length >= 1 },
            { id: 'five_essays', title: 'Cinco na Conta', description: 'Submeta 5 redações.', unlocked: essayGrades.length >= 5 },
            { id: 'road_to_1000', title: 'Quase Perfeito', description: 'Alcance uma nota de 900+.', unlocked: essayGrades.some(grade => grade >= 900) },
        ];
        
        // 🚨 CORREÇÃO: Busca C5 em 'notes'
        const c5Scores = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].notes)?.competencias?.c5?.nota)
            .filter(score => score != null);

        if (c5Scores.some(score => score === 200)) {
            const achievement = achievements.find(a => a.id === 'master_c5');
            if (achievement) {
                achievement.title = 'Mestre da Proposta';
                achievement.description = 'Alcance 200 pontos na Competência 5.';
                achievement.unlocked = true;
            } else {
                achievements.push({
                    id: 'master_c5',
                    title: 'Mestre da Proposta',
                    description: 'Alcance 200 pontos na Competência 5.',
                    unlocked: true
                });
            }
        }
        
        return achievements;

    } catch (error) {
        console.error("Erro ao buscar conquistas:", error);
        throw new Error("Não foi possível buscar as conquistas do usuário.");
    }
};
