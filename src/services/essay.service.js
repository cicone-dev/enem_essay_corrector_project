// src/services/essay.service.js

import { PrismaClient } from '@prisma/client';
import { GoogleGenerativeAI } from '@google/generative-ai';

const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const prisma = new PrismaClient();

// --- Funções Auxiliares ---

/**
 * Gera o prompt detalhado para o modelo Gemini.
 */
const generatePrompt = (essayText, essayTopic) => {
    // Mantém a lógica do prompt inalterada
    return `
    Você é um corretor HUMANO de redações de alta performance, especializado na correção de redações do ENEM por anos.
    Sua tarefa é avaliar a redação de acordo com as cinco competências do ENEM (C1 a C5) e fornecer uma análise textual completa.
    
    O TEMA da redação é: "${essayTopic}".
    A REDAÇÃO submetida é:
    ---
    ${essayText}
    ---
    
    Sua resposta DEVE ser estruturada EXCLUSIVAMENTE em JSON e seguir o formato...
    `;
};

/**
 * 🌟 CORREÇÃO CRÍTICA: Tenta fazer o parse de uma string JSON, limpando a resposta do modelo.
 * Adiciona verificação para null/undefined para evitar o erro '.trim()'.
 */
const parseJsonSafely = (jsonString) => {
    // 🚨 FIX CRÍTICO: Se a string for nula ou indefinida, retorna null imediatamente
    if (!jsonString || typeof jsonString !== 'string') {
        return null;
    }
    
    let cleanString = jsonString.trim();

    // Remove blocos de código Markdown (```json...``` ou ```...```)
    if (cleanString.startsWith("```")) {
        cleanString = cleanString.replace(/^```(json)?\s*|```$/g, '').trim();
    }

    try {
        return JSON.parse(cleanString);
    } catch (e) {
        console.error("🚨 Erro ao parsear JSON da correção:", e.message);
        console.error("String JSON que falhou (início):", cleanString.substring(0, 500) + '...');
        return null;
    }
};


// --- Funções de Serviço ---

/**
 * Processa a submissão e correção de uma nova redação.
 * 🌟 CORREÇÃO DE ARGUMENTOS: Aceita o objeto de dados (essayData) e destrutura.
 */
// 🚨 FIX CRÍTICO 1: Mudar a assinatura para receber 'essayData' (o corpo da requisição)
export const submitEssay = async (userId, essayData) => { 
    try {
        // Assume que essayData é { essayTopic, essayText } (baseado em NewEssayPage.jsx)
        const { essayTopic, essayText } = essayData; 
        
        // Validação rápida para evitar salvar dados incompletos ou chamar a IA sem conteúdo
        if (!essayTopic || !essayText) {
             throw new Error("Tópico ou texto da redação está faltando na submissão.");
        }
        
        // 1. Cria a redação no banco de dados
        const newEssay = await prisma.essay.create({
            data: {
                userId,
                // 🚨 FIX CRÍTICO 2: Mapeamento correto para o Prisma
                topic: essayTopic, // Nome do campo 'topic'
                text: essayText,   // Nome do campo 'text' (corpo da redação)
            },
        });

 // 2. Gera o prompt para o modelo
        const prompt = generatePrompt(essayText, essayTopic);

        // 3. Chamada à API do Gemini (FIX CRÍTICO APLICADO AQUI)
        // 🚨 NOVO FIX: Usar a sintaxe de dois argumentos (contents, config)
        
        const model = genAI.getGenerativeModel({ model: modelName });

        const correctionResponse = await model.generateContent(
            // 1º ARGUMENTO: CONTENTS
            [{ role: "user", parts: [{ text: prompt }] }], 
            
            // 2º ARGUMENTO: CONFIG
            {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        competencias: { type: "OBJECT" }, 
                        total: { type: "NUMBER" },
                        feedbackGeral: { type: "STRING" }, 
                        pontosPositivos: { type: "STRING" },
                        pontosA_Melhorar: { type: "STRING" }, 
                        analiseTextual: { type: "OBJECT" },
                        sugestoesDeMelhora: { type: "STRING" }
                    }
                }
            }
        );

        // O conteúdo do JSON vem como uma string no campo 'text'
        const rawJson = correctionResponse.text;
        const correctionData = parseJsonSafely(rawJson);
        if (!correctionData) {
            throw new Error("A IA retornou um formato de correção inválido (JSON não pôde ser lido).");
        }

        // 4. Cria a correção no banco de dados (usando a lógica original de salvar o JSON como string)
        const correction = await prisma.correction.create({
            data: {
                essayId: newEssay.id,
                content: JSON.stringify(correctionData),
            },
        });
        
        // 5. Retorna a redação com o conteúdo da correção para o frontend
        return {
            ...newEssay,
            latestCorrection: correctionData,
            correctionId: correction.id,
        };

    } catch (error) {
        // Loga o erro, incluindo o nome, para melhor diagnóstico
        console.error("🚨 Erro final no submitEssay:", error.name, error.message);
        throw new Error(`Falha ao submeter a redação: ${error.message}`);
    }
};

// --- Funções de Leitura (Corrigidas para usar o parseJsonSafely atualizado) ---

/**
 * Busca uma redação específica por ID.
 */
export const getEssayById = async (essayId, userId) => {
    try {
        const essay = await prisma.essay.findUnique({
            where: { id: essayId, userId: userId },
            include: {
                corrections: { orderBy: { createdAt: 'desc' }, take: 1 }
            }
        });

        if (!essay) { throw new Error("Redação não encontrada ou acesso negado."); }

        if (essay.corrections && essay.corrections.length > 0) {
            const latestCorrection = essay.corrections[0];
            // O parseJsonSafely agora lida com o conteúdo nulo
            essay.latestCorrection = parseJsonSafely(latestCorrection.content);
        } else {
            essay.latestCorrection = null;
        }
        return essay;
    } catch (error) {
        console.error("Erro ao buscar redação por ID:", error.message);
        throw error;
    }
};

/**
 * Busca o histórico simples de redações.
 */
export const getEssayHistory = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } }
        });

        return essays.map(essay => {
            const correction = essay.corrections[0];
            // O parseJsonSafely agora lida com o conteúdo nulo
            const parsedContent = correction ? parseJsonSafely(correction.content) : null;

            return {
                id: essay.id,
                topic: essay.topic,
                createdAt: essay.createdAt,
                correction: parsedContent
            };
        }).filter(essay => essay.correction !== null);
    } catch (error) {
        console.error("Erro ao buscar histórico de redações:", error.message);
        throw new Error("Não foi possível carregar o histórico.");
    }
};

/**
 * Calcula as métricas de Analytics.
 */
export const getEssayAnalytics = async (userId) => {
    try {
        const allEssays = await prisma.essay.findMany({
            where: { userId }, orderBy: { createdAt: 'asc' },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } }
        });

        const gradedEssays = allEssays
            .filter(essay => essay.corrections.length > 0)
            .map(essay => {
                // O parseJsonSafely agora lida com o conteúdo nulo
                const parsedContent = parseJsonSafely(essay.corrections[0].content);
                return { ...essay, latestCorrection: parsedContent };
            })
            .filter(essay => essay.latestCorrection !== null);

        const totalEssays = gradedEssays.length;

        if (totalEssays === 0) {
            return { totalEssays: 0, averageScore: 0, scoreHistory: [], competenceAverages: [], latestEssays: [], totalWords: 0 };
        }

        const totalScoreSum = gradedEssays.reduce((sum, essay) => sum + (essay.latestCorrection?.total || 0), 0);
        const averageScore = Math.round(totalScoreSum / totalEssays) || 0;

        // O restante da lógica permanece robusta (com optional chaining '?.' e '|| 0')

        const scoreHistory = gradedEssays.map(essay => ({
            date: new Date(essay.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
            total: essay.latestCorrection.total || 0,
        }));

        const competenceSum = gradedEssays.reduce((acc, essay) => {
            const comps = essay.latestCorrection?.competencias;
            if (comps) {
                acc.c1 += comps.c1?.nota || 0; acc.c2 += comps.c2?.nota || 0; acc.c3 += comps.c3?.nota || 0;
                acc.c4 += comps.c4?.nota || 0; acc.c5 += comps.c5?.nota || 0;
            }
            return acc;
        }, { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 });

        const competenceAverages = [
            { subject: 'C1', A: Math.round(competenceSum.c1 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C2', A: Math.round(competenceSum.c2 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C3', A: Math.round(competenceSum.c3 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C4', A: Math.round(competenceSum.c4 / totalEssays) || 0, fullMark: 200 },
            { subject: 'C5', A: Math.round(competenceSum.c5 / totalEssays) || 0, fullMark: 200 },
        ];

        const latestEssays = gradedEssays.slice(-3).reverse().map(essay => ({
            id: essay.id, topic: essay.topic, total: essay.latestCorrection.total || 0, createdAt: essay.createdAt
        }));

        const totalWords = gradedEssays.reduce((sum, essay) => sum + (essay.text?.split(/\s+/).length || 0), 0);


        return { totalEssays, averageScore, scoreHistory, competenceAverages, latestEssays, totalWords };

    } catch (error) {
        console.error("Erro ao calcular analytics:", error.message);
        throw new Error("Não foi possível gerar as análises do dashboard.");
    }
};

/**
 * Busca as conquistas e verifica o status de desbloqueio.
 */
export const getUserAchievements = async (userId) => {
    try {
        const essays = await prisma.essay.findMany({
            where: { userId },
            include: { corrections: { orderBy: { createdAt: 'desc' }, take: 1 } }
        });

        const gradedEssays = essays.filter(e => e.corrections.length > 0);

        const essayGrades = gradedEssays
            // O parseJsonSafely agora lida com o conteúdo nulo
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
            if (achievement) achievement.unlocked = true;
        }

        return achievements;
    } catch (error) {
        console.error("Erro ao buscar conquistas:", error.message);
        throw new Error("Não foi possível buscar as conquistas.");
    }
};