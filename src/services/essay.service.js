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

/**
 * Loga o status da chave de API (visível no log do servidor Render)
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
    // Desestruturação correta do payload (essayText e essayTopic)
    const { essayText, essayTopic } = essayData;

    if (!essayText || !essayTopic) {
        throw new Error("O texto e o tema da redação são obrigatórios.");
    }
    
    // Ajuda a diagnosticar problemas de configuração de ambiente no Render
    logApiKeyStatus(); 

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
                                c1: { type: "NUMBER" }, 
                                c2: { type: "NUMBER" }, 
                                c3: { type: "NUMBER" }, 
                                c4: { type: "NUMBER" }, 
                                c5: { type: "NUMBER" }, 
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
        
        // 🚨 MUDANÇA CRÍTICA: Priorizamos a extração do JSON do caminho completo
        // (candidatos), pois é onde o modelo retorna o JSON estruturado,
        // já que 'response.text' pode vir vazio ao usar 'responseMimeType: application/json'.
        let rawJsonCorrection = response.candidates?.[0]?.content?.parts?.[0]?.text; 
        
        // Se a primeira tentativa falhar, tentamos o caminho direto (fallback)
        if (!rawJsonCorrection) {
            rawJsonCorrection = response.text;
            if (rawJsonCorrection) {
                console.log("LOG: Raw JSON extraído do caminho 'response.text' (fallback) com sucesso.");
            }
        }
        
        // 🚨 BLOCO DE CHECAGEM DE FALHA DO MODELO (FOCADO NA EXTRAÇÃO) 🚨
        if (!rawJsonCorrection) {
            
            // 1. Verifica se houve bloqueio por segurança (safety block)
            const promptFeedback = response.promptFeedback;
            if (promptFeedback?.blockReason) {
                const safetyError = `O modelo bloqueou a resposta. Motivo: ${promptFeedback.blockReason}.`;
                console.error("ERRO GRAVE: Bloqueio de Segurança Gemini:", safetyError);
                throw new Error(`Falha na correção: A API bloqueou o conteúdo. Por favor, revise o texto da sua redação.`);
            }

            // 2. Se ainda for undefined/null/empty, algo fundamental falhou
            console.error("ERRO GRAVE: Resposta completa da API Gemini (JSON não extraído):", JSON.stringify(response, null, 2));
            throw new Error(`O modelo Gemini não retornou o texto de correção (rawJsonCorrection é: ${rawJsonCorrection}). Verifique o log do servidor para mais detalhes. A chave de API pode estar inválida.`);
        }
        
        // Faz o parse seguro da string JSON retornada
        const parsedCorrection = parseJsonSafely(rawJsonCorrection);

        if (!parsedCorrection || parsedCorrection.total === undefined || parsedCorrection.total === null) {
            console.error("JSON não parseado ou incompleto. RAW JSON:", rawJsonCorrection);
            throw new Error(`O modelo retornou uma correção inválida ou incompleta. Detalhes no log do servidor.`);
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
        // Se for um erro na chamada da API Gemini (ex: chave inválida ou timeout de rede)
        if (error.message.includes("GoogleGenerativeAI Error")) {
            console.error("Erro na chamada da API Gemini:", error.message);
            // Lançamos a mensagem de erro original da API para que o frontend a receba no 500.
            throw new Error(`Falha na API de Correção. Por favor, verifique a chave de API e a conexão de rede.`);
        }
        
        // Para outros erros (Prisma, etc. ou os erros mais específicos que acabamos de lançar)
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
        orderBy: { createdAt: 'desc' }, // Ordena as redações, mostrando a mais recente primeiro
    });

    return history.filter(essay => essay.corrections.length > 0)
                  .map(essay => ({
                      ...essay,
                      correction: {
                          ...essay.corrections[0],
                          // Usa o parseJsonSafely com o 'content' para garantir que os dados JSON sejam lidos corretamente
                          notes: parseJsonSafely(essay.corrections[0].content) || essay.corrections[0].notes, 
                      }
                  }))
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
