// src/services/essay.service.js

import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Usamos gemini-2.5-flash como o modelo mais rápido e econômico
const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

// --- Funções Auxiliares ---

/**
 * Gera o prompt detalhado para o modelo Gemini.
 */
const generatePrompt = (essayText, essayTopic) => {
    // 🌟 Lógica do prompt ORIGINAL (suas especificações) preservada
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
          "nota": 0, // A nota (0, 40, 80, 120, 160, 200)
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
      "total": 0, // Soma das 5 notas
      "feedbackGeral": "Análise completa da redação, como um corretor humano, destacando pontos fortes e fracos gerais."
    }
    `;
};

/**
 * Tenta fazer o parse de uma string JSON, limpando a resposta do modelo.
 */
const parseJsonSafely = (jsonString) => {
    if (!jsonString) return null;

    try {
        // Tenta limpar a string para remover blocos de código markdown desnecessários (```json)
        let cleanedString = jsonString.trim();
        if (cleanedString.startsWith('```json')) {
            cleanedString = cleanedString.substring(7);
        }
        if (cleanedString.endsWith('```')) {
            cleanedString = cleanedString.substring(0, cleanedString.length - 3);
        }
        return JSON.parse(cleanedString.trim());
    } catch (e) {
        console.error("Erro ao fazer o parse do JSON da correção:", e.message);
        return null;
    }
};

// --- Funções Principais do Serviço ---

/**
 * Submete a redação para correção pelo Gemini e salva no banco de dados.
 * @param {string} userId O ID do usuário autenticado.
 * @param {{ essayText: string, essayTopic: string }} essayData Os dados da redação (texto e tema).
 * @returns {Promise<object>} O objeto de correção salvo.
 */
export const submitEssay = async (userId, essayData) => {
    // 🚨 FIX CRÍTICO 1: Agora desestruturamos essayText e essayTopic, que são os campos 
    // que o frontend está enviando (conforme o log do Axios).
    const { essayText, essayTopic } = essayData;

    if (!essayText || !essayTopic) {
        // Se este erro ocorrer, significa que o express.json() falhou ou os dados não foram enviados
        console.error("Validação falhou: essayText ou essayTopic ausentes.");
        throw new Error("O texto e o tema da redação são obrigatórios.");
    }

    try {
        const prompt = generatePrompt(essayText, essayTopic);

        const model = genAI.getGenerativeModel({
            model: modelName,
            // Adiciona a configuração para forçar a saída em JSON
            config: {
                responseMimeType: "application/json",
                // Define o schema do JSON esperado
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        competencias: {
                            type: "OBJECT",
                            properties: {
                                c1: { type: "OBJECT", properties: { nota: { type: "NUMBER" }, analise: { type: "STRING" } } },
                                c2: { type: "OBJECT", properties: { nota: { type: "NUMBER" }, analise: { type: "STRING" } } },
                                c3: { type: "OBJECT", properties: { nota: { type: "NUMBER" }, analise: { type: "STRING" } } },
                                c4: { type: "OBJECT", properties: { nota: { type: "NUMBER" }, analise: { type: "STRING" } } },
                                c5: { type: "OBJECT", properties: { nota: { type: "NUMBER" }, analise: { type: "STRING" } } },
                            },
                        },
                        total: { type: "NUMBER" },
                        feedbackGeral: { type: "STRING" },
                    },
                    required: ["competencias", "total", "feedbackGeral"],
                }
            }
        });

        // Estrutura de conteúdo (payload)
        const response = await model.generateContent({
            contents: [{ parts: [{ text: prompt }] }],
        });
        
        // 🚨 FIX CRÍTICO 2 (Robustez): Tenta extrair a resposta JSON estruturada
        // Tenta response.text primeiro, depois a rota completa (mais segura)
        let rawJsonCorrection = response.text; 

        if (!rawJsonCorrection) {
            // Rota mais segura para respostas JSON estruturadas ou quando response.text falha
            rawJsonCorrection = response.candidates?.[0]?.content?.parts?.[0]?.text;
            console.warn("Raw JSON extraído da rota completa (candidatos).");
        }
        
        if (!rawJsonCorrection) {
            // Se ainda for undefined/null/empty, o modelo falhou em gerar o JSON
            console.error("Resposta completa da API Gemini (sem texto de correção):", JSON.stringify(response, null, 2));
            throw new Error(`O modelo Gemini não retornou o texto de correção (rawJsonCorrection é: ${rawJsonCorrection}). Verifique o log do servidor para mais detalhes.`);
        }
        
        // Faz o parse seguro da string JSON retornada
        const parsedCorrection = parseJsonSafely(rawJsonCorrection);

        if (!parsedCorrection || parsedCorrection.total === undefined || parsedCorrection.total === null) {
            throw new Error(`O modelo retornou uma correção inválida ou incompleta: ${rawJsonCorrection}`);
        }

        // 1. Salva a redação no banco de dados (se não existir)
        let essay = await prisma.essay.findFirst({
            where: {
                userId: userId,
                topic: essayTopic, // Uso das variáveis corretas
                text: essayText,   // Uso das variáveis corretas
            },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } } 
        });

        if (!essay) {
            essay = await prisma.essay.create({
                data: {
                    userId,
                    topic: essayTopic, // Uso das variáveis corretas
                    text: essayText,   // Uso das variáveis corretas
                },
            });
        }
        
        // 2. Salva a correção associada à redação
        const correctionRecord = await prisma.correction.create({
            data: {
                essayId: essay.id,
                total: parsedCorrection.total, 
                notes: parsedCorrection,
                content: rawJsonCorrection,
            },
        });

        // Retorna o objeto completo da correção para o frontend
        return {
            ...correctionRecord,
            notes: parsedCorrection,
            essay,
        };

    } catch (error) {
        // Se for um erro na chamada da API Gemini, loga e lança um erro mais amigável
        if (error.message.includes("GoogleGenerativeAI Error")) {
            console.error("Erro na chamada da API Gemini:", error.message);
            // Lançamos a mensagem de erro original da API para que o frontend a receba no 500.
            throw new Error(`Falha na API de Correção: ${error.message.split('Error fetching from')[0].trim()}`);
        }
        
        // Se o erro veio do nosso novo bloco de verificação de 'rawJsonCorrection'
        if (error.message.includes("O modelo Gemini não retornou o texto de correção")) {
             console.error("Erro de Conteúdo Vazio:", error.message);
             // Propaga a mensagem de erro específica.
             throw error; 
        }

        // Para outros erros (Prisma, etc.)
        throw error;
    }
};

/**
 * Busca o histórico de redações de um usuário.
 * @param {string} userId O ID do usuário.
 * @returns {Promise<Array<object>>} O histórico de redações com a última correção.
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
        orderBy: { createdAt: 'desc' }, // Ordena as redações, mostrando a mais recente primeiro
    });

    return history.filter(essay => essay.corrections.length > 0)
                  .map(essay => ({
                      ...essay,
                      correction: {
                          ...essay.corrections[0],
                          // Use o parseJsonSafely com o 'content' para garantir que os dados JSON sejam lidos corretamente
                          notes: parseJsonSafely(essay.corrections[0].content) || essay.corrections[0].notes, 
                      }
                  }))
                  .map(({ corrections, ...rest }) => rest);
};

/**
 * Busca uma redação específica pelo ID.
 * @param {string} essayId O ID da redação.
 * @param {string} userId O ID do usuário para verificação de posse.
 * @returns {Promise<object>} A redação com todas as correções.
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
        // Garante que 'notes' seja o objeto JSON parseado
        notes: parseJsonSafely(correction.content) || correction.notes
    }));


    return {
        ...essay,
        corrections: correctionsParsed
    };
};


/**
 * Calcula dados de análise para o dashboard.
 * @param {string} userId O ID do usuário.
 * @returns {Promise<object>} O objeto de analytics.
 */
export const getEssayAnalytics = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } } 
        });

        const gradedEssays = essays.filter(e => e.corrections.length > 0);
        // Garante que o total seja lido do JSON 'content'
        const essayGrades = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].content)?.total)
            .filter(score => score != null);

        const totalEssays = gradedEssays.length;
        const averageGrade = totalEssays > 0 
            ? Math.round(essayGrades.reduce((sum, score) => sum + score, 0) / totalEssays) 
            : 0;
        const highestGrade = totalEssays > 0 
            ? Math.max(...essayGrades) 
            : 0;

        const recentGrades = essayGrades.slice(0, 5).reverse();
        
        const competenceScores = gradedEssays.map(e => 
            parseJsonSafely(e.corrections[0].content)?.competencias
        ).filter(c => c != null);
        
        const competenceAverages = {};
        if (competenceScores.length > 0) {
            const sumScores = competenceScores.reduce((acc, current) => {
                Object.keys(current).forEach(key => {
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
 * @param {string} userId O ID do usuário.
 * @returns {Promise<Array<object>>} A lista de conquistas.
 */
export const getUserAchievements = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } } 
        });

        const gradedEssays = essays.filter(e => e.corrections.length > 0);

        const essayGrades = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].content)?.total)
            .filter(score => score != null);

        const achievements = [
            { id: 'first_essay', title: 'Primeiro Passo', description: 'Submeta sua primeira redação.', unlocked: essayGrades.length >= 1 },
            { id: 'five_essays', title: 'Cinco na Conta', description: 'Submeta 5 redações.', unlocked: essayGrades.length >= 5 },
            { id: 'road_to_1000', title: 'Quase Perfeito', description: 'Alcance uma nota de 900+.', unlocked: essayGrades.some(grade => grade >= 900) },
        ];
        
        const c5Scores = gradedEssays
            .map(e => parseJsonSafely(e.corrections[0].content)?.competencias?.c5?.nota)
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
